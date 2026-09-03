"""Body limits, rate limiting and the error envelope, against a throwaway app."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app.middleware import BodySizeLimitMiddleware, RateLimitMiddleware
from app.ratelimit import TokenBucketLimiter


class Payload(BaseModel):
    name: str
    count: int


@pytest.fixture
def app(build_app):
    app = build_app()

    @app.post("/echo")
    def echo(payload: Payload) -> dict:
        return {"name": payload.name}

    @app.get("/boom")
    def boom() -> dict:
        raise RuntimeError("a bug nobody expected")

    @app.get("/clash")
    def clash() -> dict:
        raise IntegrityError("insert", {}, Exception("duplicate key"))

    @app.get("/teapot")
    def teapot() -> dict:
        raise HTTPException(418, "I am a teapot")

    return app


# --------------------------------------------------------------------------
# Error envelope
# --------------------------------------------------------------------------
def test_an_invalid_payload_comes_back_as_a_field_list(app):
    client = TestClient(app)
    response = client.post("/echo", json={"name": "ana", "count": "lots"})
    body = response.json()

    assert response.status_code == 422
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["fields"] == ["body.count"]
    # The rejected value is never echoed: payloads can carry things worth not
    # repeating back to whatever logs the response.
    assert "input" not in body["detail"][0]


def test_an_unexpected_exception_does_not_leak_its_message(app):
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/boom")

    assert response.status_code == 500
    assert "a bug nobody expected" not in response.text
    assert response.json()["error"]["code"] == "internal_error"


def test_a_constraint_violation_becomes_a_conflict(app):
    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/clash")

    assert response.status_code == 409
    assert "duplicate key" not in response.text


def test_a_raised_http_exception_keeps_its_status_and_message(app):
    response = TestClient(app).get("/teapot")

    assert response.status_code == 418
    assert response.json()["detail"] == "I am a teapot"


# --------------------------------------------------------------------------
# Body size
# --------------------------------------------------------------------------
def test_an_oversized_body_is_refused_before_it_is_parsed(app):
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=200)
    client = TestClient(app)

    response = client.post("/echo", json={"name": "x" * 500, "count": 1})

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_a_body_under_the_limit_still_goes_through(app):
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=200)
    client = TestClient(app)

    response = client.post("/echo", json={"name": "ana", "count": 1})

    assert response.status_code == 200
    assert response.json() == {"name": "ana"}


def test_an_undeclared_oversized_body_is_caught_while_streaming(app):
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=200)
    client = TestClient(app)

    def chunks():
        for _ in range(10):
            yield b'{"name": "' + b"x" * 100 + b'", "count": 1}'

    # A chunked upload declares no Content-Length, so only the running count
    # can stop it.
    response = client.post("/echo", content=chunks())
    assert response.status_code == 413


# --------------------------------------------------------------------------
# Rate limiting
# --------------------------------------------------------------------------
def test_a_caller_over_the_budget_is_told_when_to_come_back(app):
    app.add_middleware(
        RateLimitMiddleware,
        limiter=TokenBucketLimiter(2, 60),
        heavy_limiter=TokenBucketLimiter(1, 60),
        heavy_prefixes=("/teapot",),
    )
    client = TestClient(app)

    assert client.get("/clash", headers={"Authorization": "Bearer a"}).status_code != 429
    assert client.get("/clash", headers={"Authorization": "Bearer a"}).status_code != 429

    blocked = client.get("/clash", headers={"Authorization": "Bearer a"})
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    assert blocked.json()["error"]["code"] == "rate_limited"


def test_callers_do_not_share_a_budget(app):
    app.add_middleware(
        RateLimitMiddleware,
        limiter=TokenBucketLimiter(1, 60),
        heavy_limiter=TokenBucketLimiter(1, 60),
    )
    client = TestClient(app)

    client.get("/teapot", headers={"Authorization": "Bearer ana"})
    exhausted = client.get("/teapot", headers={"Authorization": "Bearer ana"})
    other = client.get("/teapot", headers={"Authorization": "Bearer bruno"})

    assert exhausted.status_code == 429
    assert other.status_code == 418


def test_expensive_endpoints_have_their_own_budget(app):
    app.add_middleware(
        RateLimitMiddleware,
        limiter=TokenBucketLimiter(10, 60),
        heavy_limiter=TokenBucketLimiter(1, 60),
        heavy_prefixes=("/teapot",),
    )
    client = TestClient(app)

    assert client.get("/teapot").status_code == 418
    assert client.get("/teapot").status_code == 429
    # The cheap endpoint is untouched by the heavy budget.
    assert client.get("/clash", headers={}).status_code == 409


def test_health_checks_are_never_rate_limited(app):
    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    app.add_middleware(
        RateLimitMiddleware,
        limiter=TokenBucketLimiter(1, 60),
        heavy_limiter=TokenBucketLimiter(1, 60),
    )
    client = TestClient(app)

    assert [client.get("/health").status_code for _ in range(5)] == [200] * 5
