# backend/app/schemas/tag_listener.py
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class TagBleIn(BaseModel):
    """
    Payload que envía el listener por cada lectura BLE.
    Debe calzar con el payload que arma BackendClient en el listener.
    """
    bt_id: str                      # AA:BB:CC:DD:EE:FF
    signal: str = Field(default="BT")
    ts_edge: datetime               # timestamp que viene del pórtico
    backbone_code: str              # ej: GW_BACKBONE_NORTE
    edge_kind: str                  # EDGE_BUS, EDGE_BASIC, etc.
    edge_id: Optional[str] = None   # BUS_001, PORTICO_01, etc.
    rssi: Optional[int] = None
    raw_line: Optional[str] = None  # trama cruda para auditoría


class TagRfidIn(BaseModel):
    """
    Payload que envía el listener por cada lectura RFID UHF GAO/Impinj.

    Se persiste en las mismas tablas que BLE:
      - tag.code = EPC normalizado
      - gateway.name = reader_code / hostname reader
      - access_event.kind = 'rfid'
      - access_event.signal = 'RFID_UHF'
    """
    epc: str
    signal: str = Field(default="RFID_UHF")
    ts_edge: datetime

    reader_code: str
    reader_host: Optional[str] = None
    antenna_port: Optional[int] = None
    antenna_name: Optional[str] = None

    rssi: Optional[int] = None
    tid: Optional[str] = None
    frequency: Optional[int] = None
    phase_angle: Optional[float] = None
    transmit_power_cdbm: Optional[int] = None

    raw_event: Optional[Dict[str, Any]] = None


class TagBleInResponse(BaseModel):
    status: str
    access_event_id: Optional[UUID] = None
