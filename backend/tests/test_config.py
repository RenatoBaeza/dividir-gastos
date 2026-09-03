"""The settings that decide whether the app is safe to start."""

from __future__ import annotations

import pytest

from app.config import ConfigError, Settings


def production(**overrides) -> Settings:
    base = {
        "environment": "production",
        # Explicit, so the test environment's own variables cannot answer for it.
        "log_json": None,
        "database_url": "postgresql://api:secret@db.example.com:5432/app",
        "supabase_url": "https://project.supabase.co",
        "cors_origins": "https://app.example.com",
    }
    base.update(overrides)
    return Settings(**base)


def test_a_correctly_configured_production_starts():
    assert production().is_production is True


def test_production_refuses_the_dev_authentication_bypass():
    with pytest.raises(ConfigError, match="AUTH_DEV_MODE"):
        production(auth_dev_mode=True)


def test_production_refuses_the_local_database_default():
    with pytest.raises(ConfigError, match="DATABASE_URL"):
        production(database_url="postgresql://postgres:postgres@localhost:5432/postgres")


def test_production_refuses_to_run_without_a_way_to_verify_tokens():
    with pytest.raises(ConfigError, match="SUPABASE_URL"):
        production(supabase_url="", supabase_jwt_secret="")


def test_production_refuses_a_wildcard_origin():
    # Credentialed requests and `*` cannot coexist; browsers reject the pair and
    # the intent behind it is usually "make CORS stop complaining".
    with pytest.raises(ConfigError, match="CORS_ORIGINS"):
        production(cors_origins="*")


def test_the_same_mistakes_are_only_warnings_in_development():
    settings = Settings(environment="development", auth_dev_mode=True)
    assert settings.auth_dev_mode is True


def test_the_password_never_reaches_a_log_line():
    settings = production()

    assert "secret" not in settings.safe_database_url
    assert settings.safe_database_url == "postgresql://api:***@db.example.com:5432/app"


def test_the_environment_follows_the_platform_when_it_is_not_set(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("VERCEL_ENV", "preview")
    assert Settings().environment == "staging"


def test_an_explicit_environment_beats_the_platform(monkeypatch):
    monkeypatch.setenv("VERCEL_ENV", "production")
    assert Settings(environment="development").environment == "development"


def test_the_driver_url_is_normalised_for_psycopg():
    settings = Settings(database_url="postgres://u:p@host:5432/db")
    assert settings.sqlalchemy_url.startswith("postgresql+psycopg://")


def test_origins_are_split_and_trimmed():
    settings = Settings(cors_origins="https://a.example , https://b.example ,")
    assert settings.cors_origin_list == ["https://a.example", "https://b.example"]


def test_the_issuer_matches_what_supabase_stamps_on_its_tokens():
    settings = Settings(supabase_url="https://project.supabase.co/")
    assert settings.jwt_issuer == "https://project.supabase.co/auth/v1"


def test_logs_are_json_everywhere_but_a_developer_machine():
    assert Settings(environment="development", log_json=None).log_as_json is False
    assert production().log_as_json is True
    # An explicit setting still wins in either direction.
    assert Settings(environment="development", log_json=True).log_as_json is True
