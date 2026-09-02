"""Claim handling, which is the only part of auth that has logic worth testing."""

import uuid

import pytest
from fastapi import HTTPException

from app.auth import _claims_to_profile


def claims(**overrides) -> dict:
    base = {
        "sub": str(uuid.uuid4()),
        "email": "Ana@Example.com",
        "aud": "authenticated",
        "user_metadata": {},
    }
    base.update(overrides)
    return base


def test_email_is_normalised():
    _, email, _, _ = _claims_to_profile(claims())
    assert email == "ana@example.com"


def test_sign_up_name_is_used():
    _, _, name, _ = _claims_to_profile(
        claims(user_metadata={"full_name": "Ana Ruiz"})
    )
    assert name == "Ana Ruiz"


def test_name_falls_back_to_the_email_local_part():
    _, _, name, _ = _claims_to_profile(claims())
    assert name == "Ana"


def test_a_token_without_an_email_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _claims_to_profile(claims(email=None))
    assert exc.value.status_code == 401


def test_a_token_with_a_junk_subject_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _claims_to_profile(claims(sub="not-a-uuid"))
    assert exc.value.status_code == 401
