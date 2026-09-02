import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database -----------------------------------------------------------
    # Supabase gives you this under Project Settings -> Database -> Connection
    # string. Either the direct connection or the session pooler works.
    database_url: str = "postgresql://postgres:postgres@localhost:5432/postgres"
    db_echo: bool = False

    # --- Supabase auth ------------------------------------------------------
    supabase_url: str = ""
    # Projects created before the asymmetric-key rollout sign with a shared
    # HS256 secret; newer ones publish a JWKS. Both are supported.
    supabase_jwt_secret: str = ""
    jwt_audience: str = "authenticated"

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
    # Local-only escape hatch: lets the frontend send `Authorization: Dev <email>`
    # so the whole app can be exercised without a Supabase project. Never enable
    # this anywhere that is reachable from the internet.
    auth_dev_mode: bool = False

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://") :]
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://") :]
        return url

    @property
    def is_serverless(self) -> bool:
        return self.serverless or bool(os.getenv("VERCEL"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
