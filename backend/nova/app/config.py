import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Single env-config point (round 433, ISS-636): load .env INTO the process
# environment so the direct os.getenv readers agree with pydantic-settings.
# Settings reads .env itself, but pydantic-settings does NOT export those
# values to os.environ — so is_development() (APP_ENV) and emailer._is_en_site()
# (SITE_LANGUAGE) silently read nothing when a value lives only in .env,
# crashing dev startup (no JWT fallback key) and producing English RSS/Atom
# but Chinese email copy (or vice versa). load_dotenv() with its default
# override=False imports .env values and never clobbers an already-set process
# var, so process-env deployments and monkeypatch.setenv tests are unchanged.
# The explicit path mirrors pydantic's env_file=".env" (CWD-relative); the
# bare no-arg form would call find_dotenv(), which walks the call stack and
# asserts when spawned from stdin/without a file frame (round 433 probe).
load_dotenv(Path.cwd() / ".env")


def is_development() -> bool:
    """True when APP_ENV is explicitly set to a development value.

    Defaults to production semantics: unset APP_ENV is treated as production so
    that missing secrets fail closed instead of running with insecure defaults.
    """
    return os.getenv("APP_ENV", "production").lower() in ("development", "dev")


def is_dev_default_site_url(url: str) -> bool:
    """True when ``url`` is still the anonymous localhost development default.

    Feed items, sitemap <loc>s and email links are all built from
    settings.site_url (routers/rss.py, emailer.py) — a production deployment
    that forgets SITE_URL silently publishes ``http://localhost:3000`` as every
    absolute link, the same root-cause class as the frontend og:url build-time
    bake (TASK-557). main.py warns loudly at startup when a non-development run
    has a loopback origin (round 436).
    """
    host = url.split("://", 1)[-1] if "://" in url else url
    host = host.partition(":")[0]
    return host in ("localhost", "127.0.0.1")


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
    # extra="ignore" (round 433, ISS-636): BaseSettings otherwise defaults to
    # extra="forbid", so ANY undeclared key in .env (SMTP_HOST, APP_ENV,
    # JWT_SECRET_KEY, SITE_URL, ...) made Settings() itself raise at import —
    # a developer copying .env.example would find the backend refusing to
    # start. With ignore, undeclared keys pass through untouched; they are
    # still visible to the direct readers via load_dotenv() above (emailer
    # SMTP/SITE_LANGUAGE, auth JWT, is_development APP_ENV).
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
