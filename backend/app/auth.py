"""Supabase-issued JWT verification.

Sign-in, sign-up and password resets all happen in the browser against Supabase
Auth, so no credential ever reaches this service. All this module does is prove
the bearer token really came from the project and turn it into a row in
``app_users``.
"""

from __future__ import annotations

import uuid
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AppUser

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


@lru_cache
def _jwk_client() -> PyJWKClient:
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return PyJWKClient(settings.jwks_url, cache_keys=True)


def decode_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise _UNAUTHORIZED from exc

    options = {"verify_aud": bool(settings.jwt_audience)}
    try:
        if header.get("alg") == "HS256":
            if not settings.supabase_jwt_secret:
                raise RuntimeError("SUPABASE_JWT_SECRET is not configured")
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience=settings.jwt_audience or None,
                options=options,
            )
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256", "ES256"],
            audience=settings.jwt_audience or None,
            options=options,
        )
    except jwt.PyJWTError as exc:
        raise _UNAUTHORIZED from exc


def _claims_to_profile(claims: dict) -> tuple[uuid.UUID, str, str, str | None]:
    sub = claims.get("sub")
    email = claims.get("email") or (claims.get("user_metadata") or {}).get("email")
    if not sub or not email:
        raise _UNAUTHORIZED

    meta = claims.get("user_metadata") or {}
    name = meta.get("full_name") or meta.get("name") or email.split("@")[0]
    avatar = meta.get("avatar_url") or meta.get("picture")

    try:
        user_id = uuid.UUID(str(sub))
    except ValueError as exc:
        raise _UNAUTHORIZED from exc

    return user_id, email.lower(), name, avatar


def upsert_user(
    db: Session, user_id: uuid.UUID, email: str, name: str, avatar: str | None
) -> AppUser:
    user = db.get(AppUser, user_id)
    if user is None:
        # The same person may already exist as an invited placeholder row.
        user = db.scalar(select(AppUser).where(AppUser.email == email))
        if user is None:
            user = AppUser(id=user_id, email=email, display_name=name, avatar_url=avatar)
            db.add(user)
            db.flush()
            return user

    user.email = email
    # The name from the token seeds the profile but never overrides it: the
    # sign-up form is the only thing that sets user_metadata, so echoing it back
    # on every request would silently undo a rename made through PATCH /me.
    if name and not user.display_name:
        user.display_name = name
    if avatar:
        user.avatar_url = avatar
    db.flush()
    return user


def current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> AppUser:
    if not authorization:
        raise _UNAUTHORIZED

    scheme, _, credential = authorization.partition(" ")
    scheme = scheme.lower()

    if scheme == "dev" and settings.auth_dev_mode:
        # Local development without a Supabase project: the credential is just an
        # email address, and the id is derived from it so it stays stable.
        email = credential.strip().lower()
        if not email:
            raise _UNAUTHORIZED
        user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"dev-user:{email}")
        return upsert_user(db, user_id, email, email.split("@")[0], None)

    if scheme != "bearer" or not credential:
        raise _UNAUTHORIZED

    claims = decode_token(credential)
    return upsert_user(db, *_claims_to_profile(claims))
