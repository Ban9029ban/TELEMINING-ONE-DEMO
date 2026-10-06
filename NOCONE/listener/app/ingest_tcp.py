# listener/app/ingest_tcp.py
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from .config import settings
from .connections import registry, ConnectionInfo
from .schemas import ReceiverHeartbeatFrame, TagBleFrame, TagRfidFrame
from .backend_client import BackendClient
from .monitoring import monitor

logger = logging.getLogger("zenit.tcp")

backend_client = BackendClient()

MIN_SANE_YEAR = 2020


def _parse_ts_utc(ts_str: str) -> datetime:
    try:
        ts_edge = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if ts_edge.tzinfo is None:
            ts_edge = ts_edge.replace(tzinfo=timezone.utc)
        else:
            ts_edge = ts_edge.astimezone(timezone.utc)
        return ts_edge
    except Exception as e:
        raise ValueError(f"timestamp invalido: {ts_str}") from e


def _parse_optional_int(value: str) -> int | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(value)
    except Exception as e:
        raise ValueError(f"entero invalido: {value}") from e


def _parse_optional_float(value: str) -> float | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return float(value)
    except Exception as e:
        raise ValueError(f"float invalido: {value}") from e


def _parse_optional_bool(value: str) -> bool | None:
    value = (value or "").strip().lower()
    if not value:
        return None
    if value in {"1", "true", "yes", "si"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    raise ValueError(f"bool invalido: {value}")


def parse_ble_line(line: str) -> TagBleFrame:
    """
    Formato que llega desde el EDGE:

      AA:BB:CC:DD:EE:00:BT:2025-11-18T21:46:36:GW_BACKBONE_NORTE:EDGE_BASIC:TMONE_TTE_001:-60

    split(':') produce:

      0-5  -> MAC / bt_id
      6    -> signal ("BT")
      7-9  -> timestamp (YYYY-MM-DDTHH : MM : SS)
      10   -> backbone_code
      11   -> edge_kind
      12   -> edge_id (pórtico / edge)
      13   -> rssi
    """
    parts = line.strip().split(":")

    if len(parts) < 14:
        raise ValueError(f"trama demasiado corta, got {len(parts)}")

    bt_id = ":".join(parts[0:6])
    signal = parts[6]
    ts_str = f"{parts[7]}:{parts[8]}:{parts[9]}"

    backbone_code = parts[10]
    edge_kind = parts[11]
    edge_id = parts[12]
    rssi_str = parts[13]

    ts_edge = _parse_ts_utc(ts_str)

    try:
        rssi = int(rssi_str)
    except Exception as e:
        raise ValueError(f"RSSI invalido: {rssi_str}") from e

    return TagBleFrame(
        bt_id=bt_id,
        signal=signal,
        ts_edge=ts_edge,
        backbone_code=backbone_code,
        edge_kind=edge_kind,
        edge_id=edge_id,
        rssi=rssi,
        raw_line=line.strip(),
    )


def parse_rfid_line(line: str) -> TagRfidFrame:
    """
    Formato compacto enviado por sender->LoRa->receiver->TCP:

      RFID|<epc>|<ts>|<reader_code>|<reader_host>|<antenna_port>|<antenna_name>|<rssi>|<tid>|<frequency>|<phase_angle>|<tx_power>
    """
    parts = line.strip().split("|")
    if len(parts) < 12 or parts[0] != "RFID":
        raise ValueError("trama RFID invalida")

    epc = parts[1].strip()
    ts_str = parts[2].strip()
    reader_code = parts[3].strip()
    reader_host = parts[4].strip() or None

    if not epc:
        raise ValueError("EPC vacio")
    if not reader_code:
        raise ValueError("reader_code vacio")

    ts_edge = _parse_ts_utc(ts_str)

    return TagRfidFrame(
        epc=epc,
        signal="RFID_UHF",
        ts_edge=ts_edge,
        reader_code=reader_code,
        reader_host=reader_host,
        antenna_port=_parse_optional_int(parts[5]),
        antenna_name=parts[6].strip() or None,
        rssi=_parse_optional_int(parts[7]),
        tid=parts[8].strip() or None,
        frequency=_parse_optional_int(parts[9]),
        phase_angle=_parse_optional_float(parts[10]),
        transmit_power_cdbm=_parse_optional_int(parts[11]),
        raw_event={"transport": "lora_tcp", "raw_line": line.strip()},
    )


def parse_receiver_heartbeat_line(line: str) -> ReceiverHeartbeatFrame:
    """
    Heartbeat propio del receiver hacia el listener:

      RCV_HEARTBEAT|<receiver_id>|<backbone_code>|<transport_ip>|<queue_depth>|<tcp_fail_count>|
      <last_lora_rx_ms>|<linked_sender_id>|<link_age_ms>|<link_active>|<last_rssi>|<last_snr>|<listener_target>
    """
    parts = line.strip().split("|")
    if len(parts) < 10 or parts[0] != "RCV_HEARTBEAT":
        raise ValueError("heartbeat receiver invalido")

    receiver_id = parts[1].strip()
    backbone_code = parts[2].strip()
    transport_ip = parts[3].strip() or None

    if not receiver_id:
        raise ValueError("receiver_id vacio")
    if not backbone_code:
        raise ValueError("backbone_code vacio")

    return ReceiverHeartbeatFrame(
        receiver_id=receiver_id,
        backbone_code=backbone_code,
        transport_ip=transport_ip,
        queue_depth=_parse_optional_int(parts[4]) if len(parts) > 4 else None,
        tcp_fail_count=_parse_optional_int(parts[5]) if len(parts) > 5 else None,
        last_lora_rx_ms=_parse_optional_int(parts[6]) if len(parts) > 6 else None,
        linked_sender_id=(parts[7].strip() or None) if len(parts) > 7 else None,
        link_age_ms=_parse_optional_int(parts[8]) if len(parts) > 8 else None,
        link_active=_parse_optional_bool(parts[9]) if len(parts) > 9 else None,
        last_rssi=_parse_optional_int(parts[10]) if len(parts) > 10 else None,
        last_snr=_parse_optional_float(parts[11]) if len(parts) > 11 else None,
        listener_target=(parts[12].strip() or None) if len(parts) > 12 else None,
        raw_line=line.strip(),
    )


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    await serve_ble_stream(reader, writer)


async def serve_ble_stream(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    *,
    first_line: str | None = None,
):
    peer = writer.get_extra_info("peername")
    remote_addr = f"{peer[0]}:{peer[1]}" if peer else "unknown"
    conn_id = str(uuid.uuid4())

    info = ConnectionInfo(connection_id=conn_id, remote_addr=remote_addr)
    registry.add(info)
    logger.info(f"[{conn_id}] nueva conexion TCP desde {remote_addr}")

    try:
        if first_line:
            await process_ingest_line(first_line, conn_id=conn_id, remote_addr=remote_addr)

        while not reader.at_eof():
            raw = await reader.readline()
            if not raw:
                break

            line = raw.decode(errors="ignore").strip()
            if not line:
                continue

            await process_ingest_line(line, conn_id=conn_id, remote_addr=remote_addr)

    except Exception:
        logger.exception(f"[{conn_id}] error en conexion {remote_addr}")
    finally:
        registry.remove(conn_id)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        logger.info(f"[{conn_id}] conexion cerrada {remote_addr}")


async def _send_to_backend(frame: TagBleFrame, conn_id: str) -> None:
    try:
        resp = await backend_client.send_tag_ble(frame)
        # resp suele traer status (ok/dedup) y ids para debug
        logger.debug(f"[{conn_id}] backend resp: {resp}")
        monitor.record(
            channel="ble_backend",
            status="ok",
            summary=f"BLE guardado tag={frame.bt_id} edge={frame.edge_id or '-'}",
            extra={"response": resp, "rssi": frame.rssi, "edge_id": frame.edge_id},
        )
    except Exception as e:
        logger.error(f"[{conn_id}] error enviando al backend: {e}")
        monitor.record(
            channel="ble_backend",
            status="error",
            summary=f"Error guardando BLE tag={frame.bt_id}",
            extra={"error": str(e), "rssi": frame.rssi, "edge_id": frame.edge_id},
        )


async def _send_rfid_to_backend(frame: TagRfidFrame, conn_id: str, remote_addr: str) -> None:
    try:
        resp = await backend_client.send_tag_rfid(frame)
        ignored = isinstance(resp, dict) and bool(resp.get("ignored", False))
        stored = not isinstance(resp, dict) or bool(resp.get("stored", True))

        if ignored and not stored:
            monitor.record(
                channel="rfid_lora_backend",
                status="ignored",
                summary=f"RFID por LoRa ignorado epc={frame.epc}",
                remote_addr=remote_addr,
                extra={
                    "epc": frame.epc,
                    "reader_code": frame.reader_code,
                    "reader_host": frame.reader_host,
                    "antenna_port": frame.antenna_port,
                    "antenna_name": frame.antenna_name,
                    "rssi": frame.rssi,
                    "ts_edge": frame.ts_edge.isoformat(),
                    "reason": resp.get("reason"),
                },
            )
            return

        monitor.record(
            channel="rfid_lora_backend",
            status="ok",
            summary=f"RFID por LoRa guardado epc={frame.epc}",
            remote_addr=remote_addr,
            extra={
                "epc": frame.epc,
                "reader_code": frame.reader_code,
                "reader_host": frame.reader_host,
                "antenna_port": frame.antenna_port,
                "antenna_name": frame.antenna_name,
                "rssi": frame.rssi,
                "ts_edge": frame.ts_edge.isoformat(),
            },
        )
    except Exception as e:
        logger.error(f"[{conn_id}] error enviando RFID al backend: {e}")
        monitor.record(
            channel="rfid_lora_backend",
            status="error",
            summary=f"Error guardando RFID por LoRa epc={frame.epc}",
            remote_addr=remote_addr,
            extra={
                "epc": frame.epc,
                "reader_code": frame.reader_code,
                "reader_host": frame.reader_host,
                "antenna_port": frame.antenna_port,
                "antenna_name": frame.antenna_name,
                "rssi": frame.rssi,
                "ts_edge": frame.ts_edge.isoformat(),
                "error": str(e),
            },
        )


async def process_ble_line(line: str, *, conn_id: str, remote_addr: str = "unknown") -> bool:
    path = ["RX"]

    try:
        frame = parse_ble_line(line)
        path.append("PARSE_OK")
    except Exception as e:
        logger.warning(f"[{conn_id}] trama invalida: {e} :: {line!r}")
        monitor.record(
            channel="ble_ingest",
            status="error",
            summary="Trama BLE/LoRa inválida",
            remote_addr=remote_addr,
            payload=line,
            extra={"error": str(e)},
        )
        return False

    ts_source = "edge"
    if frame.ts_edge.year < MIN_SANE_YEAR:
        frame.ts_edge = datetime.now(timezone.utc)
        ts_source = "server_fallback"
    path.append("TS_OK")

    current = registry._conns.get(conn_id)
    total_frames = (current.total_frames + 1) if current else 1

    registry.update(
        conn_id,
        backbone_code=frame.backbone_code,
        last_edge_id=frame.edge_id,
        last_bt_id=frame.bt_id,
        last_seen=datetime.now(timezone.utc),
        total_frames=total_frames,
    )
    path.append("REGISTRY")

    logger.info(
        f"[{conn_id}] FRAME_OK bt={frame.bt_id} rssi={frame.rssi} "
        f"edge={frame.edge_id} gw={frame.backbone_code} kind={frame.edge_kind} "
        f"ts={frame.ts_edge.isoformat()} ts_src={ts_source} "
        f"path={'>'.join(path)}"
    )
    monitor.record(
        channel="ble_ingest",
        status="ok",
        summary=f"BLE/LoRa recibido tag={frame.bt_id} edge={frame.edge_id or '-'}",
        remote_addr=remote_addr,
        payload=line,
        extra={
            "backbone_code": frame.backbone_code,
            "edge_kind": frame.edge_kind,
            "edge_id": frame.edge_id,
            "rssi": frame.rssi,
            "ts_source": ts_source,
        },
    )
    asyncio.create_task(_send_to_backend(frame, conn_id))
    return True


async def process_rfid_line(line: str, *, conn_id: str, remote_addr: str = "unknown") -> bool:
    try:
        frame = parse_rfid_line(line)
    except Exception as e:
        logger.warning(f"[{conn_id}] trama RFID invalida: {e} :: {line!r}")
        monitor.record(
            channel="rfid_lora_ingest",
            status="error",
            summary="Trama RFID por LoRa invalida",
            remote_addr=remote_addr,
            payload=line,
            extra={"error": str(e)},
        )
        return False

    ts_source = "edge"
    if frame.ts_edge.year < MIN_SANE_YEAR:
        frame.ts_edge = datetime.now(timezone.utc)
        ts_source = "server_fallback"

    raw_event = dict(frame.raw_event or {})
    raw_event["transport_remote_addr"] = remote_addr
    frame.raw_event = raw_event

    current = registry._conns.get(conn_id)
    total_frames = (current.total_frames + 1) if current else 1

    registry.update(
        conn_id,
        backbone_code=frame.reader_code,
        last_edge_id=frame.reader_code,
        last_bt_id=frame.epc,
        last_seen=datetime.now(timezone.utc),
        total_frames=total_frames,
    )

    logger.info(
        f"[{conn_id}] RFID_LORA_OK epc={frame.epc} reader={frame.reader_code} "
        f"ant={frame.antenna_port or frame.antenna_name or '-'} rssi={frame.rssi} "
        f"ts={frame.ts_edge.isoformat()} ts_src={ts_source}"
    )
    monitor.record(
        channel="rfid_lora_ingest",
        status="ok",
        summary=f"RFID por LoRa recibido epc={frame.epc}",
        remote_addr=remote_addr,
        payload=line,
        extra={
            "reader_code": frame.reader_code,
            "reader_host": frame.reader_host,
            "antenna_port": frame.antenna_port,
            "antenna_name": frame.antenna_name,
            "rssi": frame.rssi,
            "ts_source": ts_source,
        },
    )
    # Registrar en el monitor al recibir: un EPC aún no asignado es una lectura
    # válida de radio, aunque el backend no deba persistirlo como acceso.
    monitor.record_rfid_read(
        epc=frame.epc,
        tid=frame.tid,
        reader_code=frame.reader_code,
        reader_host=frame.reader_host,
        antenna_port=frame.antenna_port,
        antenna_name=frame.antenna_name,
        rssi=frame.rssi,
        ts_edge=frame.ts_edge,
    )
    asyncio.create_task(_send_rfid_to_backend(frame, conn_id, remote_addr))
    return True


async def process_receiver_heartbeat_line(
    line: str,
    *,
    conn_id: str,
    remote_addr: str = "unknown",
) -> bool:
    try:
        frame = parse_receiver_heartbeat_line(line)
    except Exception as e:
        logger.warning(f"[{conn_id}] heartbeat receiver invalido: {e} :: {line!r}")
        monitor.record(
            channel="receiver_heartbeat",
            status="error",
            summary="Heartbeat receiver invalido",
            remote_addr=remote_addr,
            payload=line,
            extra={"error": str(e)},
        )
        return False

    current = registry._conns.get(conn_id)
    total_frames = (current.total_frames + 1) if current else 1

    registry.update(
        conn_id,
        backbone_code=frame.backbone_code,
        last_edge_id=frame.receiver_id,
        last_bt_id=frame.linked_sender_id,
        last_seen=datetime.now(timezone.utc),
        total_frames=total_frames,
    )

    monitor.record_receiver_heartbeat(
        receiver_id=frame.receiver_id,
        backbone_code=frame.backbone_code,
        remote_addr=remote_addr,
        transport_ip=frame.transport_ip,
        queue_depth=frame.queue_depth,
        tcp_fail_count=frame.tcp_fail_count,
        last_lora_rx_ms=frame.last_lora_rx_ms,
        linked_sender_id=frame.linked_sender_id,
        link_age_ms=frame.link_age_ms,
        link_active=frame.link_active,
        last_rssi=frame.last_rssi,
        last_snr=frame.last_snr,
        listener_target=frame.listener_target,
    )
    monitor.record(
        channel="receiver_heartbeat",
        status="ok",
        summary=f"Heartbeat receiver={frame.receiver_id}",
        remote_addr=remote_addr,
        payload=line,
        extra={
            "backbone_code": frame.backbone_code,
            "transport_ip": frame.transport_ip,
            "queue_depth": frame.queue_depth,
            "tcp_fail_count": frame.tcp_fail_count,
            "last_lora_rx_ms": frame.last_lora_rx_ms,
            "linked_sender_id": frame.linked_sender_id,
            "link_age_ms": frame.link_age_ms,
            "link_active": frame.link_active,
            "last_rssi": frame.last_rssi,
            "last_snr": frame.last_snr,
            "listener_target": frame.listener_target,
        },
    )
    logger.info(
        f"[{conn_id}] RECEIVER_HEARTBEAT receiver={frame.receiver_id} "
        f"sender={frame.linked_sender_id or '-'} queue={frame.queue_depth} "
        f"tcp_fails={frame.tcp_fail_count} lora_age_ms={frame.last_lora_rx_ms} "
        f"target={frame.listener_target or '-'}"
    )
    return True


async def process_firmware_log_line(line: str, *, conn_id: str, remote_addr: str = "unknown") -> bool:
    """Recibe diagnóstico opcional: LOG|SENDER/RECEIVER|id|nivel|mensaje."""
    parts = line.split("|", 4)
    if len(parts) != 5 or not parts[1].strip() or not parts[2].strip():
        monitor.record(channel="firmware_log", status="error", summary="Log de firmware inválido", remote_addr=remote_addr, payload=line)
        return False
    source, device_id, level, message = (part.strip() for part in parts[1:])
    monitor.record(
        channel="firmware_log",
        status="error" if level.upper() in {"ERROR", "FAIL"} else "ok",
        summary=f"{source.upper()} {device_id}: {message[:180]}",
        remote_addr=remote_addr,
        payload=line,
        extra={"source": source.upper(), "device_id": device_id, "level": level.upper(), "message": message[:500]},
    )
    return True


async def process_ingest_line(line: str, *, conn_id: str, remote_addr: str = "unknown") -> bool:
    if line.startswith("LOG|"):
        return await process_firmware_log_line(line, conn_id=conn_id, remote_addr=remote_addr)
    if line.startswith("RCV_HEARTBEAT|"):
        return await process_receiver_heartbeat_line(line, conn_id=conn_id, remote_addr=remote_addr)
    if line.startswith("RFID|"):
        return await process_rfid_line(line, conn_id=conn_id, remote_addr=remote_addr)
    return await process_ble_line(line, conn_id=conn_id, remote_addr=remote_addr)


async def start_tcp_server():
    server = await asyncio.start_server(handle_client, settings.tcp_host, settings.tcp_port)
    addrs = ", ".join(str(s.getsockname()) for s in server.sockets)
    logger.info(f"TCP listener escuchando en {addrs}")

    async with server:
        await server.serve_forever()
