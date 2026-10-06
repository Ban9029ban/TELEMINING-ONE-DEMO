# listener/app/backend_client.py
from __future__ import annotations

import os
import httpx
from typing import Any, Dict

from .schemas import TagBleFrame, TagRfidFrame


class BackendClient:
    """
    Cliente HTTP asíncrono para enviar lecturas BLE y RFID al backend TMOne.
    """

    def __init__(self) -> None:
        # URL base del backend, por defecto dentro de la red docker
        self.base_url = os.getenv(
            "BACKEND_BASE_URL",
            "http://zenit-backend:8000/api",  # coincide con tu backend en docker-compose
        ).rstrip("/")

    async def send_tag_ble(self, frame: TagBleFrame) -> Dict[str, Any]:
        """
        Envía un único frame BLE al backend.

        Endpoint destino:
        POST {BASE}/listener/tag-ble
        """
        url = f"{self.base_url}/listener/tag-ble"

        payload = {
            "bt_id": frame.bt_id,
            "signal": frame.signal,
            "ts_edge": frame.ts_edge.isoformat(),
            "backbone_code": frame.backbone_code,
            "edge_kind": frame.edge_kind,
            "edge_id": frame.edge_id,
            "rssi": frame.rssi,
            "raw_line": frame.raw_line,
        }

        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()

    async def send_tag_rfid(self, frame: TagRfidFrame) -> Dict[str, Any]:
        """
        Envía una lectura RFID UHF GAO/Impinj al backend.

        Endpoint destino:
        POST {BASE}/listener/tag-rfid
        """
        url = f"{self.base_url}/listener/tag-rfid"

        payload = {
            "epc": frame.epc,
            "signal": frame.signal,
            "ts_edge": frame.ts_edge.isoformat(),
            "reader_code": frame.reader_code,
            "reader_host": frame.reader_host,
            "antenna_port": frame.antenna_port,
            "antenna_name": frame.antenna_name,
            "rssi": frame.rssi,
            "tid": frame.tid,
            "frequency": frame.frequency,
            "phase_angle": frame.phase_angle,
            "transmit_power_cdbm": frame.transmit_power_cdbm,
            "raw_event": frame.raw_event,
        }

        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
