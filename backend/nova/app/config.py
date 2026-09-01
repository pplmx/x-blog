import os

from pydantic_settings import BaseSettings, SettingsConfigDict


def is_development() -> bool:
    """True when APP_ENV is explicitly set to a development value.

    Defaults to production semantics: unset APP_ENV is treated as production so
    that missing secrets fail closed instead of running with insecure defaults.
    """
    return os.getenv("APP_ENV", "production").lower() in ("development", "dev")


class Settings(BaseSettings):
    database_url: str = "sqlite:///./aurora.db"
    pool_size: int = 10
    pool_overflow: int = 20
    site_url: str = "http://localhost:3000"
    site_title: str = "X-Blog"
    site_description: str = "A modern blog built with FastAPI and Next.js"
    # Feed language tag (RSS <language> + Atom xml:lang). zh-CN preserves the
    # long-standing default; an English-configured site can set SITE_LANGUAGE.
    site_language: str = "zh-CN"
    sentry_dsn: str | None = None
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
