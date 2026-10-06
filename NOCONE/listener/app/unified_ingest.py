from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, Tuple
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException

from .config import settings
from .ingest_http import (
    decode_webhook_bytes,
    forward_impinj_webhook_payload,
    listener_health_payload,
    listener_status_payload,
    monitor_events_payload,
)
from .ingest_tcp import serve_ble_stream
from .monitoring import monitor

logger = logging.getLogger("zenit.unified_ingest")

HTTP_METHOD_PREFIXES = (b"GET ", b"POST ", b"PUT ", b"PATCH ", b"DELETE ", b"HEAD ", b"OPTIONS ")
HTTP_MAX_BODY_BYTES = 5 * 1024 * 1024
HTTP_REASON_PHRASES = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    404: "Not Found",
    405: "Method Not Allowed",
    413: "Payload Too Large",
    500: "Internal Server Error",
    502: "Bad Gateway",
}


def _remote_addr(writer: asyncio.StreamWriter) -> str:
    peer = writer.get_extra_info("peername")
    return f"{peer[0]}:{peer[1]}" if peer else "unknown"


def _looks_like_http(first_line: bytes) -> bool:
    line = first_line.lstrip()
    return any(line.startswith(prefix) for prefix in HTTP_METHOD_PREFIXES)


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")


def _build_response(
    status_code: int,
    body: bytes = b"",
    *,
    content_type: str = "application/json; charset=utf-8",
    extra_headers: Dict[str, str] | None = None,
) -> bytes:
    reason = HTTP_REASON_PHRASES.get(status_code, "OK")
    headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
        "Connection": "close",
    }
    headers.update(extra_headers or {})
    header_blob = "".join(f"{key}: {value}\r\n" for key, value in headers.items())
    return (
        f"HTTP/1.1 {status_code} {reason}\r\n{header_blob}\r\n".encode("utf-8")
        + body
    )


async def _send_json(writer: asyncio.StreamWriter, status_code: int, payload: Any) -> None:
    writer.write(_build_response(status_code, _json_bytes(payload)))
    await writer.drain()


def _parse_request_line(first_line: bytes) -> Tuple[str, str, str]:
    try:
        decoded = first_line.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ValueError("Request line HTTP no UTF-8") from exc

    parts = decoded.split()
    if len(parts) != 3:
        raise ValueError(f"Request line HTTP invalida: {decoded!r}")
    return parts[0].upper(), parts[1], parts[2]


async def _read_headers(reader: asyncio.StreamReader) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    while True:
        raw_line = await reader.readline()
        if raw_line in (b"", b"\r\n", b"\n"):
            return headers

        line = raw_line.decode("utf-8", errors="ignore").strip()
        if not line or ":" not in line:
            continue

        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()


async def _read_chunked_body(reader: asyncio.StreamReader) -> bytes:
    chunks = bytearray()
    while True:
        size_line = await reader.readline()
        if not size_line:
            raise ValueError("Transfer-Encoding chunked incompleto")

        size_text = size_line.decode("utf-8", errors="ignore").strip().split(";", 1)[0]
        try:
            chunk_size = int(size_text, 16)
        except ValueError as exc:
            raise ValueError("Chunk size invalido") from exc

        if chunk_size == 0:
            while True:
                trailer = await reader.readline()
                if trailer in (b"", b"\r\n", b"\n"):
                    return bytes(chunks)

        if len(chunks) + chunk_size > HTTP_MAX_BODY_BYTES:
            raise ValueError("Payload HTTP excede el maximo permitido")

        chunks.extend(await reader.readexactly(chunk_size))
        await reader.readexactly(2)


async def _read_body(reader: asyncio.StreamReader, headers: Dict[str, str]) -> bytes:
    transfer_encoding = headers.get("transfer-encoding", "").lower()
    if "chunked" in transfer_encoding:
        return await _read_chunked_body(reader)

    content_length_raw = headers.get("content-length", "0") or "0"
    try:
        content_length = int(content_length_raw)
    except ValueError as exc:
        raise ValueError("Content-Length invalido") from exc

    if content_length < 0:
        raise ValueError("Content-Length invalido")
    if content_length > HTTP_MAX_BODY_BYTES:
        raise ValueError("Payload HTTP excede el maximo permitido")
    if content_length == 0:
        return b""
    return await reader.readexactly(content_length)


async def _dispatch_http_request(
    method: str,
    raw_target: str,
    body: bytes,
    *,
    remote_addr: str,
) -> Tuple[int, str, bytes]:
    parsed = urlsplit(raw_target)
    path = parsed.path or "/"
    query = parse_qs(parsed.query)

    if method == "OPTIONS":
        return 204, "text/plain; charset=utf-8", b""

    if method == "GET" and path == "/":
        text = (
            f"ZENIT listener ingest activo en {settings.tcp_port}.\n"
            f"Monitor web: http://{settings.server_ip}:{settings.http_port}/\n"
            f"Webhook reader: http://{settings.server_ip}:{settings.tcp_port}/\n"
        )
        return 200, "text/plain; charset=utf-8", text.encode("utf-8")

    if method == "GET" and path == "/health":
        return 200, "application/json; charset=utf-8", _json_bytes(listener_health_payload())

    if method == "GET" and path == "/status":
        return 200, "application/json; charset=utf-8", _json_bytes(listener_status_payload())

    if method == "GET" and path == "/events":
        limit_raw = (query.get("limit") or ["120"])[0]
        try:
            limit = int(limit_raw)
        except ValueError:
            limit = 120
        return 200, "application/json; charset=utf-8", _json_bytes(monitor_events_payload(limit))

    webhook_paths = {"/", "/ingest/tag-rfid", "/webhook", "/webhook/impinj"}
    if method == "POST" and path in webhook_paths:
        fallback_reader_code = settings.gao_reader_hosts[0] if settings.gao_reader_hosts else remote_addr.split(":", 1)[0]
        payload = decode_webhook_bytes(body)
        result = await forward_impinj_webhook_payload(
            payload,
            fallback_reader_code,
            remote_addr=remote_addr,
            request_path=path,
        )
        return 200, "application/json; charset=utf-8", _json_bytes(result)

    return 404, "application/json; charset=utf-8", _json_bytes(
        {
            "detail": "Ruta no encontrada en el listener unificado",
            "path": path,
            "method": method,
        }
    )


async def _handle_http_connection(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    first_line: bytes,
) -> None:
    remote_addr = _remote_addr(writer)
    try:
        method, raw_target, _http_version = _parse_request_line(first_line)
        headers = await _read_headers(reader)
        body = await _read_body(reader, headers) if method in {"POST", "PUT", "PATCH"} else b""

        status_code, content_type, response_body = await _dispatch_http_request(
            method,
            raw_target,
            body,
            remote_addr=remote_addr,
        )
        writer.write(_build_response(status_code, response_body, content_type=content_type))
        await writer.drain()
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"detail": exc.detail}
        monitor.record(
            channel="ingest_http",
            status="error",
            summary=f"HTTP webhook rechazado {exc.status_code}",
            remote_addr=remote_addr,
            extra={"detail": detail},
        )
        await _send_json(writer, exc.status_code, detail)
    except ValueError as exc:
        monitor.record(
            channel="ingest_http",
            status="error",
            summary="HTTP invalido en 7070",
            remote_addr=remote_addr,
            extra={"error": str(exc)},
        )
        status_code = 413 if "maximo permitido" in str(exc) else 400
        await _send_json(writer, status_code, {"detail": str(exc)})
    except Exception as exc:
        logger.exception("Error manejando HTTP en 7070 desde %s", remote_addr)
        monitor.record(
            channel="ingest_http",
            status="error",
            summary="Error interno atendiendo HTTP en 7070",
            remote_addr=remote_addr,
            extra={"error": str(exc)},
        )
        await _send_json(writer, 500, {"detail": "Error interno del listener"})
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass


async def _handle_connection(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    first_line = await reader.readline()
    if not first_line:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return

    if _looks_like_http(first_line):
        await _handle_http_connection(reader, writer, first_line)
        return

    first_payload_line = first_line.decode("utf-8", errors="ignore").strip()
    await serve_ble_stream(reader, writer, first_line=first_payload_line)


async def start_unified_ingest_server() -> None:
    server = await asyncio.start_server(_handle_connection, settings.tcp_host, settings.tcp_port)
    addrs = ", ".join(str(sock.getsockname()) for sock in (server.sockets or []))
    logger.info(
        "Listener unificado escuchando en %s (TCP BLE/LoRa + HTTP webhook Impinj/GAO)",
        addrs,
    )

    async with server:
        await server.serve_forever()
