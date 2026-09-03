from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .db import check_database, dispose_engine
from .errors import error_response, install_error_handlers
from .logging_config import configure_logging
from .middleware import (
    REQUEST_ID_HEADER,
    BodySizeLimitMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from .ratelimit import TokenBucketLimiter
from .routers import activity, balances, expenses, groups, imports, me, settlements

configure_logging()
logger = logging.getLogger("app")

API_VERSION = "1.0.0"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    logger.info(
        "starting the API",
        extra={
            "environment": settings.environment,
            "serverless": settings.is_serverless,
            "database": settings.safe_database_url,
            "auth_dev_mode": settings.auth_dev_mode,
            "cors_origins": settings.cors_origin_list,
        },
    )
    if settings.auth_dev_mode:
        logger.warning(
            "AUTH_DEV_MODE is on: any `Authorization: Dev <email>` header is "
            "accepted as proof of identity. Local use only."
        )
    if not settings.auth_configured and not settings.auth_dev_mode:
        logger.warning("no Supabase credentials configured; every request will 401")

    try:
        yield
    finally:
        # Long-running hosts get their pool closed cleanly. Serverless uses
        # NullPool, so this is a no-op there.
        dispose_engine()


app = FastAPI(
    title="Dividir Gastos API",
    version=API_VERSION,
    description="A Splitwise-style shared expense tracker.",
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
    # Trailing slashes are a routing detail, not a redirect the browser should
    # follow across origins with credentials attached.
    redirect_slashes=False,
)

install_error_handlers(app)

# --------------------------------------------------------------------------
# Middleware. Starlette runs the last one added first, so this list executes
# bottom-to-top:
#
#   CORS            outermost, so that a request refused by any of the guards
#                   below still comes back with the headers the browser needs to
#                   let the frontend read it — a 429 without them shows up as a
#                   CORS error, which is the wrong thing to go and debug
#   request context an id and one access-log line for everything past CORS
#   trusted host    reject a forged Host before any work is done
#   body size       refuse an oversized upload before it is buffered
#   rate limit      per-caller budget
#   gzip            compress what is left
#   security headers innermost, so it can stamp every response the app produces
# --------------------------------------------------------------------------
app.add_middleware(SecurityHeadersMiddleware)

# Balance and expense lists are repetitive JSON that compresses very well.
app.add_middleware(GZipMiddleware, minimum_size=1024)

if settings.rate_limit_enabled:
    app.add_middleware(
        RateLimitMiddleware,
        limiter=TokenBucketLimiter(
            settings.rate_limit_requests, settings.rate_limit_window_seconds
        ),
        heavy_limiter=TokenBucketLimiter(
            settings.rate_limit_heavy_requests, settings.rate_limit_heavy_window_seconds
        ),
    )

app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_bytes)

if settings.trusted_host_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)

app.add_middleware(RequestContextMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    # Spelled out rather than "*": with credentials allowed, a wildcard is both
    # rejected by browsers and a bad habit.
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
    expose_headers=[
        REQUEST_ID_HEADER,
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
    ],
    max_age=3600,
)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
app.include_router(me.router)
app.include_router(groups.router)
app.include_router(expenses.router)
app.include_router(settlements.router)
app.include_router(balances.router)
app.include_router(activity.router)
app.include_router(imports.router)


@app.get("/", tags=["meta"], include_in_schema=False)
def root() -> dict:
    return {
        "name": "Dividir Gastos API",
        "version": API_VERSION,
        "docs": "/docs" if settings.docs_enabled else None,
        "health": "/health",
    }


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness: is this process able to answer at all?

    Deliberately free of dependencies. A platform that restarts the app when
    this fails must not be told to restart because Postgres is having a moment —
    that is what the readiness probe below is for.
    """
    return {
        "status": "ok",
        "version": API_VERSION,
        "environment": settings.environment,
        "auth_dev_mode": settings.auth_dev_mode,
    }


@app.get("/health/ready", tags=["meta"])
def readiness() -> Response:
    """Readiness: can this process actually serve a request end to end?"""
    try:
        check_database()
    except Exception as exc:
        logger.error("readiness check failed", exc_info=exc)
        return error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The database is unreachable.",
            code="not_ready",
            database="unreachable",
        )

    return JSONResponse({"status": "ok", "database": "ok"})
