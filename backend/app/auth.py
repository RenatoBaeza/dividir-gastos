"""Supabase-issued JWT verification.

Sign-in, sign-up and password resets all happen in the browser against Supabase
Auth, so no credential ever reaches this service. All this module does is prove
the bearer token really came from the project and turn it into a row in
``app_users``.

Verification is deliberately strict: signature, expiry, not-before, audience,
issuer and the presence of the claims the app depends on are all checked, and
the algorithm is pinned to whatever the token's own header says *only* after
that algorithm has been matched to a key source we trust. Everything that fails
comes back as the same opaque 401, because telling a caller *why* their token
was rejected is telling an attacker how close they got.
"""

from __future__ import annotations

import logging
import uuid
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPBearer
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .logging_config import user_id_var
from .models import AppUser

logger = logging.getLogger("app.auth")

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)

# Declared for the OpenAPI schema (the Authorize button in /docs) and to mark
# every route that depends on it as protected. The header is still read by hand
# below, because local dev also accepts a `Dev <email>` scheme.
bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="Supabase access token",
    description="The `access_token` from the browser's Supabase session.",
)


@lru_cache
def _jwk_client() -> PyJWKClient:
    if not settings.supabase_url:
        raise RuntimeError("SUPABASE_URL is not configured")
    return PyJWKClient(
        settings.jwks_url,
        cache_keys=True,
        # Without a timeout a slow JWKS endpoint would hold the request (and its
        # database connection) open until the platform kills the invocation.
        timeout=settings.jwks_timeout_seconds,
    )


def _decode_options() -> dict:
    return {
        "verify_signature": True,
        "verify_exp": True,
        "verify_nbf": True,
        "verify_iat": True,
        "verify_aud": bool(settings.jwt_audience),
        "verify_iss": bool(settings.supabase_url),
        # A token missing any of these is not one this app can act on.
        "require": ["exp", "iat", "sub"],
    }


def decode_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise _UNAUTHORIZED from exc

    algorithm = header.get("alg")
    common = {
        "audience": settings.jwt_audience or None,
        "issuer": settings.jwt_issuer if settings.supabase_url else None,
        "leeway": settings.jwt_leeway_seconds,
        "options": _decode_options(),
    }

    try:
        if algorithm == "HS256":
            if not settings.supabase_jwt_secret:
                raise RuntimeError("SUPABASE_JWT_SECRET is not configured")
            return jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"], **common
            )

        if algorithm not in {"RS256", "ES256"}:
            # Never let the token pick "none", or an algorithm we have no key for.
            raise jwt.InvalidAlgorithmError(f"unsupported algorithm {algorithm!r}")

        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token, signing_key.key, algorithms=["RS256", "ES256"], **common
        )
    except jwt.PyJWTError as exc:
        logger.info("rejected a token: %s", type(exc).__name__)
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
    request: Request,
    authorization: str | None = Header(default=None),
    _bearer=Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> AppUser:
    if not authorization:
        raise _UNAUTHORIZED

    scheme, _, credential = authorization.partition(" ")
    scheme = scheme.lower()

    if scheme == "dev":
        # Local development without a Supabase project: the credential is just an
        # email address, and the id is derived from it so it stays stable. The
        # config refuses to boot with this on in production; this is the second
        # lock on the same door.
        if not settings.auth_dev_mode or settings.is_production:
            raise _UNAUTHORIZED
        email = credential.strip().lower()
        if not email:
            raise _UNAUTHORIZED
        user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"dev-user:{email}")
        return _remember(request, upsert_user(db, user_id, email, email.split("@")[0], None))

    if scheme != "bearer" or not credential:
        raise _UNAUTHORIZED

    claims = decode_token(credential)
    return _remember(request, upsert_user(db, *_claims_to_profile(claims)))


def _remember(request: Request, user: AppUser) -> AppUser:
    """Tag this request's log lines with who made it.

    The context variable covers everything logged inside the handler; the scope
    is what the access-log middleware can still read afterwards, since it runs
    in a different task and would not see the context variable.
    """
    user_id_var.set(str(user.id))
    request.state.user_id = str(user.id)
    return user
