"""Cross-cutting request handling: identity, limits, headers, access logs.

Order matters, and it is set in :mod:`app.main`. Starlette runs the *last*
middleware added first, so the wiring there reads bottom-up: request context
outermost (every log line and error body needs the id), then the body-size
guard, the rate limiter, and finally the security headers closest to the app.
"""

from __future__ import annotations

import hashlib
import logging
import re
import time
import uuid

from starlette.datastructures import Headers
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import settings
from .errors import error_response, unhandled_exception_response
from .logging_config import request_id_var, user_id_var
from .ratelimit import TokenBucketLimiter

logger = logging.getLogger("app.access")

REQUEST_ID_HEADER = "X-Request-ID"
# Anything longer or stranger than this is not a correlation id, it is an
# injection attempt against whatever reads the logs.
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._\-]{8,64}$")

# Paths that are polled by uptime checks and would otherwise drown the log.
_QUIET_PATHS = frozenset({"/health", "/health/ready", "/favicon.ico"})
# The docs pages are static HTML that loads its own assets; the API is data.
_DOCS_PREFIXES = ("/docs", "/redoc", "/openapi.json")


def client_ip(request: Request) -> str:
    """The caller's address as reported by the platform's proxy.

    ``x-forwarded-for`` alone is caller-controlled, so the headers a trusted
    edge sets itself come first; the first hop of XFF is only a fallback for
    running behind something simpler.
    """
    for header in ("x-vercel-forwarded-for", "x-real-ip"):
        value = request.headers.get(header)
        if value:
            return value.strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()

    return request.client.host if request.client else "unknown"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Give every request an id, then log exactly one line describing it."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        inbound = request.headers.get(REQUEST_ID_HEADER, "")
        request_id = inbound if _SAFE_REQUEST_ID.match(inbound) else uuid.uuid4().hex
        request.state.request_id = request_id

        id_token = request_id_var.set(request_id)
        user_token = user_id_var.set(None)
        started = time.perf_counter()

        try:
            try:
                response = await call_next(request)
            except Exception as exc:
                # Answered here rather than left to propagate: the handler above
                # this middleware would build its 500 after the id is gone, so
                # the caller would get a failure they cannot quote back.
                response = await unhandled_exception_response(request, exc)

            response.headers[REQUEST_ID_HEADER] = request_id
            self._log(request, response.status_code, started)
            return response
        finally:
            request_id_var.reset(id_token)
            user_id_var.reset(user_token)

    def _log(self, request: Request, status_code: int, started: float) -> None:
        if request.url.path in _QUIET_PATHS and status_code < 400:
            return

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        level = (
            logging.ERROR
            if status_code >= 500
            else logging.WARNING
            if status_code >= 400
            else logging.INFO
        )
        logger.log(
            level,
            "%s %s -> %s in %sms",
            request.method,
            request.url.path,
            status_code,
            duration_ms,
            extra={
                "http_method": request.method,
                "http_path": request.url.path,
                "http_status": status_code,
                "duration_ms": duration_ms,
                "client_ip": client_ip(request),
                # Set by the auth dependency, which runs in a task of its own and
                # so cannot hand the id back through a context variable.
                "user_id": request.scope.get("state", {}).get("user_id"),
            },
        )


class BodySizeLimitMiddleware:
    """Reject oversized bodies before they are buffered into memory.

    The declared ``Content-Length`` is checked first because that costs nothing;
    a request that omits it (or lies) is counted as it streams in, so a chunked
    upload cannot walk past the limit either. Written as raw ASGI rather than a
    ``BaseHTTPMiddleware``: it has to replace ``receive``, which only the plain
    interface gives it honestly.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            await self._too_large(scope, receive, send)
            return

        received = 0
        exceeded = False
        started = False
        replaced = False

        async def counting_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    exceeded = True
                    raise _BodyTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            """Make sure an oversized request is answered with 413, not the app's guess.

            Frameworks tend to catch whatever goes wrong while reading a body and
            call it a malformed request. If the real reason was the size limit,
            that answer is replaced here — before any of it reaches the client.
            """
            nonlocal started, replaced
            if replaced:
                return
            if message["type"] == "http.response.start":
                if exceeded:
                    replaced = True
                    await self._too_large(scope, receive, send)
                    return
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except _BodyTooLarge:
            if started or replaced:
                # Headers are already on the wire; nothing left to say.
                raise
            await self._too_large(scope, receive, send)

    async def _too_large(self, scope: Scope, receive: Receive, send: Send) -> None:
        logger.warning(
            "rejected an oversized request body", extra={"limit": self.max_bytes}
        )
        response = error_response(
            413, f"That request is larger than the {_readable(self.max_bytes)} limit."
        )
        await response(scope, receive, send)


def _readable(size: int) -> str:
    if size >= 1_000_000:
        return f"{size / 1_000_000:.1f} MB"
    return f"{size / 1_000:.0f} KB"


class _BodyTooLarge(Exception):
    pass


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-caller request budget, with a tighter one for expensive endpoints."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        limiter: TokenBucketLimiter,
        heavy_limiter: TokenBucketLimiter,
        heavy_prefixes: tuple[str, ...] = ("/imports",),
    ) -> None:
        super().__init__(app)
        self.limiter = limiter
        self.heavy_limiter = heavy_limiter
        self.heavy_prefixes = heavy_prefixes

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method == "OPTIONS" or request.url.path in _QUIET_PATHS:
            return await call_next(request)

        key = self._key(request)
        heavy = request.url.path.startswith(self.heavy_prefixes)
        limiter = self.heavy_limiter if heavy else self.limiter
        decision = limiter.check(key)

        if not decision.allowed:
            logger.warning(
                "rate limited",
                extra={"http_path": request.url.path, "heavy": heavy},
            )
            return error_response(
                429,
                "Too many requests. Please slow down and try again shortly.",
                headers={
                    "Retry-After": str(decision.retry_after),
                    "X-RateLimit-Limit": str(limiter.limit),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limiter.limit)
        response.headers["X-RateLimit-Remaining"] = str(decision.remaining)
        return response

    @staticmethod
    def _key(request: Request) -> str:
        """Bucket by credential when there is one, by address otherwise.

        The token is hashed rather than stored: the limiter's state should never
        become a place where a bearer token can be read back out.
        """
        credential = request.headers.get("authorization", "")
        if credential:
            return "tok:" + hashlib.sha256(credential.encode()).hexdigest()[:32]
        return "ip:" + client_ip(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Defensive headers for a JSON API served cross-origin.

    Most of these matter only if a response is ever rendered as a document —
    which is exactly the case worth defending, since an attacker who can get a
    browser to treat an API response as HTML is halfway to XSS.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        response = await call_next(request)
        headers = response.headers

        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "no-referrer")
        headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        # "cross-origin", not "same-site": the frontend is deliberately served
        # from another origin, and CORS plus the bearer token — not this header —
        # are what decide who may read a response.
        headers.setdefault("Cross-Origin-Resource-Policy", "cross-origin")
        headers.setdefault(
            "Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()"
        )
        # Swagger's page pulls its own bundle; the API itself never needs to
        # load anything at all, so it gets the strictest policy there is.
        if not request.url.path.startswith(_DOCS_PREFIXES):
            headers.setdefault(
                "Content-Security-Policy",
                "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
            )
            # Balances and expenses are per-user and change constantly; a shared
            # cache must never hold on to them.
            headers.setdefault("Cache-Control", "no-store")

        if settings.is_production:
            headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )

        return response
