from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings

if settings.is_serverless:
    # One short-lived function invocation per request: keeping a pool would
    # hold Postgres connections open across freezes and exhaust the pooler.
    # Prepared statements have to go too, since Supabase's transaction pooler
    # hands out a different backend connection on every statement.
    _engine_options = {
        "poolclass": NullPool,
        "connect_args": {"prepare_threshold": None},
    }
else:
    _engine_options = {"pool_pre_ping": True, "pool_size": 5, "max_overflow": 10}

engine = create_engine(settings.sqlalchemy_url, echo=settings.db_echo, **_engine_options)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
