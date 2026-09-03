"""Logging setup and the per-request context that every log line carries.

The goal is that a single line in the platform's log viewer is enough to answer
"which request was this, who made it, and how long did it take?". Anything the
middleware learns about a request is stashed in context variables so handlers
deep in the call stack do not have to thread it through their signatures.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any

from .config import settings

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)

# Attributes LogRecord always sets; anything else on a record is an extra worth
# emitting as its own JSON field.
_RESERVED = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"asctime", "message", "taskName"}


class ContextFilter(logging.Filter):
    """Attach the current request's identifiers to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        # Never clobber a value the caller passed in `extra`: the access log
        # knows the user id even where the context variable has been reset.
        if getattr(record, "request_id", None) is None:
            record.request_id = request_id_var.get()
        if getattr(record, "user_id", None) is None:
            record.user_id = user_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_") or value is None:
                continue
            payload[key] = value if _is_jsonable(value) else str(value)

        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Human-readable lines for local development."""

    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record, '%H:%M:%S')} {record.levelname:<7} " \
               f"{record.name}: {record.getMessage()}"
        request_id = getattr(record, "request_id", None)
        if request_id:
            base = f"{base} [req {request_id[:8]}]"
        if record.exc_info:
            base = f"{base}\n{self.formatException(record.exc_info)}"
        return base


def _is_jsonable(value: Any) -> bool:
    return isinstance(value, str | int | float | bool | list | dict)


def configure_logging() -> None:
    """Point every logger at one configured stdout handler.

    Uvicorn installs its own handlers, so they are cleared and left to propagate
    to the root: one format, one destination, no duplicated lines.
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_as_json else TextFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "gunicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True

    # The access log is emitted by our own middleware, with timing and identity
    # attached; uvicorn's version would just duplicate it without either.
    logging.getLogger("uvicorn.access").disabled = True
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.db_echo else logging.WARNING
    )
    # Third-party chatter that would otherwise log a line per outbound call.
    for noisy in ("httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
