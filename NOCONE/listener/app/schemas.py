# listener/app/schemas.py
from __future__ import annotations

from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Any, Dict


class TagBleFrame(BaseModel):
    """
    Trama que se envía al backend.
    Viene de la línea TCP:
    <bt_id>:BT:<TS>:<GW_BACKBONE>:<EDGE_KIND>:<EDGE_ID>:<RSSI>
    """
    bt_id: str
    signal: str = "BT"
    ts_edge: datetime

    backbone_code: str
    edge_kind: str
    edge_id: Optional[str] = None

    rssi: Optional[int] = None
    raw_line: Optional[str] = None


class TagRfidFrame(BaseModel):
    """
    Lectura UHF RFID proveniente de GAO / Impinj R700-R720.

    Se normaliza a un payload equivalente al BLE para que el backend grabe
    en las mismas tablas: tag, gateway y access_event.
    """
    epc: str
    signal: str = "RFID_UHF"
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


class ReceiverHeartbeatFrame(BaseModel):
    receiver_id: str
    backbone_code: str
    transport_ip: Optional[str] = None
    queue_depth: Optional[int] = None
    tcp_fail_count: Optional[int] = None
    last_lora_rx_ms: Optional[int] = None
    linked_sender_id: Optional[str] = None
    link_age_ms: Optional[int] = None
    link_active: Optional[bool] = None
    last_rssi: Optional[int] = None
    last_snr: Optional[float] = None
    listener_target: Optional[str] = None
    raw_line: Optional[str] = None


class ConnectionStatus(BaseModel):
    connection_id: str
    remote_addr: str
    backbone_code: Optional[str]
    last_edge_id: Optional[str]
    last_bt_id: Optional[str]
    last_seen: datetime
    total_frames: int


class ListenerStatus(BaseModel):
    tcp_host: str
    tcp_port: int
    active_connections: int
    accepted_connections: int
    connections: List[ConnectionStatus]
