# listener/app/connections.py
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional


@dataclass
class ConnectionInfo:
    connection_id: str
    remote_addr: str
    backbone_code: Optional[str] = None
    last_edge_id: Optional[str] = None
    last_bt_id: Optional[str] = None
    last_seen: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    total_frames: int = 0


class ConnectionRegistry:
    def __init__(self) -> None:
        self._conns: Dict[str, ConnectionInfo] = {}
        self._accepted_total: int = 0

    def add(self, info: ConnectionInfo) -> None:
        self._conns[info.connection_id] = info
        self._accepted_total += 1

    def remove(self, connection_id: str) -> None:
        self._conns.pop(connection_id, None)

    def update(self, connection_id: str, **kwargs) -> None:
        info = self._conns.get(connection_id)
        if not info:
            return
        for k, v in kwargs.items():
            setattr(info, k, v)

    def snapshot(self) -> List[ConnectionInfo]:
        return list(self._conns.values())

    def count(self) -> int:
        return len(self._conns)

    def accepted_total(self) -> int:
        return self._accepted_total


# instancia global
registry = ConnectionRegistry()
