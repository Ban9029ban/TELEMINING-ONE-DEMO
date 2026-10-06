# listener/app/config.py
import os
from dataclasses import dataclass, field
from typing import List


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on", "si", "sí"}


def _env_list(name: str, default: str = "") -> List[str]:
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]


@dataclass
class Settings:
    # IP referencial del servidor/listener dentro de la red de pruebas.
    # Cámbiala luego por la IP real del servidor donde corre docker.
    server_ip: str = os.getenv("TMONE_SERVER_IP", "192.168.100.10")

    # Web del listener (monitor, health, status). Va separada del puerto 7070.
    http_host: str = os.getenv("HTTP_HOST", "0.0.0.0")
    http_port: int = _env_int("HTTP_PORT", 8090)

    # Puerto unificado de ingestión:
    # - placas/receptores BLE/LoRa por línea TCP
    # - webhook HTTP del reader GAO/Impinj
    tcp_host: str = os.getenv("TCP_HOST", "0.0.0.0")
    tcp_port: int = _env_int("TCP_PORT", 7070)

    # URL base del backend dentro del docker-compose.
    backend_base_url: str = os.getenv(
        "BACKEND_BASE_URL",
        "http://zenit-backend:8000/api",
    )

    # GAO / Impinj R700-R720 IoT Device Interface.
    # Pedido: GAO activo por defecto con un reader inventado.
    gao_enabled: bool = _env_bool("GAO_READER_ENABLED", True)
    gao_reader_hosts: List[str] = field(
        default_factory=lambda: _env_list(
            "GAO_READER_HOSTS",
            os.getenv("GAO_READER_HOST", "192.168.100.50"),
        )
    )
    gao_username: str = os.getenv("GAO_READER_USERNAME", "root")
    gao_password: str = os.getenv("GAO_READER_PASSWORD", "impinj")
    gao_use_https: bool = _env_bool("GAO_READER_HTTPS", False)
    gao_verify_tls: bool = _env_bool("GAO_READER_VERIFY_TLS", False)
    gao_event_stream_enabled: bool = _env_bool("GAO_EVENT_STREAM_ENABLED", False)

    # Si true, el listener intenta iniciar inventario al conectar.
    # Lo dejo false para no forzar un preset inexistente; si tu reader tiene
    # preset "default", puedes activarlo por env.
    gao_auto_start_inventory: bool = _env_bool("GAO_AUTO_START_INVENTORY", False)
    gao_inventory_preset: str = os.getenv("GAO_INVENTORY_PRESET", "default")
    gao_reconnect_seconds: int = _env_int("GAO_RECONNECT_SECONDS", 5)
    gao_stream_timeout_seconds: int = _env_int("GAO_STREAM_TIMEOUT_SECONDS", 90)

    log_level: str = os.getenv("LOG_LEVEL", "INFO")


settings = Settings()
