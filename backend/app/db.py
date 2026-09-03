"""Engine, session lifecycle and the per-request transaction.

The engine is built on first use rather than at import time. That keeps
importing the app free of driver loading and DNS work — which matters for a
serverless cold start, and means the test suite and tooling can import a router
without a database driver being installed at all.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

logger = logging.getLogger("app.db")


def _server_settings() -> str:
    """Per-connection guards, applied by the server rather than trusted to us.

    A statement that runs away, or a transaction left open by a crashed
    invocation, would otherwise hold a pooler slot until the platform kills the
    request — and on a small Supabase plan those slots are the scarcest thing
    the app has.
    """
    options = []
    if settings.db_statement_timeout_ms:
        options.append(f"-c statement_timeout={settings.db_statement_timeout_ms}")
    if settings.db_lock_timeout_ms:
        options.append(f"-c lock_timeout={settings.db_lock_timeout_ms}")
    if settings.db_idle_in_transaction_timeout_ms:
        options.append(
            "-c idle_in_transaction_session_timeout="
            f"{settings.db_idle_in_transaction_timeout_ms}"
        )
    return " ".join(options)


def _engine_options() -> dict[str, Any]:
    connect_args: dict[str, Any] = {
        "connect_timeout": settings.db_connect_timeout_seconds,
        # Shows up in pg_stat_activity, which is how you tell this app's
        # connections apart from psql and the Supabase dashboard when the pool
        # is exhausted.
        "application_name": f"dividir-gastos-api[{settings.environment}]",
    }
    if options := _server_settings():
        connect_args["options"] = options

    if settings.is_serverless:
        # One short-lived function invocation per request: keeping a pool would
        # hold Postgres connections open across freezes and exhaust the pooler.
        # Prepared statements have to go too, since Supabase's transaction
        # pooler hands out a different backend connection on every statement.
        return {
            "poolclass": NullPool,
            "connect_args": {**connect_args, "prepare_threshold": None},
        }

    return {
        "pool_pre_ping": True,
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        # Recycle before the pooler's idle timeout can close a connection under us.
        "pool_recycle": settings.db_pool_recycle_seconds,
        "pool_timeout": settings.db_connect_timeout_seconds,
        "connect_args": connect_args,
    }


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    engine = create_engine(
        settings.sqlalchemy_url, echo=settings.db_echo, **_engine_options()
    )
    logger.info(
        "database engine ready",
        extra={"database": settings.safe_database_url, "pooled": not settings.is_serverless},
    )
    return engine


def __getattr__(name: str) -> Any:
    # `from app.db import engine` keeps working, without building one on import.
    if name == "engine":
        return get_engine()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """One transaction per request: commit on success, roll back on any error."""
    db = SessionLocal(bind=get_engine())
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@lru_cache(maxsize=1)
def _probe_engine() -> Engine:
    """A pool-less engine with a short connect timeout, just for health checks.

    The request engine's timeout is sized for real work; a readiness probe that
    waits that long on a dead database is worse than useless, because the
    platform gives up on the probe before the probe gives up on Postgres.
    """
    return create_engine(
        settings.sqlalchemy_url,
        poolclass=NullPool,
        connect_args={
            "connect_timeout": settings.db_probe_timeout_seconds,
            "application_name": f"dividir-gastos-probe[{settings.environment}]",
        },
    )


def check_database() -> None:
    """Round-trip to Postgres. Raises whatever went wrong, for the caller to map."""
    with _probe_engine().connect() as conn:
        conn.execute(text("select 1"))


def dispose_engine() -> None:
    """Close pooled connections on shutdown so Postgres does not have to time them out."""
    for factory in (get_engine, _probe_engine):
        if factory.cache_info().currsize:
            factory().dispose()
    logger.info("database connections released")
