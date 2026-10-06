# app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import computed_field, Field
from typing import List

class Settings(BaseSettings):
    # === App ===
    project_name: str = "Telemining ZENIT API"
    app_name: str = "Telemining ZENIT API"
    debug: bool = False

    # Prefijo base de la API
    api_prefix: str = "/api"

    # === CORS ===
    # Puedes llenar por .env como: CORS_ORIGINS='["http://localhost:3000","http://localhost:5173","http://localhost:8081"]'
    cors_origins: List[str] = [
        "http://localhost:8081",
        "http://localhost:8080",
        "http://localhost:3000",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:3000",
    ]

    # === Auth / Seguridad ===
    secret_key: str = "change_me_in_env"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # ------------------------------------------------------------
    # Ambiente
    #   develop/dev/development    -> usa DB del contenedor (zenit-db)
    #   produccion/prod/production -> usa DB real instalada en el host (CentOS)
    # ------------------------------------------------------------
    app_env: str = Field(default="develop", validation_alias="APP_ENV")

    # ============================================================
    # DB - Desarrollo (contenedor)
    # ============================================================
    # Puedes definir DB_* explícitamente, pero si no lo haces,
    # el sistema hace fallback a POSTGRES_* (del .env raíz).
    database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")
    db_user: str | None = None
    db_password: str | None = None
    db_host: str | None = None
    db_port: int | None = None
    db_name: str | None = None
    db_driver: str | None = None  # SQLAlchemy async

    # Fallback (variables del contenedor postgres / .env raíz)
    # Fallback DEV (variables del contenedor postgres / .env raíz).
    # POSTGRES_HOST_PORT no se usa aqui; solo expone el puerto al host.
    postgres_db: str = Field(default="zenit", validation_alias="POSTGRES_DB")
    postgres_user: str = Field(default="zenit", validation_alias="POSTGRES_USER")
    postgres_password: str = Field(default="zenitpass", validation_alias="POSTGRES_PASSWORD")
    postgres_host: str = Field(default="zenit-db", validation_alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, validation_alias="POSTGRES_PORT")

    # ============================================================
    # DB - Producción (Postgres real en el host)
    # ============================================================
    prod_db_user: str = Field(default="zenit", validation_alias="PROD_DB_USER")
    prod_db_password: str = Field(default="zenitpass", validation_alias="PROD_DB_PASSWORD")
    prod_db_host: str = Field(default="host.docker.internal", validation_alias="PROD_DB_HOST")
    prod_db_port: int = Field(default=5432, validation_alias="PROD_DB_PORT")
    prod_db_name: str = Field(default="zenit", validation_alias="PROD_DB_NAME")
    prod_db_driver: str = Field(default="asyncpg", validation_alias="PROD_DB_DRIVER")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",          # evita errores por variables .env no mapeadas
        case_sensitive=False,
    )

    @computed_field
    @property
    def normalized_app_env(self) -> str:
        return (self.app_env or "develop").strip().lower()

    @computed_field
    @property
    def is_production_env(self) -> bool:
        return self.normalized_app_env in {"produccion", "prod", "production"}

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        if self.database_url:
            return self.database_url

        if self.is_production_env:
            driver = self.prod_db_driver or "asyncpg"
            return (
                f"postgresql+{driver}://{self.prod_db_user}:{self.prod_db_password}"
                f"@{self.prod_db_host}:{self.prod_db_port}/{self.prod_db_name}"
            )

        # DEV
        driver = self.db_driver or "asyncpg"
        user = self.db_user or self.postgres_user
        password = self.db_password or self.postgres_password
        host = self.db_host or self.postgres_host
        port = self.db_port or self.postgres_port
        name = self.db_name or self.postgres_db

        return f"postgresql+{driver}://{user}:{password}@{host}:{port}/{name}"

    @computed_field
    @property
    def SQLALCHEMY_SYNC_URI(self) -> str:
        if self.database_url:
            return self.database_url.replace("+asyncpg", "")

        if self.is_production_env:
            return (
                f"postgresql://{self.prod_db_user}:{self.prod_db_password}"
                f"@{self.prod_db_host}:{self.prod_db_port}/{self.prod_db_name}"
            )

        user = self.db_user or self.postgres_user
        password = self.db_password or self.postgres_password
        host = self.db_host or self.postgres_host
        port = self.db_port or self.postgres_port
        name = self.db_name or self.postgres_db

        return f"postgresql://{user}:{password}@{host}:{port}/{name}"

settings = Settings()
