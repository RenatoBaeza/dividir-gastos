from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]

_DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/postgres"


class ConfigError(RuntimeError):
    """A setting is missing or unsafe for the environment the app is booting in."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Environment --------------------------------------------------------
    # Drives every "is this safe?" decision below. Vercel production deployments
    # self-detect through VERCEL_ENV, so only non-Vercel hosts need to set it.
    environment: Environment = "development"

    # --- Database -----------------------------------------------------------
    # Supabase gives you this under Project Settings -> Database -> Connection
    # string. Either the direct connection or the session pooler works.
    database_url: str = _DEFAULT_DATABASE_URL
    db_echo: bool = False
    db_pool_size: int = Field(default=5, ge=1, le=50)
    db_max_overflow: int = Field(default=10, ge=0, le=50)
    # Recycle below the typical 10-minute pooler idle timeout so the app never
    # hands out a connection Postgres has already dropped.
    db_pool_recycle_seconds: int = Field(default=300, ge=30)
    db_connect_timeout_seconds: int = Field(default=10, ge=1, le=60)
    # Health checks get their own, much shorter budget.
    db_probe_timeout_seconds: int = Field(default=3, ge=1, le=30)
    # Server-side guards: a runaway query can otherwise pin a pooler connection
    # for as long as the platform's request timeout allows.
    db_statement_timeout_ms: int = Field(default=15_000, ge=0)
    db_lock_timeout_ms: int = Field(default=5_000, ge=0)
    db_idle_in_transaction_timeout_ms: int = Field(default=15_000, ge=0)

    # --- Supabase auth ------------------------------------------------------
    supabase_url: str = ""
    # Projects created before the asymmetric-key rollout sign with a shared
    # HS256 secret; newer ones publish a JWKS. Both are supported.
    supabase_jwt_secret: str = ""
    jwt_audience: str = "authenticated"
    # Clocks drift between Supabase and the host; a few seconds of slack stops
    # freshly minted tokens from being rejected as not-yet-valid.
    jwt_leeway_seconds: int = Field(default=10, ge=0, le=300)
    jwks_timeout_seconds: int = Field(default=5, ge=1, le=30)

    # --- Deployment ---------------------------------------------------------
    # Serverless invocations are short-lived and highly concurrent, so the
    # connection pool has to be off and prepared statements have to go. Vercel
    # sets VERCEL=1 in every build and runtime, so this normally self-detects.
    serverless: bool = False

    # --- App ----------------------------------------------------------------
    cors_origins: str = "http://localhost:5173"
    # Vercel gives every preview deployment its own hostname, which no static
    # list can cover; this matches them without opening up the whole internet.
    cors_origin_regex: str = ""
    # Comma-separated Host values to accept. Empty means "any", which is right
    # behind a platform router that already filters by hostname.
    trusted_hosts: str = ""
    docs_enabled: bool = True

    # --- Limits -------------------------------------------------------------
    # A Splitwise export is a few hundred kilobytes; the ceiling only exists so
    # a single request cannot exhaust the function's memory.
    max_request_bytes: int = Field(default=8_000_000, ge=1024)
    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=240, ge=1)
    rate_limit_window_seconds: int = Field(default=60, ge=1)
    # Imports parse and write hundreds of rows per call, so they get their own,
    # much tighter budget.
    rate_limit_heavy_requests: int = Field(default=12, ge=1)
    rate_limit_heavy_window_seconds: int = Field(default=60, ge=1)

    # --- Observability ------------------------------------------------------
    log_level: str = "INFO"
    # Structured JSON lines in deployed environments, readable text locally.
    log_json: bool | None = None

    # --- Escape hatches -----------------------------------------------------
    # Local-only: lets the frontend send `Authorization: Dev <email>` so the
    # whole app can be exercised without a Supabase project. Refused outright
    # when the environment is production.
    auth_dev_mode: bool = False

    # ------------------------------------------------------------------ derived
    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    @property
    def safe_database_url(self) -> str:
        """The database URL with the password blanked out, for logs."""
        parts = urlsplit(self.database_url)
        if not parts.hostname:
            return "(unparseable)"
        userinfo = f"{parts.username}:***@" if parts.password else ""
        port = f":{parts.port}" if parts.port else ""
        return urlunsplit(
            (parts.scheme, f"{userinfo}{parts.hostname}{port}", parts.path, "", "")
        )

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_serverless(self) -> bool:
        return self.serverless or bool(os.getenv("VERCEL"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_host_list(self) -> list[str]:
        return [h.strip() for h in self.trusted_hosts.split(",") if h.strip()]

    @property
    def log_as_json(self) -> bool:
        return self.log_json if self.log_json is not None else self.environment != "development"

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        """Supabase stamps every token with `<project url>/auth/v1` as `iss`."""
        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def auth_configured(self) -> bool:
        return bool(self.supabase_url or self.supabase_jwt_secret)

    # ---------------------------------------------------------------- validation
    @model_validator(mode="after")
    def _default_environment_from_platform(self) -> Settings:
        # Only fill in what the operator left unset: an explicit ENVIRONMENT wins.
        if "environment" not in self.model_fields_set:
            vercel_env = os.getenv("VERCEL_ENV")
            if vercel_env == "production":
                object.__setattr__(self, "environment", "production")
            elif vercel_env in {"preview", "development"}:
                object.__setattr__(self, "environment", "staging")
        return self

    @model_validator(mode="after")
    def _reject_unsafe_production_config(self) -> Settings:
        """Fail at import time rather than serve a production request insecurely.

        Every check here is something that silently degrades security if it is
        wrong, so a crash-on-boot (which the platform surfaces immediately) beats
        a running server that trusts the wrong tokens or the wrong origins.
        """
        if not self.is_production:
            return self

        problems: list[str] = []
        if self.auth_dev_mode:
            problems.append(
                "AUTH_DEV_MODE accepts an unverified email as proof of identity "
                "and must never be enabled in production."
            )
        if self.database_url == _DEFAULT_DATABASE_URL:
            problems.append("DATABASE_URL is still the local development default.")
        if not self.auth_configured:
            problems.append(
                "Neither SUPABASE_URL nor SUPABASE_JWT_SECRET is set, so no token "
                "can be verified."
            )
        if "*" in self.cors_origin_list:
            problems.append(
                "CORS_ORIGINS contains '*', which cannot be combined with "
                "credentialed requests."
            )
        if not self.cors_origin_list and not self.cors_origin_regex:
            problems.append(
                "Neither CORS_ORIGINS nor CORS_ORIGIN_REGEX is set, so no browser "
                "can call the API."
            )

        if problems:
            raise ConfigError(
                "Refusing to start in production:\n  - " + "\n  - ".join(problems)
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
