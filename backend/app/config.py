from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./aurora.db"
    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
