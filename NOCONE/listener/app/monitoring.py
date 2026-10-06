from __future__ import annotations

from collections import Counter, deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional

RECEIVER_PRESENCE_TTL_SECONDS = 20


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ListenerMonitor:
    def __init__(self, max_events: int = 300) -> None:
        self.started_at = _utcnow()
        self._events: Deque[Dict[str, Any]] = deque(maxlen=max_events)
        self._counters: Counter[str] = Counter()
        self._rfid_reads: Dict[str, Dict[str, Any]] = {}
        self._receiver_heartbeats: Dict[str, Dict[str, Any]] = {}

    def record(
        self,
        *,
        channel: str,
        status: str,
        summary: str,
        remote_addr: Optional[str] = None,
        payload: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> None:
        event = {
            "ts": _utcnow().isoformat(),
            "channel": channel,
            "status": status,
            "summary": summary,
            "remote_addr": remote_addr,
            "payload": (payload or "")[:600] if payload else None,
            "extra": extra or {},
        }
        self._events.appendleft(event)
        self._counters[channel] += 1
        self._counters[f"{channel}:{status}"] += 1

    def snapshot(self, limit: int = 100) -> List[Dict[str, Any]]:
        if limit <= 0:
            return []
        return list(self._events)[:limit]

    def counters(self) -> Dict[str, int]:
        return dict(self._counters)

    def uptime_seconds(self) -> int:
        return int((_utcnow() - self.started_at).total_seconds())

    def record_rfid_read(
        self,
        *,
        epc: str,
        reader_code: Optional[str] = None,
        reader_host: Optional[str] = None,
        antenna_port: Optional[int] = None,
        antenna_name: Optional[str] = None,
        rssi: Optional[int] = None,
        tid: Optional[str] = None,
        ts_edge: Optional[datetime] = None,
    ) -> None:
        if not epc:
            return

        seen_at = ts_edge or _utcnow()
        received_at = _utcnow()
        item = self._rfid_reads.get(epc)
        if item is None:
            item = {
                "epc": epc,
                "tid": tid,
                "reader_code": reader_code,
                "reader_host": reader_host,
                "antenna_port": antenna_port,
                "antenna_name": antenna_name,
                "read_count": 0,
                "latest_rssi": None,
                "strongest_rssi": None,
                "weakest_rssi": None,
                "rssi_total": 0.0,
                "rssi_samples": 0,
                "first_seen_at": seen_at,
                "last_seen_at": seen_at,
                "first_received_at": received_at,
                "last_received_at": received_at,
            }
            self._rfid_reads[epc] = item

        item["tid"] = tid or item.get("tid")
        item["reader_code"] = reader_code or item.get("reader_code")
        item["reader_host"] = reader_host or item.get("reader_host")
        item["antenna_port"] = antenna_port if antenna_port is not None else item.get("antenna_port")
        item["antenna_name"] = antenna_name or item.get("antenna_name")
        item["read_count"] += 1
        item["last_seen_at"] = seen_at
        item["last_received_at"] = received_at

        if rssi is not None:
            item["latest_rssi"] = rssi
            item["strongest_rssi"] = (
                rssi if item["strongest_rssi"] is None else max(item["strongest_rssi"], rssi)
            )
            item["weakest_rssi"] = (
                rssi if item["weakest_rssi"] is None else min(item["weakest_rssi"], rssi)
            )
            item["rssi_total"] += float(rssi)
            item["rssi_samples"] += 1

    def rfid_rankings(self, limit: int = 100) -> List[Dict[str, Any]]:
        if limit <= 0:
            return []

        items: List[Dict[str, Any]] = []
        for item in self._rfid_reads.values():
            rssi_samples = int(item.get("rssi_samples") or 0)
            avg_rssi = round(item["rssi_total"] / rssi_samples, 1) if rssi_samples > 0 else None
            strongest_rssi = item.get("strongest_rssi")
            latest_rssi = item.get("latest_rssi")

            items.append(
                {
                    "epc": item["epc"],
                    "tid": item.get("tid"),
                    "reader_code": item.get("reader_code"),
                    "reader_host": item.get("reader_host"),
                    "antenna_port": item.get("antenna_port"),
                    "antenna_name": item.get("antenna_name"),
                    "read_count": int(item.get("read_count") or 0),
                    "latest_rssi": latest_rssi,
                    "strongest_rssi": strongest_rssi,
                    "weakest_rssi": item.get("weakest_rssi"),
                    "avg_rssi": avg_rssi,
                    "rssi_samples": rssi_samples,
                    "proximity_hint": _proximity_hint(strongest_rssi if strongest_rssi is not None else latest_rssi),
                    "first_seen_at": _iso(item.get("first_seen_at")),
                    "last_seen_at": _iso(item.get("last_seen_at")),
                    "first_received_at": _iso(item.get("first_received_at")),
                    "last_received_at": _iso(item.get("last_received_at")),
                }
            )

        items.sort(
            key=lambda row: (
                row["strongest_rssi"] is None,
                -(row["strongest_rssi"] if row["strongest_rssi"] is not None else -9999),
                -(row["latest_rssi"] if row["latest_rssi"] is not None else -9999),
                -int(row["read_count"]),
                row["last_seen_at"] or "",
            )
        )
        return items[:limit]

    def record_receiver_heartbeat(
        self,
        *,
        receiver_id: str,
        backbone_code: str,
        remote_addr: Optional[str] = None,
        transport_ip: Optional[str] = None,
        queue_depth: Optional[int] = None,
        tcp_fail_count: Optional[int] = None,
        last_lora_rx_ms: Optional[int] = None,
        linked_sender_id: Optional[str] = None,
        link_age_ms: Optional[int] = None,
        link_active: Optional[bool] = None,
        last_rssi: Optional[int] = None,
        last_snr: Optional[float] = None,
        listener_target: Optional[str] = None,
    ) -> None:
        if not receiver_id:
            return

        seen_at = _utcnow()
        item = self._receiver_heartbeats.get(receiver_id)
        if item is None:
            item = {
                "receiver_id": receiver_id,
                "first_seen_at": seen_at,
            }
            self._receiver_heartbeats[receiver_id] = item

        item["receiver_id"] = receiver_id
        item["backbone_code"] = backbone_code
        item["remote_addr"] = remote_addr
        item["transport_ip"] = transport_ip
        item["queue_depth"] = queue_depth
        item["tcp_fail_count"] = tcp_fail_count
        item["last_lora_rx_ms"] = last_lora_rx_ms
        item["linked_sender_id"] = linked_sender_id
        item["link_age_ms"] = link_age_ms
        item["link_active"] = link_active
        item["last_rssi"] = last_rssi
        item["last_snr"] = last_snr
        item["listener_target"] = listener_target
        item["last_seen_at"] = seen_at

    def receiver_presence_ttl_seconds(self) -> int:
        return RECEIVER_PRESENCE_TTL_SECONDS

    def receiver_snapshot(self, limit: int = 50) -> List[Dict[str, Any]]:
        if limit <= 0:
            return []

        now = _utcnow()
        items: List[Dict[str, Any]] = []
        for item in self._receiver_heartbeats.values():
            last_seen_at = item.get("last_seen_at")
            age_seconds = _age_seconds(now, last_seen_at)
            is_active = age_seconds is not None and age_seconds <= RECEIVER_PRESENCE_TTL_SECONDS

            items.append(
                {
                    "receiver_id": item.get("receiver_id"),
                    "backbone_code": item.get("backbone_code"),
                    "remote_addr": item.get("remote_addr"),
                    "transport_ip": item.get("transport_ip"),
                    "queue_depth": item.get("queue_depth"),
                    "tcp_fail_count": item.get("tcp_fail_count"),
                    "last_lora_rx_ms": item.get("last_lora_rx_ms"),
                    "linked_sender_id": item.get("linked_sender_id"),
                    "link_age_ms": item.get("link_age_ms"),
                    "link_active": item.get("link_active"),
                    "last_rssi": item.get("last_rssi"),
                    "last_snr": item.get("last_snr"),
                    "listener_target": item.get("listener_target"),
                    "first_seen_at": _iso(item.get("first_seen_at")),
                    "last_seen_at": _iso(last_seen_at),
                    "age_seconds": age_seconds,
                    "is_active": is_active,
                }
            )

        items.sort(
            key=lambda row: (
                not bool(row.get("is_active")),
                row.get("age_seconds") if row.get("age_seconds") is not None else 10**9,
                row.get("receiver_id") or "",
            )
        )
        return items[:limit]

    def active_receivers_count(self) -> int:
        return sum(1 for item in self.receiver_snapshot(limit=500) if item.get("is_active"))

    def receiver_presence_payload(self, limit: int = 50) -> Dict[str, Any]:
        items = self.receiver_snapshot(limit=limit)
        return {
            "active_count": sum(1 for item in items if item.get("is_active")),
            "known_count": len(items),
            "ttl_seconds": RECEIVER_PRESENCE_TTL_SECONDS,
            "items": items,
        }


def _iso(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.isoformat()
    return None


def _age_seconds(now: datetime, value: Any) -> Optional[int]:
    if isinstance(value, datetime):
        return max(0, int((now - value).total_seconds()))
    return None


def _proximity_hint(rssi: Optional[int]) -> str:
    if rssi is None:
        return "Sin RSSI"
    if rssi >= -45:
        return "Muy cerca"
    if rssi >= -55:
        return "Cerca"
    if rssi >= -65:
        return "Media"
    if rssi >= -75:
        return "Lejos"
    return "Muy lejos"


monitor = ListenerMonitor()
