from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
import httpx

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from .backend_client import BackendClient
from .config import settings
from .ingest_gao import iter_gao_event_dicts, parse_gao_event
from .connections import registry
from .monitoring import monitor

router = APIRouter()
logger = logging.getLogger("zenit.http")
backend_client = BackendClient()


class IngestPayload(BaseModel):
    source: str = Field(..., description="Origen: tag_ble | tag_rfid | gps | ur | camera | etc")
    ts: Optional[datetime] = Field(default=None, description="Timestamp del evento (opcional)")
    data: Dict[str, Any] = Field(default_factory=dict, description="Payload libre")


class ListenerLoginPayload(BaseModel):
    username: str
    password: str


async def require_listener_admin(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("tmone_listener_token")
    if not token:
        raise HTTPException(status_code=401, detail="Autenticacion de administrador requerida")
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(
                f"{settings.backend_base_url.rstrip('/')}/auth/me",
                headers={"Authorization": f"Bearer {token}"},
            )
        response.raise_for_status()
        user = response.json()
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Sesion invalida o vencida") from exc
    if str(user.get("role", "")).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="El monitor TMONE es solo para administradores")
    return user


async def _backend_json(path: str, *, method: str = "GET", payload: Any = None) -> Any:
    async with httpx.AsyncClient(timeout=6.0) as client:
        response = await client.request(method, f"{settings.backend_base_url.rstrip('/')}{path}", json=payload)
    response.raise_for_status()
    return response.json()


def _listener_base_url() -> str:
    return f"http://{settings.server_ip}:{settings.http_port}"


def _reader_stream_urls() -> list[str]:
    scheme = "https" if settings.gao_use_https else "http"
    return [f"{scheme}://{host}/api/v1/data/stream" for host in settings.gao_reader_hosts]


def decode_webhook_bytes(raw: bytes) -> Any:
    if not raw:
        raise HTTPException(status_code=400, detail="Payload vacío")

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        text_payload = raw.decode(errors="ignore").strip()
        if not text_payload:
            raise HTTPException(status_code=400, detail="Payload vacío")

        events = []
        for line in text_payload.splitlines():
            candidate = line.strip()
            if not candidate:
                continue
            if candidate.lower().startswith("data:"):
                _, _, candidate = candidate.partition(":")
                candidate = candidate.strip()
            try:
                events.append(json.loads(candidate))
            except json.JSONDecodeError:
                continue

        if events:
            return events

        raise HTTPException(
            status_code=400,
            detail="No se pudo interpretar el webhook del reader como JSON válido",
        )


async def _decode_webhook_payload(request: Request) -> Any:
    return decode_webhook_bytes(await request.body())


async def forward_impinj_webhook_payload(
    payload: Any,
    fallback_reader_code: str,
    *,
    remote_addr: Optional[str] = None,
    request_path: str = "/",
) -> Dict[str, Any]:
    candidate_events = list(iter_gao_event_dicts(payload))
    if not candidate_events and isinstance(payload, dict):
        candidate_events = [payload]

    frames = []
    ignored_events = 0
    for event in candidate_events:
        frame = parse_gao_event(event, fallback_reader_code=fallback_reader_code)
        if frame is None:
            ignored_events += 1
            continue
        frames.append(frame)

    if not frames:
        monitor.record(
            channel="rfid_webhook",
            status="ignored",
            summary="Webhook recibido sin eventos tagInventoryEvent/EPC",
            remote_addr=remote_addr,
            payload=json.dumps(payload, ensure_ascii=False)[:600] if payload is not None else None,
            extra={"path": request_path},
        )
        return {
            "received": True,
            "source": "impinj_webhook",
            "accepted": 0,
            "ignored": max(len(candidate_events), ignored_events),
            "detail": "No se detectaron eventos tagInventoryEvent/EPC en el payload",
        }

    accepted = 0
    ignored_by_backend = 0
    errors = []
    sample_epcs = [frame.epc for frame in frames[:5]]

    monitor.record(
        channel="rfid_webhook",
        status="ok",
        summary=f"Webhook RFID recibido eventos={len(frames)}",
        remote_addr=remote_addr,
        payload=json.dumps(payload, ensure_ascii=False)[:600] if payload is not None else None,
        extra={
            "path": request_path,
            "sample_epcs": sample_epcs,
            "reader_codes": sorted({frame.reader_code for frame in frames}),
        },
    )

    for frame in frames:
        try:
            backend_response = await backend_client.send_tag_rfid(frame)
            stored = not isinstance(backend_response, dict) or bool(backend_response.get("stored", True))
            ignored = isinstance(backend_response, dict) and bool(backend_response.get("ignored", False))

            if ignored and not stored:
                ignored_by_backend += 1
                monitor.record(
                    channel="rfid_backend",
                    status="ignored",
                    summary=f"RFID ignorado epc={frame.epc}",
                    remote_addr=remote_addr,
                    extra={
                        "epc": frame.epc,
                        "tid": frame.tid,
                        "reader_code": frame.reader_code,
                        "reader_host": frame.reader_host,
                        "antenna_port": frame.antenna_port,
                        "antenna_name": frame.antenna_name,
                        "rssi": frame.rssi,
                        "ts_edge": frame.ts_edge.isoformat(),
                        "reason": backend_response.get("reason"),
                    },
                )
                continue

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
            accepted += 1
            monitor.record(
                channel="rfid_backend",
                status="ok",
                summary=f"RFID guardado epc={frame.epc}",
                remote_addr=remote_addr,
                extra={
                    "epc": frame.epc,
                    "tid": frame.tid,
                    "reader_code": frame.reader_code,
                    "reader_host": frame.reader_host,
                    "antenna_port": frame.antenna_port,
                    "antenna_name": frame.antenna_name,
                    "rssi": frame.rssi,
                    "ts_edge": frame.ts_edge.isoformat(),
                },
            )
        except Exception as exc:
            logger.error(
                "Error reenviando webhook Impinj al backend epc=%s reader=%s: %s",
                frame.epc,
                frame.reader_code,
                exc,
            )
            errors.append(
                {
                    "epc": frame.epc,
                    "reader_code": frame.reader_code,
                    "error": str(exc),
                }
            )
            monitor.record(
                channel="rfid_backend",
                status="error",
                summary=f"Error guardando RFID epc={frame.epc}",
                remote_addr=remote_addr,
                extra={
                    "epc": frame.epc,
                    "tid": frame.tid,
                    "reader_code": frame.reader_code,
                    "reader_host": frame.reader_host,
                    "antenna_port": frame.antenna_port,
                    "antenna_name": frame.antenna_name,
                    "rssi": frame.rssi,
                    "ts_edge": frame.ts_edge.isoformat(),
                    "error": str(exc),
                },
            )

    if accepted == 0 and errors:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "El listener recibió el webhook, pero no pudo reenviar eventos RFID al backend",
                "errors": errors[:3],
            },
        )

    return {
        "received": True,
        "source": "impinj_webhook",
        "accepted": accepted,
        "ignored": ignored_events + ignored_by_backend,
        "failed": len(errors),
        "sample_epcs": sample_epcs,
        "reader_codes": sorted({frame.reader_code for frame in frames}),
        "errors": errors[:3],
    }


def listener_status_payload() -> Dict[str, Any]:
    connections = []
    for item in registry.snapshot():
        connections.append(
            {
                "connection_id": item.connection_id,
                "remote_addr": item.remote_addr,
                "backbone_code": item.backbone_code,
                "last_edge_id": item.last_edge_id,
                "last_bt_id": item.last_bt_id,
                "last_seen": item.last_seen.isoformat() if item.last_seen else None,
                "total_frames": item.total_frames,
            }
        )

    return {
        "listener": "ok",
        "ts": datetime.utcnow().isoformat(),
        "server_ip": settings.server_ip,
        "ingest_7070": {
            "host": settings.tcp_host,
            "port": settings.tcp_port,
            "accepts": ["ble_tcp_lines", "lora_tcp_lines", "rfid_tcp_lines", "impinj_http_webhook"],
        },
        "listener_web": {
            "host": settings.http_host,
            "port": settings.http_port,
            "base_url": _listener_base_url(),
        },
        "gao": {
            "enabled": settings.gao_enabled,
            "reader_hosts": settings.gao_reader_hosts,
            "https": settings.gao_use_https,
            "event_stream_enabled": settings.gao_event_stream_enabled,
            "auto_start_inventory": settings.gao_auto_start_inventory,
            "inventory_preset": settings.gao_inventory_preset,
            "pull_stream_urls": _reader_stream_urls(),
            "webhook_listener_root": f"http://{settings.server_ip}:{settings.tcp_port}/",
            "webhook_listener_rfid": f"http://{settings.server_ip}:{settings.tcp_port}/ingest/tag-rfid",
        },
        "backend_base_url": settings.backend_base_url,
        "monitor": {
            "uptime_seconds": monitor.uptime_seconds(),
            "counters": monitor.counters(),
            "active_connections": registry.count(),
            "accepted_connections": registry.accepted_total(),
        },
        "receivers": monitor.receiver_presence_payload(limit=50),
        "connections": connections,
    }


def listener_health_payload() -> Dict[str, Any]:
    return {
        "status": "ok",
        "listener": "tmone",
        "listener_web_url": _listener_base_url(),
        "ingest_port": settings.tcp_port,
        "gao_enabled": settings.gao_enabled,
        "gao_event_stream_enabled": settings.gao_event_stream_enabled,
        "gao_reader_hosts": settings.gao_reader_hosts,
        "impinj_webhook_url": f"http://{settings.server_ip}:{settings.tcp_port}/",
    }


def monitor_events_payload(limit: int = 120) -> Dict[str, Any]:
    safe_limit = max(1, min(limit, 500))
    return {
        "items": monitor.snapshot(safe_limit),
        "count": len(monitor.snapshot(safe_limit)),
        "counters": monitor.counters(),
        "uptime_seconds": monitor.uptime_seconds(),
    }


def monitor_rfid_summary_payload(limit: int = 120) -> Dict[str, Any]:
    safe_limit = max(1, min(limit, 500))
    items = monitor.rfid_rankings(safe_limit)
    return {
        "items": items,
        "count": len(items),
        "note": "Ordenado por RSSI mas alto arriba. Es una estimacion relativa de cercania, no metros exactos.",
        "ts": datetime.utcnow().isoformat(),
    }


def monitor_html() -> str:
    return f"""<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TMONE Listener Monitor</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f3f5f7; color: #10202e; }}
    .wrap {{ max-width: 1640px; margin: 0 auto; padding: 24px 32px; }}
    .hero {{ background: linear-gradient(135deg, #0f2940, #1d5b82); color: white; padding: 24px; border-radius: 20px; }}
    .hero-head {{ display:flex; align-items:center; gap:20px; }}
    .hero-logo {{ width:190px; max-height:70px; object-fit:contain; object-position:left center; background:white; padding:8px 12px; border-radius:12px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap: 12px; margin-top: 18px; }}
    .card {{ background: white; border-radius: 18px; padding: 16px; box-shadow: 0 10px 30px rgba(16,32,46,.08); }}
    .label {{ font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #5b7287; }}
    .value {{ font-size: 26px; font-weight: 700; margin-top: 8px; }}
    .sub {{ font-size: 13px; color: #607789; margin-top: 6px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
    th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5ebf0; vertical-align: top; }}
    th {{ font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #607789; }}
    .ok {{ color: #0f8a4b; font-weight: 700; }}
    .error {{ color: #bf1f47; font-weight: 700; }}
    .ignored {{ color: #946200; font-weight: 700; }}
    .stale {{ color: #946200; font-weight: 700; }}
    .mono {{ font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; word-break: break-word; }}
    .bar {{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin:18px 0; }}
    button {{ border: 0; border-radius: 12px; background: #174e73; color:white; padding: 10px 14px; font-weight: 700; cursor: pointer; }}
    code {{ background:#eef3f7; padding:2px 6px; border-radius:6px; }}
    .hint {{ font-size: 13px; color: #607789; margin-top: 10px; }}
    .pill {{ display:inline-block; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:700; background:#edf4fa; color:#174e73; }}
    .rank-top td {{ background: rgba(15,138,75,.06); }}
    .empty {{ color:#607789; font-style: italic; }}
    .guide {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin-top:12px; }}
    .guide-item {{ border-left:4px solid #174e73; background:#f7fafc; padding:10px 12px; border-radius:8px; }}
    .guide-item.warn {{ border-color:#946200; }}
    .guide-item.ok {{ border-color:#0f8a4b; }}
    details summary {{ cursor:pointer; color:#174e73; font-weight:600; }}
    .action {{ padding:6px 9px; margin:2px; border-radius:8px; font-size:12px; }}
    .modal {{ display:none; position:fixed; inset:0; background:rgba(15,41,64,.45); z-index:10; padding:5vh 5vw; }}
    .modal.open {{ display:block; }}
    .modal-box {{ background:white; max-width:980px; max-height:90vh; overflow:auto; margin:auto; padding:20px; border-radius:16px; }}
    .log-columns {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(360px,1fr)); gap:14px; }}
    .log-box {{ background:#10202e; color:#e8f0f6; border-radius:10px; padding:12px; min-height:160px; white-space:pre-wrap; font:12px ui-monospace,monospace; }}
    .config-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(270px,1fr)); gap:14px; margin-top:16px; }}
    .config-group {{ border:1px solid #dce6ed; border-radius:12px; padding:14px; }}
    .config-group h3 {{ font-size:14px; margin:0 0 10px; color:#174e73; }}
    .config-field {{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin:8px 0; font-size:13px; }}
    .config-field input {{ width:132px; padding:6px 8px; border:1px solid #cddae3; border-radius:7px; background:#f5f8fa; color:#42596b; }}
    .config-group input[type="checkbox"] {{ width:auto; }}
    @media (max-width:700px) {{ .wrap {{ padding:14px; }} .hero-head {{ align-items:flex-start; flex-direction:column; }} .hero-logo {{ width:160px; }} }}
    .nearest {{ display:flex; align-items:center; gap:18px; flex-wrap:wrap; }}
    .nearest-signal {{ min-width:150px; padding:14px 18px; border-radius:14px; background:#eaf7ef; color:#08763e; }}
    .nearest-signal.warn {{ background:#fff6df; color:#946200; }}
    .nearest-signal.stale {{ background:#f0f3f5; color:#607789; }}
    .nearest-value {{ font-size:30px; font-weight:800; }}
    .meter {{ width:220px; height:10px; border-radius:999px; overflow:hidden; background:#e5ebf0; }}
    .meter > span {{ display:block; height:100%; background:#0f8a4b; border-radius:inherit; }}
    .meter.warn > span {{ background:#d18a00; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="hero-head">
        <img class="hero-logo" src="/assets/telemining-logo.png" alt="Telemining">
        <div><div class="label">TMONE Listener Monitor</div>
      <div class="value">Puerto ingestión <code>{settings.tcp_port}</code> · Web monitor <code>{settings.http_port}</code></div>
      <div class="sub">Recibe BLE/LoRa por TCP y webhook HTTP del reader GAO/Impinj en el mismo <code>{settings.tcp_port}</code>.</div></div>
      </div>
    </div>

    <div class="bar">
      <div class="sub">Refresco automático cada 3 segundos</div>
      <button onclick="loadAll()">Refrescar ahora</button>
    </div>

    <div id="stats" class="grid"></div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Tag más cercano detectado</div>
      <div id="nearest-rfid" class="sub" style="margin-top:12px;">Esperando lecturas RFID…</div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Cómo leer esta pantalla</div>
      <div class="guide">
        <div class="guide-item ok"><b>RFID recibido</b><br><span class="sub">La radio, el receiver y el listener funcionan.</span></div>
        <div class="guide-item warn"><b>RFID sin asignar</b><br><span class="sub">El EPC llegó, pero no pertenece a una persona o equipo activo.</span></div>
        <div class="guide-item"><b>Guardado backend</b><br><span class="sub">Quedó como evento de acceso y puede aparecer en el pórtico.</span></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Configuración útil</div>
      <div id="config" class="sub" style="margin-top:10px;"></div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Receivers visibles</div>
      <div class="hint">Cada receiver manda un pulso TCP propio aunque no reciba LoRa. Asi podemos ver si esta vivo, con que sender esta enlazado y a que listener cree estar enviando.</div>
      <div style="overflow:auto; margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>Estado</th>
              <th>Receiver</th>
              <th>Backbone</th>
              <th>IP transporte</th>
              <th>Sender LoRa</th>
              <th>Edad enlace</th>
              <th>Ultimo LoRa RX</th>
              <th>Cola</th>
              <th>TCP fails</th>
              <th>Destino listener</th>
              <th>Ultimo pulso</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="receivers"></tbody>
        </table>
      </div>
    </div>

    <div id="diagnostic-modal" class="modal" onclick="if(event.target===this) closeModal()">
      <div class="modal-box">
        <div class="bar"><div><div class="label">Diagnóstico TMONE</div><div id="diagnostic-title" class="value" style="font-size:20px"></div></div><button onclick="closeModal()">Cerrar</button></div>
        <div class="log-columns"><div><b>Sender</b><div id="sender-logs" class="log-box"></div></div><div><b>Receiver</b><div id="receiver-logs" class="log-box"></div></div></div>
      </div>
    </div>
    <div id="tag-modal" class="modal" onclick="if(event.target===this) closeModal()"><div class="modal-box" style="max-width:560px"><div class="bar"><div><div class="label">Asignación RFID</div><div id="tag-modal-epc" class="mono"></div></div><button onclick="closeModal()">Cerrar</button></div><p id="tag-current" class="sub"></p><label class="sub">Tipo</label><select id="tag-type" onchange="loadAssignableEntities()" style="width:100%;padding:10px;margin:6px 0"><option value="">Ninguno</option><option value="person">Persona</option><option value="vehicle">Vehículo</option><option value="equipment">Equipo</option></select><label class="sub">Empresa</label><select id="tag-company" onchange="filterAssignableEntities()" style="width:100%;padding:10px;margin:6px 0"><option value="">Todas las empresas</option></select><input id="tag-search" oninput="filterAssignableEntities()" placeholder="Buscar por nombre, patente o código" style="width:100%;box-sizing:border-box;padding:10px;margin:6px 0"><label class="sub">Asignar a</label><select id="tag-person" style="width:100%;padding:10px;margin:6px 0"><option value="">Ninguno</option></select><div id="tag-error" class="error"></div><button onclick="saveTagAssignment()">Guardar asignación</button></div></div>
    <div id="config-modal" class="modal" onclick="if(event.target===this) closeModal()">
      <div class="modal-box"><div class="bar"><div><div class="label">Configuración remota TMONE</div><div id="config-title" class="value" style="font-size:20px"></div></div><button onclick="closeModal()">Cerrar</button></div>
        <p class="sub">Los parámetros se enviarán al receiver cuando esté cargado el firmware de configuración remota.</p>
        <div class="config-grid">
          <section class="config-group"><h3>Identidad y diagnóstico</h3><label class="config-field">PAIR ID <input value="0001" disabled></label><label class="config-field">Serial <input type="checkbox" checked disabled></label><label class="config-field">Logs HTTP <input type="checkbox" checked disabled></label><label class="config-field">Modo prueba <input type="checkbox" disabled></label></section>
          <section class="config-group"><h3>Radio LoRa</h3><label class="config-field">Frecuencia <input value="433000000" disabled></label><label class="config-field">Spreading factor <input value="7" disabled></label><label class="config-field">Bandwidth Hz <input value="125000" disabled></label><label class="config-field">Coding rate <input value="4/5" disabled></label><label class="config-field">Sync word <input value="0x12" disabled></label><label class="config-field">Potencia TX dBm <input value="14" disabled></label></section>
          <section class="config-group"><h3>Enlace LoRa</h3><label class="config-field">Búsqueda pareja ms <input value="1000" disabled></label><label class="config-field">Heartbeat LoRa ms <input value="5000" disabled></label><label class="config-field">Timeout enlace ms <input value="65000" disabled></label><label class="config-field">Recuperación ms <input value="10000" disabled></label><label class="config-field">Espera encendido ms <input value="2500" disabled></label></section>
          <section class="config-group"><h3>Sender</h3><label class="config-field">Ethernet <input type="checkbox" checked disabled></label><label class="config-field">Wi-Fi <input type="checkbox" disabled></label><label class="config-field">Escaneo BLE <input type="checkbox" disabled></label><label class="config-field">GAO webhook <input type="checkbox" checked disabled></label><label class="config-field">GAO pull <input type="checkbox" checked disabled></label><label class="config-field">Inventario auto <input type="checkbox" disabled></label><label class="config-field">Ventana red ms <input value="45000" disabled></label><label class="config-field">Ventana LoRa ms <input value="45000" disabled></label></section>
          <section class="config-group"><h3>Receiver y red</h3><label class="config-field">Ethernet <input type="checkbox" checked disabled></label><label class="config-field">Wi-Fi respaldo <input type="checkbox" disabled></label><label class="config-field">BLE local <input type="checkbox" disabled></label><label class="config-field">Sensores <input type="checkbox" disabled></label><label class="config-field">Tarjeta SD <input type="checkbox" disabled></label><label class="config-field">Heartbeat TCP ms <input value="5000" disabled></label><label class="config-field">Backoff TCP ms <input value="1200 - 8000" disabled></label><label class="config-field">Cola tramas <input value="96" disabled></label></section>
          <section class="config-group"><h3>Destino listener</h3><label class="config-field">Host <input value="192.168.100.10" disabled></label><label class="config-field">Puerto TCP <input value="7070" disabled></label><label class="config-field">SPI LoRa Hz <input value="2000000" disabled></label><label class="config-field">Diagnóstico LoRa <input type="checkbox" disabled></label><label class="config-field">Bajo consumo <input type="checkbox" disabled></label></section>
        </div>
        <div class="bar"><span class="sub">Lectura actual del perfil de firmware TMONE v7.</span><button disabled title="Pendiente de protocolo en firmware">Guardar y reiniciar placa</button></div>
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Acumulado RFID</div>
      <div class="hint">Agrupa por EPC/RFID y ordena por RSSI mas alto arriba. Sirve para detectar cual tag esta mas cerca de la antena. La proximidad es relativa; no son metros exactos.</div>
      <div style="overflow:auto; margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>RFID / EPC</th>
              <th>Lecturas</th>
              <th>Proximidad</th>
              <th>RSSI actual</th>
              <th>Mejor RSSI</th>
              <th>Prom RSSI</th>
              <th>Antena</th>
              <th>Reader</th>
              <th>Ultima lectura</th>
            </tr>
          </thead>
          <tbody id="rfid-summary"></tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:18px;">
      <div class="label">Eventos recientes</div>
      <div style="overflow:auto; margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Canal</th>
              <th>Estado</th>
              <th>Resumen</th>
              <th>Origen</th>
              <th>Detalle técnico</th>
            </tr>
          </thead>
          <tbody id="events"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    function esc(value) {{
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }}

    function renderStats(status, events) {{
      const counters = status.monitor?.counters || {{}};
      const tcpValidFrames =
        (counters["ble_ingest:ok"] ?? 0) +
        (counters["rfid_lora_ingest:ok"] ?? 0);
      const cards = [
        ["Receivers vivos", status.receivers?.active_count ?? 0, "Receivers con heartbeat reciente aunque no tengan RFID"],
        ["Heartbeats RX", counters["receiver_heartbeat:ok"] ?? 0, "Pulsos TCP recibidos desde receivers"],
        ["TCP activas", status.monitor?.active_connections ?? 0, "Conexiones raw abiertas ahora en 7070"],
        ["TCP acumuladas", status.monitor?.accepted_connections ?? 0, "Conexiones recibidas desde que inició el listener"],
        ["TCP 7070 válidos", tcpValidFrames, "BLE o RFID por LoRa recibidos en 7070"],
        ["RFID webhook recibidos", counters["rfid_webhook:ok"] ?? 0, "POST HTTP válidos desde reader"],
        ["RFID recibidos por LoRa", counters["rfid_lora_ingest:ok"] ?? 0, "Lecturas que llegaron al listener, estén o no registradas"],
        ["Guardados backend", (counters["ble_backend:ok"] ?? 0) + (counters["rfid_backend:ok"] ?? 0) + (counters["rfid_lora_backend:ok"] ?? 0), "Eventos RFID/BLE persistidos correctamente"],
        ["RFID sin asignar", (counters["rfid_backend:ignored"] ?? 0) + (counters["rfid_lora_backend:ignored"] ?? 0), "Llegaron, pero el EPC no está registrado o asignado"],
        ["Errores backend", (counters["ble_backend:error"] ?? 0) + (counters["rfid_backend:error"] ?? 0) + (counters["rfid_lora_backend:error"] ?? 0), "Fallos reenviando al backend"],
        ["Uptime", status.monitor?.uptime_seconds ?? 0, "Segundos desde que inició el listener"],
      ];
      document.getElementById("stats").innerHTML = cards.map(([label, value, sub]) => `
        <div class="card">
          <div class="label">${{esc(label)}}</div>
          <div class="value">${{esc(value)}}</div>
          <div class="sub">${{esc(sub)}}</div>
        </div>
      `).join("");

      const config = [
        `Webhook Impinj en <code>http://{settings.server_ip}:{settings.tcp_port}/</code>`,
        `Web monitor en <code>{_listener_base_url()}</code>`,
        `Backend destino <code>${{esc(status.backend_base_url || "-")}}</code>`,
        `TTL de presencia receiver: <code>${{esc(status.receivers?.ttl_seconds ?? 0)}} s</code>`,
        `Event Stream activo en listener: <code>${{esc(status.gao?.event_stream_enabled ? "sí" : "no")}}</code>`,
      ];
      document.getElementById("config").innerHTML = config.join("<br>");
    }}

    function fmtMs(value, fallback = "-") {{
      return value != null && value !== "" ? `${{esc(value)}} ms` : fallback;
    }}

    // Usa la fecha, hora y zona horaria configuradas en el equipo que abre el monitor.
    function fmtDate(value, fallback = "-") {{
      if (!value) return fallback;
      const date = new Date(value);
      return Number.isNaN(date.getTime())
        ? esc(value)
        : esc(date.toLocaleString("es-CL", {{ dateStyle: "short", timeStyle: "medium" }}));
    }}

    function rfidAgeSeconds(value) {{
      const time = new Date(value || 0).getTime();
      return Number.isFinite(time) ? Math.max(0, Math.round((Date.now() - time) / 1000)) : null;
    }}

    function fmtAge(seconds) {{
      if (seconds == null) return "sin hora de recepción";
      if (seconds < 60) return `hace ${{seconds}} s`;
      return `hace ${{Math.floor(seconds / 60)}} min`;
    }}

    function renderNearestRfid(items) {{
      const target = document.getElementById("nearest-rfid");
      if (!items || items.length === 0) {{
        target.textContent = "Aún no hay tags RFID recibidos en esta sesión.";
        return;
      }}
      const freshest = [...items].sort((a, b) => {{
        const ageA = rfidAgeSeconds(a.last_received_at || a.last_seen_at);
        const ageB = rfidAgeSeconds(b.last_received_at || b.last_seen_at);
        const recentA = ageA != null && ageA <= 30;
        const recentB = ageB != null && ageB <= 30;
        if (recentA !== recentB) return recentA ? -1 : 1;
        const signalA = a.latest_rssi ?? -999;
        const signalB = b.latest_rssi ?? -999;
        return signalB - signalA;
      }})[0];
      const rssi = freshest.latest_rssi;
      const age = rfidAgeSeconds(freshest.last_received_at || freshest.last_seen_at);
      const isFresh = age != null && age <= 30;
      const signalClass = !isFresh ? "stale" : (rssi != null && rssi >= -65 ? "" : "warn");
      const label = !isFresh ? "Lectura antigua" : (freshest.proximity_hint || "Sin RSSI");
      const pct = rssi == null ? 0 : Math.max(4, Math.min(100, Math.round(((rssi + 90) / 50) * 100)));
      target.innerHTML = `
        <div class="nearest">
          <div class="nearest-signal ${{signalClass}}">
            <div>${{esc(label)}}</div>
            <div class="nearest-value">${{rssi != null ? `${{esc(rssi)}} dBm` : "-"}}</div>
          </div>
          <div>
            <div class="mono">${{esc(freshest.epc || "-")}}</div>
            <div class="sub">${{isFresh ? "Recibido recién" : "No usar como presencia actual: recibido"}} ${{esc(fmtAge(age))}} · Puerto ${{esc(freshest.antenna_port ?? "-")}}</div><div id="nearest-assignment" class="sub">Consultando asignación…</div><button class="action" onclick="openTagAssignment('${{esc(freshest.epc || "")}}')">Asignar a…</button>
            <div class="meter ${{signalClass}}" style="margin-top:9px"><span style="width:${{pct}}%"></span></div>
          </div>
        </div>`;
      refreshTagAssignment(freshest.epc).catch(() => {{ const el = document.getElementById('nearest-assignment'); if (el) el.textContent = 'No se pudo consultar asignación'; }});
    }}

    function renderReceivers(items) {{
      const tbody = document.getElementById("receivers");
      if (!items || items.length === 0) {{
        tbody.innerHTML = `
          <tr>
            <td colspan="12" class="empty">Aun no llegaron heartbeats de receivers a este listener.</td>
          </tr>
        `;
        return;
      }}

      tbody.innerHTML = items.map((item) => {{
        const stateClass = item.is_active ? "ok" : "stale";
        const stateLabel = item.is_active ? "Activo" : "Sin pulso";
        const senderText = item.linked_sender_id || "Sin sender";
        const senderMeta = (item.last_rssi != null || item.last_snr != null)
          ? `<div class="sub">RSSI ${{item.last_rssi ?? "-"}} / SNR ${{item.last_snr ?? "-"}}</div>`
          : "";
        return `
          <tr>
            <td class="${{stateClass}}">${{esc(stateLabel)}}</td>
            <td>
              <div class="mono">${{esc(item.receiver_id || "-")}}</div>
              <div class="sub">visto hace ${{esc(item.age_seconds ?? "-")}} s</div>
            </td>
            <td>${{esc(item.backbone_code || "-")}}</td>
            <td>${{esc(item.transport_ip || item.remote_addr || "-")}}</td>
            <td>
              <div>${{esc(senderText)}}</div>
              ${{senderMeta}}
            </td>
            <td>${{item.link_active === false ? "Sin enlace" : fmtMs(item.link_age_ms, "Sin enlace")}}</td>
            <td>${{fmtMs(item.last_lora_rx_ms, "Sin RX aun")}}</td>
            <td>${{esc(item.queue_depth ?? "-")}}</td>
            <td>${{esc(item.tcp_fail_count ?? "-")}}</td>
            <td><code>${{esc(item.listener_target || "-")}}</code></td>
            <td>${{fmtDate(item.last_seen_at)}}</td>
            <td><button class="action" onclick="showDiagnostics('${{esc(item.receiver_id || "")}}')">Logs</button><button class="action" onclick="showConfig('${{esc(item.receiver_id || "")}}')">Configuración</button></td>
          </tr>
        `;
      }}).join("");
    }}

    let latestEvents = [];
    function closeModal() {{ document.querySelectorAll('.modal').forEach(node => node.classList.remove('open')); }}
    function showDiagnostics(receiverId) {{
      document.getElementById('diagnostic-title').textContent = receiverId;
      const logs = latestEvents.filter(item => item.channel === 'firmware_log');
      const render = source => logs.filter(item => item.extra?.source === source).map(item => `[${{fmtDate(item.ts)}}] ${{item.extra?.level || '-'}} ${{item.extra?.message || item.summary}}`).join('\\n') || 'Sin logs recibidos aún.';
      document.getElementById('sender-logs').textContent = render('SENDER');
      document.getElementById('receiver-logs').textContent = render('RECEIVER');
      document.getElementById('diagnostic-modal').classList.add('open');
    }}
    function showConfig(receiverId) {{ document.getElementById('config-title').textContent = receiverId; document.getElementById('config-modal').classList.add('open'); }}
    async function refreshTagAssignment(epc) {{ const data = await fetch(`/tag-assignment?epc=${{encodeURIComponent(epc)}}`).then(r => r.json()); const target = document.getElementById('nearest-assignment'); if (target) target.textContent = data.assigned_to ? `Asignado a: ${{data.assigned_to}}` : 'Sin asignación'; return data; }}
    let assignableEntities = [];
    async function openTagAssignment(epc) {{ const current = await refreshTagAssignment(epc); const companies = await fetch('/assignable-companies').then(r => r.json()); document.getElementById('tag-modal-epc').textContent = epc; document.getElementById('tag-current').textContent = current.assigned_to ? `Actualmente asignado a: ${{current.assigned_to}}` : 'Este tag no está asignado.'; document.getElementById('tag-company').innerHTML = '<option value="">Todas las empresas</option>' + companies.map(c => `<option value="${{esc(c.id)}}">${{esc(c.name)}}</option>`).join(''); document.getElementById('tag-type').value = ''; document.getElementById('tag-search').value = ''; document.getElementById('tag-person').innerHTML = '<option value="">Ninguno</option>'; document.getElementById('tag-error').textContent = ''; document.getElementById('tag-modal').classList.add('open'); }}
    async function loadAssignableEntities() {{ const kind = document.getElementById('tag-type').value; if (!kind) {{ assignableEntities=[]; filterAssignableEntities(); return; }} assignableEntities = await fetch(`/assignable-entities?kind=${{kind}}`).then(r => r.json()); filterAssignableEntities(); }}
    function filterAssignableEntities() {{ const company = document.getElementById('tag-company').value; const text = document.getElementById('tag-search').value.toLowerCase(); const rows = assignableEntities.filter(row => (!company || String(row.company_id) === company) && (!text || `${{row.name}} ${{row.company_name||''}}`.toLowerCase().includes(text))); document.getElementById('tag-person').innerHTML = '<option value="">Ninguno</option>' + rows.map(row => `<option value="${{esc(row.id)}}">${{esc(row.name)}}${{row.company_name ? ' · '+esc(row.company_name) : ''}}</option>`).join(''); }}
    async function saveTagAssignment() {{ const epc = document.getElementById('tag-modal-epc').textContent; const entity_type = document.getElementById('tag-type').value; const entity_id = document.getElementById('tag-person').value; if (!entity_type || !entity_id) {{ document.getElementById('tag-error').textContent='Seleccione tipo y entidad.'; return; }} const result = await fetch('/tag-assignment/person', {{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{epc,entity_type,entity_id}})}}); if (!result.ok) {{ document.getElementById('tag-error').textContent = (await result.json()).detail || 'No se pudo guardar'; return; }} await refreshTagAssignment(epc); closeModal(); }}

    function renderRfidSummary(items) {{
      const tbody = document.getElementById("rfid-summary");
      if (!items || items.length === 0) {{
        tbody.innerHTML = `
          <tr>
            <td colspan="10" class="empty">Aun no hay lecturas RFID acumuladas en esta sesion.</td>
          </tr>
        `;
        return;
      }}

      tbody.innerHTML = items.map((item, index) => {{
        const cssClass = index === 0 ? "rank-top" : "";
        const antenna = item.antenna_port != null
          ? `Puerto ${{esc(item.antenna_port)}}`
          : esc(item.antenna_name || "-");
        const reader = item.reader_code || item.reader_host || "-";
        const identity = `
          <div class="mono">${{esc(item.epc || "-")}}</div>
          ${{item.tid ? `<div class="sub mono">TID ${{esc(item.tid)}}</div>` : ""}}
        `;
        return `
          <tr class="${{cssClass}}">
            <td>${{esc(index + 1)}}</td>
            <td>${{identity}}</td>
            <td>${{esc(item.read_count ?? 0)}}</td>
            <td><span class="pill">${{esc(item.proximity_hint || "-")}}</span></td>
            <td>${{item.latest_rssi != null ? `${{esc(item.latest_rssi)}} dBm` : "-"}}</td>
            <td>${{item.strongest_rssi != null ? `${{esc(item.strongest_rssi)}} dBm` : "-"}}</td>
            <td>${{item.avg_rssi != null ? `${{esc(item.avg_rssi)}} dBm` : "-"}}</td>
            <td>${{antenna}}</td>
            <td>${{esc(reader)}}</td>
            <td>${{fmtDate(item.last_seen_at)}}</td>
          </tr>
        `;
      }}).join("");
    }}

    function renderEvents(items) {{
      const tbody = document.getElementById("events");
      tbody.innerHTML = (items || []).map((item) => {{
        const payload = item.payload ? `<div class="mono">${{esc(item.payload)}}</div>` : "";
        const extra = item.extra ? `<div class="mono">${{esc(JSON.stringify(item.extra))}}</div>` : "";
        const technical = (payload || extra) ? `<details><summary>Ver trama y datos</summary>${{payload}}${{extra}}</details>` : "-";
        const reason = item.extra?.reason === "tag_not_registered_or_assigned"
          ? " · EPC sin registrar/asignar"
          : "";
        return `
          <tr>
            <td>${{fmtDate(item.ts)}}</td>
            <td>${{esc(item.channel || "-")}}</td>
            <td class="${{esc(item.status || "")}}">${{esc(item.status || "-")}}</td>
            <td>${{esc(item.summary || "-")}}${{esc(reason)}}</td>
            <td>${{esc(item.remote_addr || "-")}}</td>
            <td>${{technical}}</td>
          </tr>
        `;
      }}).join("");
    }}

    async function loadAll() {{
      const [statusRes, eventsRes, rfidSummaryRes] = await Promise.all([
        fetch("/status"),
        fetch("/events?limit=80"),
        fetch("/rfid-summary?limit=120"),
      ]);
      const status = await statusRes.json();
      const events = await eventsRes.json();
      latestEvents = events.items || [];
      const rfidSummary = await rfidSummaryRes.json();
      renderStats(status, events);
      renderReceivers(status.receivers?.items || []);
      renderRfidSummary(rfidSummary.items || []);
      renderNearestRfid(rfidSummary.items || []);
      renderEvents(events.items || []);
    }}

    loadAll();
    setInterval(loadAll, 3000);
  </script>
</body>
</html>"""


async def _handle_impinj_webhook(request: Request) -> Dict[str, Any]:
    payload = await _decode_webhook_payload(request)
    fallback_reader_code = (
        settings.gao_reader_hosts[0]
        if settings.gao_reader_hosts
        else ((request.client.host if request.client else "") or "impinj-webhook")
    )
    remote_addr = request.client.host if request.client else None
    return await forward_impinj_webhook_payload(
        payload,
        fallback_reader_code,
        remote_addr=remote_addr,
        request_path=request.url.path,
    )


@router.get("/login", response_class=HTMLResponse, include_in_schema=False)
def listener_login_page():
    return """<!doctype html><html lang=es><meta charset=utf-8><title>TMONE Listener</title><style>body{font-family:system-ui;background:#102b43;display:grid;place-items:center;height:100vh;margin:0}.box{width:320px;background:#fff;border-radius:16px;padding:28px;box-shadow:0 18px 50px #0005}input,button{box-sizing:border-box;width:100%;padding:11px;margin-top:10px;border-radius:8px;border:1px solid #cbd5e1}button{background:#174e73;color:#fff;border:0;font-weight:700}#error{color:#b42318;margin-top:10px}</style><main class=box><img src='/public-logo' alt=Telemining style='max-width:180px'><h2>TMONE Listener</h2><p>Sólo administradores</p><form id=f><input id=u placeholder=Usuario required><input id=p type=password placeholder=Contraseña required><button>Ingresar</button></form><div id=error></div></main><script>f.onsubmit=async e=>{e.preventDefault();error.textContent='';let r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})});let d=await r.json();if(r.ok)location='/';else error.textContent=d.detail||'No autorizado'};</script></html>"""


@router.post("/auth/login", include_in_schema=False)
async def listener_login(payload: ListenerLoginPayload, response: Response):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            backend_response = await client.post(
                f"{settings.backend_base_url.rstrip('/')}/auth/token",
                data={"username": payload.username, "password": payload.password},
            )
        backend_response.raise_for_status()
        data = backend_response.json()
    except Exception:
        raise HTTPException(status_code=401, detail="Usuario o contraseña inválidos")
    if str(data.get("role", "")).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="Sólo el rol administrador puede acceder")
    response.set_cookie("tmone_listener_token", data["access_token"], httponly=True, samesite="lax", max_age=3600)
    return {"ok": True, "username": data.get("username")}


@router.get("/public-logo", include_in_schema=False)
def public_logo():
    return FileResponse(Path(__file__).with_name("logo.png"), media_type="image/png")


@router.get("/health", tags=["listener"])
def health(_admin: Dict[str, Any] = Depends(require_listener_admin)):
    return listener_health_payload()


@router.get("/status", tags=["listener"])
def status(_admin: Dict[str, Any] = Depends(require_listener_admin)):
    return listener_status_payload()


@router.get("/events", tags=["listener"])
def events(limit: int = 120, _admin: Dict[str, Any] = Depends(require_listener_admin)):
    return monitor_events_payload(limit=limit)


@router.get("/rfid-summary", tags=["listener"])
def rfid_summary(limit: int = 120, _admin: Dict[str, Any] = Depends(require_listener_admin)):
    return monitor_rfid_summary_payload(limit=limit)


@router.get("/tag-assignment", tags=["listener"])
async def tag_assignment(epc: str, _admin: Dict[str, Any] = Depends(require_listener_admin)):
    code = (epc or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="EPC requerido")
    tags = await _backend_json("/config/tags")
    return next((item for item in tags if str(item.get("code", "")).strip().upper() == code), {"code": code, "assigned_to": None})


@router.get("/assignable-persons", tags=["listener"])
async def assignable_persons(_admin: Dict[str, Any] = Depends(require_listener_admin)):
    people = await _backend_json("/config/persons")
    return [{"id": item.get("id"), "name": item.get("full_name") or item.get("name") or "Sin nombre"} for item in people]


@router.get("/assignable-entities", tags=["listener"])
async def assignable_entities(kind: str = "person", _admin: Dict[str, Any] = Depends(require_listener_admin)):
    paths = {"person": "/config/persons", "vehicle": "/config/vehicles", "equipment": "/config/equipment"}
    if kind not in paths:
        raise HTTPException(status_code=400, detail="Tipo de entidad inválido")
    rows = await _backend_json(paths[kind])
    return [{"id": row.get("id"), "name": row.get("full_name") or row.get("patente") or row.get("name") or row.get("code") or "Sin nombre", "company_id": row.get("company_id"), "company_name": row.get("company_name")} for row in rows]


@router.get("/assignable-companies", tags=["listener"])
async def assignable_companies(_admin: Dict[str, Any] = Depends(require_listener_admin)):
    return await _backend_json("/config/companies")


@router.post("/tag-assignment/person", tags=["listener"])
async def assign_tag_to_person(payload: Dict[str, Any], _admin: Dict[str, Any] = Depends(require_listener_admin)):
    epc = str(payload.get("epc") or "").strip().upper()
    entity_id = payload.get("entity_id")
    entity_type = str(payload.get("entity_type") or "person")
    if not epc or not entity_id or entity_type not in {"person", "vehicle", "equipment"}:
        raise HTTPException(status_code=400, detail="EPC, tipo y entidad requeridos")
    tags = await _backend_json("/config/tags")
    tag = next((item for item in tags if str(item.get("code", "")).strip().upper() == epc), None)
    if not tag:
        tag = await _backend_json("/config/tags", method="POST", payload={"code": epc})
    return await _backend_json("/config/tag-assignments", method="POST", payload={"tag_id": tag["id"], "entity_type": entity_type, "entity_id": entity_id})


@router.get("/assets/telemining-logo.png", include_in_schema=False)
def telemining_logo(_admin: Dict[str, Any] = Depends(require_listener_admin)):
    return FileResponse(Path(__file__).with_name("logo.png"), media_type="image/png")


@router.get("/", response_class=HTMLResponse, tags=["listener"])
async def monitor_home(request: Request):
    try:
        await require_listener_admin(request)
    except HTTPException:
        return RedirectResponse("/login", status_code=303)
    return monitor_html()


@router.post("/ingest", tags=["listener"])
def ingest(payload: IngestPayload):
    """Endpoint de prueba para inyectar eventos al listener via HTTP.

    Esto NO reemplaza el flujo real (TCP/BLE o stream GAO), pero permite probar
    desde Swagger/curl.
    """
    return {
        "received": True,
        "ts": (payload.ts or datetime.utcnow()).isoformat(),
        "source": payload.source,
        "data": payload.data,
    }


@router.post("/ingest/tag-ble", tags=["listener"])
def ingest_tag_ble(payload: Dict[str, Any]):
    return {"received": True, "source": "tag_ble", "data": payload}


@router.post("/ingest/tag-rfid", tags=["listener"])
async def ingest_tag_rfid(request: Request):
    """Compat: recibe webhook/eventos RFID y los reenvía al backend."""
    return await _handle_impinj_webhook(request)


@router.post("/ingest/tag-rfid", tags=["listener"])
async def ingest_tag_rfid(request: Request):
    """Compat: recibe webhook/eventos RFID y los reenvía al backend."""
    return await _handle_impinj_webhook(request)


@router.post("/ingest/tag-rfid/test", tags=["listener"])
async def ingest_tag_rfid_test(request: Request):
    """Permite probar desde la web del listener sin usar el puerto 7070."""
    return await _handle_impinj_webhook(request)


@router.post("/webhook", tags=["listener"])
async def ingest_root_webhook(request: Request):
    """Compat HTTP en la web del listener."""
    return await _handle_impinj_webhook(request)


@router.post("/webhook/impinj", tags=["listener"])
async def ingest_webhook_impinj(request: Request):
    return await _handle_impinj_webhook(request)


@router.post("/ingest/ur", tags=["listener"])
def ingest_ur(payload: Dict[str, Any]):
    """Compat: eventos/estado de UR/pórticos."""
    return {"received": True, "source": "ur", "data": payload}


@router.post("/ingest/camera", tags=["listener"])
def ingest_camera(payload: Dict[str, Any]):
    """Compat: eventos/estado de cámaras."""
    return {"received": True, "source": "camera", "data": payload}


@router.post("/ingest/gps", tags=["listener"])
def ingest_gps(payload: Dict[str, Any]):
    return {"received": True, "source": "gps", "data": payload}
