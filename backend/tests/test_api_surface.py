"""What the API promises before a single row is read: health, errors, headers."""

from __future__ import annotations

from app.main import API_VERSION


def test_liveness_does_not_touch_the_database(client):
    # The point of the split: this must answer even when Postgres is gone, and
    # the test environment has no database at all.
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["version"] == API_VERSION


def test_readiness_reports_the_database_as_unreachable(client):
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "not_ready"


def test_every_error_carries_a_code_and_a_request_id(client):
    response = client.get("/nope")
    body = response.json()

    assert response.status_code == 404
    assert body["detail"] == "Not Found"
    assert body["error"]["code"] == "not_found"
    assert body["error"]["request_id"] == response.headers["X-Request-ID"]


def test_a_protected_route_refuses_an_anonymous_caller(client):
    response = client.get("/me")

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "unauthenticated"


def test_a_bad_token_is_refused_without_saying_why(client):
    response = client.get("/me", headers={"Authorization": "Bearer not-a-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_the_dev_scheme_is_refused_when_dev_mode_is_off(client):
    response = client.get("/me", headers={"Authorization": "Dev ana@example.com"})
    assert response.status_code == 401


def test_a_caller_supplied_request_id_is_echoed_back(client):
    response = client.get("/health", headers={"X-Request-ID": "trace-abc-123"})
    assert response.headers["X-Request-ID"] == "trace-abc-123"


def test_a_junk_request_id_is_replaced_rather_than_echoed(client):
    response = client.get("/health", headers={"X-Request-ID": "no\nnewlines"})

    assert response.headers["X-Request-ID"] != "no\nnewlines"
    assert len(response.headers["X-Request-ID"]) == 32


def test_responses_carry_the_hardening_headers(client):
    headers = client.get("/health").headers

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
    # Per-user data must never sit in a shared cache.
    assert headers["Cache-Control"] == "no-store"


def test_cors_allows_the_configured_origin_with_credentials(client):
    response = client.options(
        "/groups",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_ignores_an_unknown_origin(client):
    response = client.options(
        "/groups",
        headers={
            "Origin": "https://evil.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in response.headers


def test_the_schema_documents_how_to_authenticate(client):
    schema = client.get("/openapi.json").json()
    schemes = schema["components"]["securitySchemes"]

    assert any(s.get("scheme") == "bearer" for s in schemes.values())


def test_a_crash_still_comes_back_with_its_request_id(client, crashing_route):
    # A 500 the caller cannot quote back is a 500 nobody can investigate.
    response = client.get(crashing_route)
    body = response.json()

    assert response.status_code == 500
    assert "boom" not in response.text
    assert body["error"]["request_id"] == response.headers["X-Request-ID"]


def test_a_refused_request_still_carries_the_cors_headers(client):
    # The body-size guard answers before the app is reached. Without CORS on the
    # outside, the browser would report a CORS failure and the frontend would
    # never see the real reason.
    response = client.post(
        "/expenses",
        content=b"x" * 5_000,
        headers={
            "Origin": "http://localhost:5173",
            "Content-Type": "application/json",
        },
    )

    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.json()["error"]["code"] == "payload_too_large"
