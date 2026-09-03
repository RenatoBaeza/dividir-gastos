"""One error shape for the whole API.

Every failure — a raised ``HTTPException``, a rejected payload, a database
outage, a bug — leaves through here and comes back as::

    {"detail": "...", "error": {"code": "...", "request_id": "..."}}

``detail`` keeps the exact shape FastAPI produces by default (a string, or the
list of field errors for a 422) so existing clients keep working; ``error`` adds
the machine-readable code and the request id to quote in a bug report. Internal
failures never leak a driver message or a traceback to the caller: those go to
the logs, tied to the same request id the caller sees.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import request_id_var

logger = logging.getLogger("app.errors")

_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
    503: "service_unavailable",
}


def request_id_of(request: Request | None) -> str | None:
    """The id for this request, whichever side of the middleware we are on.

    The context variable is the normal source, but a failure handled above the
    middleware runs after it has been reset — there the id is still on the
    request scope.
    """
    if request is not None:
        scoped = request.scope.get("state", {}).get("request_id")
        if scoped:
            return scoped
    return request_id_var.get()


def error_response(
    status_code: int,
    detail: Any,
    *,
    request: Request | None = None,
    code: str | None = None,
    headers: dict[str, str] | None = None,
    **extra: Any,
) -> JSONResponse:
    body: dict[str, Any] = {
        "detail": detail,
        "error": {
            "code": code or _CODES.get(status_code, "error"),
            "status": status_code,
            "request_id": request_id_of(request),
            **extra,
        },
    }
    return JSONResponse(status_code=status_code, content=body, headers=headers)


async def _http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    if exc.status_code >= 500:
        logger.error("request failed: %s", exc.detail, extra={"path": request.url.path})
    return error_response(
        exc.status_code,
        exc.detail,
        request=request,
        headers=getattr(exc, "headers", None),
    )


async def _validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    errors = jsonable_encoder(exc.errors(), exclude={"input", "url", "ctx"})
    logger.info(
        "rejected an invalid payload",
        extra={"path": request.url.path, "error_count": len(errors)},
    )
    return error_response(
        # The literal, not the constant: Starlette renamed it and either spelling
        # is deprecated in some version this app is meant to run on.
        422,
        errors,
        request=request,
        fields=[".".join(str(p) for p in e.get("loc", ())) for e in errors],
    )


async def _integrity_error_handler(
    request: Request, exc: IntegrityError
) -> JSONResponse:
    # A unique or foreign-key violation is the caller's problem, not a bug: two
    # people racing the same invite, a member removed mid-request, and so on.
    logger.warning(
        "constraint violation", exc_info=exc, extra={"path": request.url.path}
    )
    return error_response(
        status.HTTP_409_CONFLICT,
        "That conflicts with data that already exists. Reload and try again.",
        request=request,
    )


async def _database_unavailable_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    logger.error("database unavailable", exc_info=exc, extra={"path": request.url.path})
    return error_response(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "The database is temporarily unavailable. Please try again in a moment.",
        request=request,
    )


async def _sqlalchemy_error_handler(
    request: Request, exc: SQLAlchemyError
) -> JSONResponse:
    logger.error("database error", exc_info=exc, extra={"path": request.url.path})
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "Something went wrong saving that. The failure has been logged.",
        request=request,
    )


async def unhandled_exception_response(request: Request, exc: Exception) -> JSONResponse:
    """The last word on any exception: a 500 that says nothing it should not.

    Registered as the catch-all handler, and called directly by the request
    middleware so that a crash still leaves through the same path as every other
    response — carrying the request id, in the body and in the header.
    """
    logger.error(
        "unhandled exception", exc_info=exc, extra={"path": request.url.path}
    )
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "Something went wrong. The failure has been logged.",
        request=request,
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(IntegrityError, _integrity_error_handler)
    app.add_exception_handler(OperationalError, _database_unavailable_handler)
    app.add_exception_handler(DBAPIError, _sqlalchemy_error_handler)
    app.add_exception_handler(SQLAlchemyError, _sqlalchemy_error_handler)
    app.add_exception_handler(Exception, unhandled_exception_response)
