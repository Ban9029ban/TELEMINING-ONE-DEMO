import os
import uuid

import pytest

os.environ.setdefault("CORS_ORIGINS", "[\"http://localhost:8081\"]")

from app.routers import tag_listener


def test_remote_host_from_remote_addr_extracts_ipv4_host():
    assert tag_listener._remote_host_from_remote_addr("192.168.100.53:40123") == "192.168.100.53"
    assert tag_listener._remote_host_from_remote_addr("192.168.100.53") == "192.168.100.53"


def test_transport_remote_addr_from_raw_event_handles_missing_payload():
    assert tag_listener._transport_remote_addr_from_raw_event(None) is None
    assert tag_listener._transport_remote_addr_from_raw_event({}) is None
    assert (
        tag_listener._transport_remote_addr_from_raw_event(
            {"transport_remote_addr": "192.168.100.53:40123"}
        )
        == "192.168.100.53:40123"
    )


@pytest.mark.asyncio
async def test_find_rfid_portico_config_prefers_transport_gateway_name(monkeypatch):
    calls = []
    expected_portico = {
        "id": 2,
        "name": "2.-SOC. ACC RAMPA NH",
        "zone": "Rampa NH",
        "nivel": "NH",
        "specific_name": "TMONE_TTE_RX_003",
        "operating_mode": "READ",
        "antenna_in_port": 1,
        "antenna_out_port": None,
        "sequence_window_seconds": 15,
    }

    async def fake_load_by_specific_name(_db, specific_name):
        calls.append(("specific_name", specific_name))
        return None

    async def fake_load_by_gateway_name(_db, gateway_name):
        calls.append(("gateway_name", gateway_name))
        if gateway_name == "192.168.100.53":
            return expected_portico
        return None

    async def fake_load_by_gateway(_db, gateway_id):
        calls.append(("gateway_id", str(gateway_id)))
        return {"id": 1}

    monkeypatch.setattr(tag_listener, "_load_portico_config_by_specific_name", fake_load_by_specific_name)
    monkeypatch.setattr(tag_listener, "_load_portico_config_by_gateway_name", fake_load_by_gateway_name)
    monkeypatch.setattr(tag_listener, "_load_portico_config_by_gateway", fake_load_by_gateway)

    reader_gateway_id = uuid.uuid4()
    portico = await tag_listener._find_rfid_portico_config(
        None,
        gateway_id=reader_gateway_id,
        reader_code="192.168.100.50",
        reader_host="192.168.100.50",
        antenna_port=1,
        raw_event={"transport_remote_addr": "192.168.100.53:40123"},
    )

    assert portico == expected_portico
    assert ("gateway_name", "192.168.100.53") in calls
    assert ("gateway_id", str(reader_gateway_id)) not in calls
