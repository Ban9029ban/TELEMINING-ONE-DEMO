from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "TeleminingAPI"
    DEBUG: bool = True
    DATABASE_URL: str = "sqlite:///./db.sqlite3"
    TIME_ZONE: str = "UTC"
    LANGUAGE_CODE: str = "es-CL"

    AZURE_API_KEY: str
    AZURE_URL: str
    AZURE_API_VERSION: str

    class Config:
        env_file = ".env"

settings = Settings()
