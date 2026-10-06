# listener/app/ingest_gao.py
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

import httpx

from .backend_client import BackendClient
from .config import settings
from .schemas import TagRfidFrame

logger = logging.getLogger("zenit.gao")
backend_client = BackendClient()
_HEX_RE = re.compile(r"^[0-9A-Fa-f]+$")
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")


class GaoReaderClient:
    """Cliente mínimo para GAO / Impinj R700-R720 IoT Device Interface."""

    def __init__(self, host: str) -> None:
        self.host = host.replace("http://", "").replace("https://", "").strip("/")
        self.scheme = "https" if settings.gao_use_https else "http"
        self.base_url = f"{self.scheme}://{self.host}/api/v1"
        self.auth = (settings.gao_username, settings.gao_password)

    async def post(self, path: str) -> None:
        async with httpx.AsyncClient(verify=settings.gao_verify_tls, timeout=10.0) as client:
            resp = await client.post(f"{self.base_url}{path}", auth=self.auth)
            resp.raise_for_status()

    async def start_inventory(self) -> None:
        preset = settings.gao_inventory_preset
        await self.post(f"/profiles/inventory/presets/{preset}/start")

    async def stop_inventory(self) -> None:
        await self.post("/profiles/stop")

    async def stream_events(self):
        timeout = httpx.Timeout(
            connect=10.0,
            read=float(settings.gao_stream_timeout_seconds),
            write=10.0,
            pool=10.0,
        )
        async with httpx.AsyncClient(verify=settings.gao_verify_tls, timeout=timeout) as client:
            async with client.stream("GET", f"{self.base_url}/data/stream", auth=self.auth) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        # keep-alive del reader
                        continue
                    yield line


def _extract_stream_payload(raw_line: str) -> Optional[str]:
    line = (raw_line or "").strip()
    if not line:
        return None
    if line.startswith(":"):
        return None
    if line.lower().startswith("event:"):
        return None
    if line.lower().startswith("data:"):
        _, _, line = line.partition(":")
        line = line.strip()
    return line or None


def _parse_ts(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        # El reader normalmente entrega UTC ISO-8601. Python acepta +00:00;
        # para Z reemplazamos manualmente.
        value = value.replace("Z", "+00:00")
        ts = datetime.fromisoformat(value)
        if ts.tzinfo is None:
            return ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _first_str(*values: Any) -> Optional[str]:
    for v in values:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return None


def _first_int(*values: Any) -> Optional[int]:
    for v in values:
        if v is None or v == "":
            continue
        try:
            return int(v)
        except Exception:
            continue
    return None


def _first_float(*values: Any) -> Optional[float]:
    for v in values:
        if v is None or v == "":
            continue
        try:
            return float(v)
        except Exception:
            continue
    return None


def _normalize_identifier(raw_value: Optional[str], *, min_base64_len: int = 16) -> Optional[str]:
    """Normaliza EPC/TID a hex legible.

    El reader puede enviar:
    - `epcHex` / `tidHex`: ya en hex
    - `epc` / `tid`: binario serializado en Base64 o Base64 URL-safe
    """
    if raw_value is None:
        return None

    value = str(raw_value).strip()
    if not value:
        return None

    if _HEX_RE.fullmatch(value) and len(value) % 2 == 0:
        return value.upper()

    if len(value) < min_base64_len or len(value) % 4 != 0 or not _BASE64_RE.fullmatch(value):
        return value

    padded = value + ("=" * (-len(value) % 4))

    try:
        decoded = base64.b64decode(padded, validate=True)
    except binascii.Error:
        try:
            decoded = base64.urlsafe_b64decode(padded)
        except Exception:
            return value
    except Exception:
        return value

    if not decoded:
        return value

    return decoded.hex().upper()


def _normalize_reader_rssi(raw_value: Optional[int]) -> Optional[int]:
    """Normaliza RSSI del reader a dBm entero.

    Impinj suele reportar `peakRssiCdbm` en centi-dBm (ej: -5300 => -53 dBm).
    Para BLE y otros casos donde ya viene en dBm, se deja tal cual.
    """
    if raw_value is None:
        return None
    if abs(raw_value) >= 1000:
        return int(round(raw_value / 100.0))
    return raw_value


def iter_gao_event_dicts(payload: Any) -> Iterable[Dict[str, Any]]:
    """Extrae uno o varios eventos RFID desde payloads webhook/stream flexibles."""
    queue = [payload]
    visited = 0

    while queue and visited < 2048:
        node = queue.pop(0)
        visited += 1

        if isinstance(node, list):
            queue.extend(item for item in node if isinstance(item, (dict, list)))
            continue

        if not isinstance(node, dict):
            continue

        if "tagInventoryEvent" in node or any(k in node for k in ("epc", "epcHex", "tid", "tidHex")):
            yield node
            continue

        for key in ("events", "eventReports", "records", "items", "messages", "payload", "data"):
            value = node.get(key)
            if isinstance(value, (dict, list)):
                queue.append(value)


def parse_gao_event(raw_event: Dict[str, Any], fallback_reader_code: str) -> Optional[TagRfidFrame]:
    """
    Convierte eventos Impinj IoT Device Interface a TagRfidFrame.

    Formato esperado por OpenAPI 1.4.0:
      {
        "hostname": "impinj-xx-xx-xx",
        "timestamp": "...",
        "tagInventoryEvent": {
          "epcHex": "...",
          "antennaPort": 1,
          "peakRssiCdbm": -5300,
          ...
        }
      }

    También tolera variantes planas para pruebas o firmware distinto.
    """
    inv = raw_event.get("tagInventoryEvent") or raw_event.get("tag") or raw_event
    if not isinstance(inv, dict):
        return None

    # Ignorar eventos no inventario: antennaConnectedEvent, diagnostics, status, etc.
    has_inventory_marker = "tagInventoryEvent" in raw_event or any(k in inv for k in ("epc", "epcHex", "tid", "tidHex"))
    if not has_inventory_marker:
        return None

    epc = _normalize_identifier(_first_str(
        inv.get("epcHex"),
        inv.get("epc"),
        raw_event.get("epcHex"),
        raw_event.get("epc"),
    ))
    if not epc:
        return None

    reader_host = _first_str(
        raw_event.get("readerHost"),
        raw_event.get("reader_host"),
        raw_event.get("reader_code"),
        raw_event.get("host"),
        fallback_reader_code,
    ) or fallback_reader_code
    reader_code = _first_str(
        raw_event.get("hostname"),
        raw_event.get("reader"),
        raw_event.get("reader_code"),
        inv.get("reader"),
        reader_host,
    ) or reader_host
    ts_edge = _parse_ts(
        _first_str(
            raw_event.get("ts_edge"),
            inv.get("timestamp"),
            inv.get("lastSeenTime"),
            inv.get("eventTimestamp"),
            raw_event.get("timestamp"),
            raw_event.get("eventTimestamp"),
        )
    )

    raw_rssi = _first_int(
        inv.get("peakRssiCdbm"),
        inv.get("peakRssi"),
        raw_event.get("peakRssiCdbm"),
        raw_event.get("rssi"),
    )

    return TagRfidFrame(
        epc=epc,
        signal="RFID_UHF",
        ts_edge=ts_edge,
        reader_code=reader_code,
        reader_host=reader_host,
        antenna_port=_first_int(inv.get("antennaPort"), raw_event.get("antennaPort"), raw_event.get("antenna_port")),
        antenna_name=_first_str(inv.get("antennaName"), raw_event.get("antennaName"), raw_event.get("antenna_name")),
        rssi=_normalize_reader_rssi(raw_rssi),
        tid=_normalize_identifier(
            _first_str(inv.get("tidHex"), inv.get("tid"), raw_event.get("tidHex"), raw_event.get("tid"))
        ),
        frequency=_first_int(inv.get("frequency"), raw_event.get("frequency")),
        phase_angle=_first_float(inv.get("phaseAngle"), raw_event.get("phaseAngle"), raw_event.get("phase_angle")),
        transmit_power_cdbm=_first_int(inv.get("transmitPowerCdbm"), raw_event.get("transmitPowerCdbm"), raw_event.get("transmit_power_cdbm")),
        raw_event=raw_event,
    )


async def _send_to_backend(frame: TagRfidFrame, reader_code: str) -> None:
    try:
        resp = await backend_client.send_tag_rfid(frame)
        logger.debug("[%s] backend resp RFID: %s", reader_code, resp)
    except Exception as exc:
        logger.error("[%s] error enviando RFID al backend: %s", reader_code, exc)


async def run_gao_reader(host: str) -> None:
    """Loop permanente de conexión/reconexión contra un reader GAO/Impinj."""
    client = GaoReaderClient(host)
    reader_code = client.host

    while True:
        try:
            logger.info("[%s] conectando GAO stream %s/data/stream", reader_code, client.base_url)

            if settings.gao_auto_start_inventory:
                logger.info("[%s] iniciando inventario preset=%s", reader_code, settings.gao_inventory_preset)
                await client.start_inventory()

            async for raw_line in client.stream_events():
                payload = _extract_stream_payload(raw_line)
                if payload is None:
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    logger.warning("[%s] evento no JSON: %r", reader_code, raw_line[:300])
                    continue

                if not isinstance(event, dict):
                    logger.debug("[%s] evento GAO ignorado por no ser objeto JSON", reader_code)
                    continue

                frame = parse_gao_event(event, fallback_reader_code=reader_code)
                if frame is None:
                    logger.debug("[%s] evento GAO no inventario: %s", reader_code, event.keys())
                    continue

                logger.info(
                    "[%s] RFID_OK epc=%s ant=%s rssi=%s ts=%s",
                    reader_code,
                    frame.epc,
                    frame.antenna_port or frame.antenna_name,
                    frame.rssi,
                    frame.ts_edge.isoformat(),
                )
                asyncio.create_task(_send_to_backend(frame, reader_code))

        except asyncio.CancelledError:
            logger.info("[%s] tarea GAO cancelada", reader_code)
            raise
        except Exception as exc:
            logger.error(
                "[%s] error GAO stream: %s; reconectando en %ss",
                reader_code,
                exc,
                settings.gao_reconnect_seconds,
            )
            await asyncio.sleep(settings.gao_reconnect_seconds)


async def start_gao_readers() -> list[asyncio.Task]:
    if not settings.gao_enabled:
        logger.info("GAO reader deshabilitado (GAO_READER_ENABLED=false)")
        return []

    if not settings.gao_event_stream_enabled:
        logger.info("GAO event stream deshabilitado; listener queda en modo webhook/ingestión pasiva")
        return []

    if not settings.gao_reader_hosts:
        logger.warning("GAO_READER_ENABLED=true pero no hay GAO_READER_HOSTS/GAO_READER_HOST configurado")
        return []

    tasks = [asyncio.create_task(run_gao_reader(host)) for host in settings.gao_reader_hosts]
    logger.info("GAO readers activos: %s", ", ".join(settings.gao_reader_hosts))
    return tasks
