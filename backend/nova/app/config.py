from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./aurora.db"
    pool_size: int = 10
    pool_overflow: int = 20
    site_url: str = "http://localhost:3000"
    site_title: str = "X-Blog"
    site_description: str = "A modern blog built with FastAPI and Next.js"
    sentry_dsn: str | None = None
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
