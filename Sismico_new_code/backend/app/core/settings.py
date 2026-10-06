from functools import lru_cache
from typing import Any, Dict, List
import os

from pydantic import BaseModel


def _to_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y", "on", "si")


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class Settings(BaseModel):
    APP_NAME: str = "Dashboard Sísmico"
    APP_VERSION: str = "0.4.0"
    APP_ENV: str = "local"
    DEBUG: bool = True
    API_PREFIX: str = "/api"
    LOG_LEVEL: str = "INFO"
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000
    DB_HOST: str = "db"
    DB_PORT: int = 5432
    DB_NAME: str = "dashboard_sismico"
    DB_USER: str = "admin"
    DB_PASSWORD: str = "admin"
    DB_ECHO: bool = False
    POSTGRES_HOST: str = ""
    POSTGRES_PORT: int = 0
    POSTGRES_DB: str = ""
    POSTGRES_USER: str = ""
    POSTGRES_PASSWORD: str = ""
    SECRET_KEY: str = "change-me-local-secret"
    JWT_SECRET_KEY: str = "change-me-local-jwt-secret"
    JWT_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS_RAW: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:15173,"
        "http://127.0.0.1:15173,"
        "http://devtm.denial.cl:15173,"
        "http://stagtm.denial.cl:15173,"
        "http://10.18.43.147:15173,"
        "http://localhost:19091,"
        "http://127.0.0.1:19091"
    )
    EXTERNAL_FETCH_TIMEOUT: int = 15
    EXTERNAL_FETCH_RETRIES: int = 2
    ENABLE_EXTERNAL_SOURCES: bool = True
    OLLAMA_ENABLED: bool = True
    OLLAMA_URL: str = "http://ollama:11434"
    OLLAMA_FAST_MODEL: str = ""
    OLLAMA_CHAT_MODEL: str = ""
    OLLAMA_TIMEOUT_SECONDS: int = 20
    OLLAMA_NUM_PREDICT: int = 220
    OLLAMA_KEEP_ALIVE: str = "5m"
    PLC_PYTHON_BIN: str = "python3"
    PLC_SCRIPT_PATH: str = "/app/tools/plcctl.py"
    PLC_DEFAULT_TYPE: str = "delta"
    PLC_DEFAULT_TIMEOUT_SECONDS: int = 20
    PLC_CONNECT_PROBE_TIMEOUT_SECONDS: float = 1.5
    PLC_POST_WRITE_DELAY_MS: int = 250
    PLC_DRY_RUN: bool = True
    PLC_ENABLED: bool = True
    PLC_RELAY_ROLE: str = "disabled"
    PLC_RELAY_TARGET_URL: str = ""
    PLC_RELAY_SHARED_TOKEN: str = ""
    PLC_RELAY_TIMEOUT_SECONDS: float = 8.0
    SEMAFORO_EMULATOR_URL: str = "http://semaforo_emulator_api:8000/api/emulator/semaforo/state"
    ENABLE_AI_AGENT: bool = True
    ENABLE_PRODUCTIVITY_MODULE: bool = True
    ENABLE_DET_ZONES: bool = True
    ENABLE_SCREEN_MONITOR: bool = True
    ENABLE_SEMAFORO_CONTROL: bool = True
    ENABLE_MANUAL_POLLING: bool = True

    @property
    def effective_db_host(self) -> str:
        return self.POSTGRES_HOST or self.DB_HOST

    @property
    def effective_db_port(self) -> int:
        return self.POSTGRES_PORT or self.DB_PORT

    @property
    def effective_db_name(self) -> str:
        return self.POSTGRES_DB or self.DB_NAME

    @property
    def effective_db_user(self) -> str:
        return self.POSTGRES_USER or self.DB_USER

    @property
    def effective_db_password(self) -> str:
        return self.POSTGRES_PASSWORD or self.DB_PASSWORD

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+psycopg2://{self.effective_db_user}:{self.effective_db_password}"
            f"@{self.effective_db_host}:{self.effective_db_port}/{self.effective_db_name}"
        )

    @property
    def CORS_ORIGINS(self) -> List[str]:
        return [item.strip() for item in self.CORS_ORIGINS_RAW.split(",") if item.strip()]

    @property
    def public_runtime_config(self) -> Dict[str, Any]:
        return {
            "appName": self.APP_NAME,
            "appVersion": self.APP_VERSION,
            "appEnv": self.APP_ENV,
            "debug": self.DEBUG,
            "externalSourcesEnabled": self.ENABLE_EXTERNAL_SOURCES,
            "ollamaEnabled": self.OLLAMA_ENABLED,
            "ollamaUrl": self.OLLAMA_URL,
            "ollamaFastModel": self.OLLAMA_FAST_MODEL,
            "ollamaChatModel": self.OLLAMA_CHAT_MODEL,
            "plcEnabled": self.PLC_ENABLED,
            "plcDryRun": self.PLC_DRY_RUN,
            "plcDefaultTimeoutSeconds": self.PLC_DEFAULT_TIMEOUT_SECONDS,
            "semaforoEmulatorUrl": self.SEMAFORO_EMULATOR_URL,
            "screenMonitorEnabled": self.ENABLE_SCREEN_MONITOR,
            "manualPollingEnabled": self.ENABLE_MANUAL_POLLING,
            "semaforoControlEnabled": self.ENABLE_SEMAFORO_CONTROL,
            "aiAgentEnabled": self.ENABLE_AI_AGENT,
            "productivityModuleEnabled": self.ENABLE_PRODUCTIVITY_MODULE,
            "detZonesEnabled": self.ENABLE_DET_ZONES,
            "apiPrefix": self.API_PREFIX,
        }

    @property
    def plc_enabled(self) -> bool:
        return self.PLC_ENABLED

    @property
    def plc_dry_run(self) -> bool:
        return self.PLC_DRY_RUN

    @property
    def plc_python_bin(self) -> str:
        return self.PLC_PYTHON_BIN or "python3"

    @property
    def plc_script_path(self) -> str:
        return self.PLC_SCRIPT_PATH or "/app/tools/plcctl.py"

    @property
    def plc_default_type(self) -> str:
        return self.PLC_DEFAULT_TYPE or "delta"

    @property
    def plc_default_timeout_seconds(self) -> int:
        return self.PLC_DEFAULT_TIMEOUT_SECONDS or 20

    @property
    def plc_connect_probe_timeout_seconds(self) -> float:
        return self.PLC_CONNECT_PROBE_TIMEOUT_SECONDS or 1.5

    @property
    def plc_post_write_delay_ms(self) -> int:
        return self.PLC_POST_WRITE_DELAY_MS or 250

    @property
    def semaforo_emulator_url(self) -> str:
        return self.SEMAFORO_EMULATOR_URL or "http://semaforo_emulator_api:8000/api/emulator/semaforo/state"

    @property
    def enable_external_sources(self) -> bool:
        return self.ENABLE_EXTERNAL_SOURCES

    @property
    def enable_screen_monitor(self) -> bool:
        return self.ENABLE_SCREEN_MONITOR

    @property
    def enable_manual_polling(self) -> bool:
        return self.ENABLE_MANUAL_POLLING

    @property
    def enable_semaforo_control(self) -> bool:
        return self.ENABLE_SEMAFORO_CONTROL

    @property
    def enable_ai_agent(self) -> bool:
        return self.ENABLE_AI_AGENT

    @property
    def ollama_enabled(self) -> bool:
        return self.OLLAMA_ENABLED

    @property
    def ollama_fast_model(self) -> str:
        return (self.OLLAMA_FAST_MODEL or self.OLLAMA_CHAT_MODEL or "").strip()

    @property
    def ollama_chat_model(self) -> str:
        return (self.OLLAMA_CHAT_MODEL or self.OLLAMA_FAST_MODEL or "").strip()

    @property
    def enable_productivity_module(self) -> bool:
        return self.ENABLE_PRODUCTIVITY_MODULE

    @property
    def enable_det_zones(self) -> bool:
        return self.ENABLE_DET_ZONES


@lru_cache
def get_settings() -> Settings:
    return Settings(
        APP_NAME=os.getenv("APP_NAME", "Dashboard Sísmico"),
        APP_VERSION=os.getenv("APP_VERSION", "0.3.0"),
        APP_ENV=os.getenv("APP_ENV", "local"),
        DEBUG=_to_bool(os.getenv("DEBUG", "true"), True),
        API_PREFIX=os.getenv("API_PREFIX", "/api"),
        LOG_LEVEL=os.getenv("LOG_LEVEL", "INFO"),
        BACKEND_HOST=os.getenv("BACKEND_HOST", "0.0.0.0"),
        BACKEND_PORT=_to_int(os.getenv("BACKEND_PORT", "8000"), 8000),
        DB_HOST=os.getenv("DB_HOST", "db"),
        DB_PORT=_to_int(os.getenv("DB_PORT", "5432"), 5432),
        DB_NAME=os.getenv("DB_NAME", "dashboard_sismico"),
        DB_USER=os.getenv("DB_USER", "admin"),
        DB_PASSWORD=os.getenv("DB_PASSWORD", "admin"),
        DB_ECHO=_to_bool(os.getenv("DB_ECHO", "false"), False),
        POSTGRES_HOST=os.getenv("POSTGRES_HOST", ""),
        POSTGRES_PORT=_to_int(os.getenv("POSTGRES_PORT", "0"), 0),
        POSTGRES_DB=os.getenv("POSTGRES_DB", ""),
        POSTGRES_USER=os.getenv("POSTGRES_USER", ""),
        POSTGRES_PASSWORD=os.getenv("POSTGRES_PASSWORD", ""),
        SECRET_KEY=os.getenv("SECRET_KEY", "change-me-local-secret"),
        JWT_SECRET_KEY=os.getenv("JWT_SECRET_KEY", "change-me-local-jwt-secret"),
        JWT_EXPIRE_MINUTES=_to_int(os.getenv("JWT_EXPIRE_MINUTES", "480"), 480),
        CORS_ORIGINS_RAW=os.getenv("CORS_ORIGINS_RAW", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:15173,http://127.0.0.1:15173"),
        EXTERNAL_FETCH_TIMEOUT=_to_int(os.getenv("EXTERNAL_FETCH_TIMEOUT", "15"), 15),
        EXTERNAL_FETCH_RETRIES=_to_int(os.getenv("EXTERNAL_FETCH_RETRIES", "2"), 2),
        ENABLE_EXTERNAL_SOURCES=_to_bool(os.getenv("ENABLE_EXTERNAL_SOURCES", "true"), True),
        OLLAMA_ENABLED=_to_bool(os.getenv("OLLAMA_ENABLED", "true"), True),
        OLLAMA_URL=os.getenv("OLLAMA_URL", "http://ollama:11434"),
        OLLAMA_FAST_MODEL=os.getenv("OLLAMA_FAST_MODEL", "").strip(),
        OLLAMA_CHAT_MODEL=os.getenv("OLLAMA_CHAT_MODEL", "").strip(),
        OLLAMA_TIMEOUT_SECONDS=_to_int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "20"), 20),
        OLLAMA_NUM_PREDICT=_to_int(os.getenv("OLLAMA_NUM_PREDICT", "220"), 220),
        OLLAMA_KEEP_ALIVE=os.getenv("OLLAMA_KEEP_ALIVE", "5m"),
        PLC_PYTHON_BIN=os.getenv("PLC_PYTHON_BIN", os.getenv("PLC_PYTHON", "python3")),
        PLC_SCRIPT_PATH=os.getenv("PLC_SCRIPT_PATH", "/app/tools/plcctl.py"),
        PLC_DEFAULT_TYPE=os.getenv("PLC_DEFAULT_TYPE", "delta"),
        PLC_DEFAULT_TIMEOUT_SECONDS=_to_int(os.getenv("PLC_DEFAULT_TIMEOUT_SECONDS", "20"), 20),
        PLC_CONNECT_PROBE_TIMEOUT_SECONDS=_to_float(os.getenv("PLC_CONNECT_PROBE_TIMEOUT_SECONDS", "1.5"), 1.5),
        PLC_POST_WRITE_DELAY_MS=_to_int(os.getenv("PLC_POST_WRITE_DELAY_MS", "250"), 250),
        PLC_DRY_RUN=_to_bool(os.getenv("PLC_DRY_RUN", "true"), True),
        PLC_ENABLED=_to_bool(os.getenv("PLC_ENABLED", "true"), True),
        PLC_RELAY_ROLE=os.getenv("PLC_RELAY_ROLE", "disabled").strip().lower(),
        PLC_RELAY_TARGET_URL=os.getenv("PLC_RELAY_TARGET_URL", "").strip(),
        PLC_RELAY_SHARED_TOKEN=os.getenv("PLC_RELAY_SHARED_TOKEN", ""),
        PLC_RELAY_TIMEOUT_SECONDS=_to_float(os.getenv("PLC_RELAY_TIMEOUT_SECONDS", "8"), 8.0),
        SEMAFORO_EMULATOR_URL=os.getenv("SEMAFORO_EMULATOR_URL", "http://semaforo_emulator_api:8000/api/emulator/semaforo/state"),
        ENABLE_AI_AGENT=_to_bool(os.getenv("ENABLE_AI_AGENT", "true"), True),
        ENABLE_PRODUCTIVITY_MODULE=_to_bool(os.getenv("ENABLE_PRODUCTIVITY_MODULE", "true"), True),
        ENABLE_DET_ZONES=_to_bool(os.getenv("ENABLE_DET_ZONES", "true"), True),
        ENABLE_SCREEN_MONITOR=_to_bool(os.getenv("ENABLE_SCREEN_MONITOR", "true"), True),
        ENABLE_SEMAFORO_CONTROL=_to_bool(os.getenv("ENABLE_SEMAFORO_CONTROL", "true"), True),
        ENABLE_MANUAL_POLLING=_to_bool(os.getenv("ENABLE_MANUAL_POLLING", "true"), True),
    )


settings = get_settings()
