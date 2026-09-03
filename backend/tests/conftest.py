"""Shared test setup.

The environment is pinned before anything from ``app`` is imported: settings are
read once at import time, so a stray ``.env`` on a developer's machine would
otherwise decide what the tests are actually testing.
"""

from __future__ import annotations

import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("SUPABASE_URL", "https://project.supabase.co")
# Small enough that a test can actually hit the body-size guard.
os.environ.setdefault("MAX_REQUEST_BYTES", "4000")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("LOG_JSON", "false")

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.errors import install_error_handlers  # noqa: E402
from app.main import app as api  # noqa: E402


@pytest.fixture
def client() -> TestClient:
    """The real application, without a database behind it.

    Everything exercised through this fixture is reachable before the first
    query: health, the error envelope, headers, and the 401 wall.
    """
    with TestClient(api) as test_client:
        yield test_client


@pytest.fixture
def crashing_route() -> str:
    """Temporarily mount a route that raises, and take it away again."""
    path = "/__crash_for_test"

    @api.get(path, include_in_schema=False)
    def crash() -> dict:
        raise RuntimeError("boom")

    try:
        yield path
    finally:
        api.router.routes[:] = [
            r for r in api.router.routes if getattr(r, "path", None) != path
        ]


@pytest.fixture
def build_app():
    """A throwaway app carrying the project's error handlers.

    Middleware is tested against this rather than the real app so limits can be
    set to values a test can actually reach.
    """

    def factory() -> FastAPI:
        app = FastAPI()
        install_error_handlers(app)
        return app

    return factory
