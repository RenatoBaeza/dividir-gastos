"""Token verification: what gets in, and everything that must not.

These run against the legacy HS256 path because it needs no key server, but the
checks under test — expiry, audience, issuer, required claims, the algorithm
itself — are the same ones the asymmetric path goes through.
"""

from __future__ import annotations

import datetime as dt
import uuid

import jwt
import pytest
from fastapi import HTTPException

from app.auth import decode_token
from app.config import settings

# Long enough that PyJWT does not (rightly) complain about a weak HMAC key.
SECRET = "a-test-signing-secret-of-sufficient-length"
ISSUER = "https://project.supabase.co/auth/v1"


@pytest.fixture(autouse=True)
def hs256_project(monkeypatch):
    monkeypatch.setattr(settings, "supabase_jwt_secret", SECRET)
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "jwt_audience", "authenticated")


def make_token(*, secret: str = SECRET, algorithm: str = "HS256", **claims) -> str:
    now = dt.datetime.now(dt.UTC)
    payload = {
        "sub": str(uuid.uuid4()),
        "email": "ana@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + dt.timedelta(hours=1),
    }
    payload.update(claims)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, secret, algorithm=algorithm)


def test_a_genuine_token_is_accepted():
    claims = decode_token(make_token())
    assert claims["email"] == "ana@example.com"


def test_a_token_signed_with_the_wrong_secret_is_rejected():
    with pytest.raises(HTTPException) as exc:
        decode_token(make_token(secret="a-different-secret-of-sufficient-length"))
    assert exc.value.status_code == 401


def test_an_expired_token_is_rejected():
    past = dt.datetime.now(dt.UTC) - dt.timedelta(hours=2)
    with pytest.raises(HTTPException):
        decode_token(make_token(iat=past, exp=past + dt.timedelta(hours=1)))


def test_a_token_from_another_supabase_project_is_rejected():
    # Same algorithm, same shape, different issuer: without the issuer check a
    # leaked secret from any other project would be enough.
    with pytest.raises(HTTPException):
        decode_token(make_token(iss="https://someone-else.supabase.co/auth/v1"))


def test_a_token_for_a_different_audience_is_rejected():
    with pytest.raises(HTTPException):
        decode_token(make_token(aud="anon"))


def test_a_token_without_a_subject_is_rejected():
    with pytest.raises(HTTPException):
        decode_token(make_token(sub=None))


def test_a_token_without_an_expiry_is_rejected():
    # A token that never expires is a permanent credential; Supabase does not
    # issue one, so anything claiming to be one is not from Supabase.
    with pytest.raises(HTTPException):
        decode_token(make_token(exp=None))


def test_an_unsigned_token_is_rejected():
    payload = {"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": ISSUER}
    unsigned = jwt.encode(payload, key="", algorithm="none")

    with pytest.raises(HTTPException):
        decode_token(unsigned)


def test_a_token_that_is_not_a_token_is_rejected():
    with pytest.raises(HTTPException):
        decode_token("clearly-not-a-jwt")


def test_a_little_clock_drift_is_tolerated():
    # Issued three seconds in the future by a host whose clock runs fast.
    soon = dt.datetime.now(dt.UTC) + dt.timedelta(seconds=3)
    claims = decode_token(make_token(iat=soon, nbf=soon, exp=soon + dt.timedelta(hours=1)))
    assert claims["sub"]
