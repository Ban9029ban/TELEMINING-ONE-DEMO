import pytest

from app import ingest_tcp
from app.monitoring import monitor


@pytest.mark.asyncio
async def test_process_ingest_line_routes_rfid(monkeypatch):
    sent = {}
    created = {}

    async def fake_send_tag_rfid(frame):
        sent["frame"] = frame
        return {"stored": True}

    def fake_create_task(coro):
        created["coro"] = coro
        return None

    monkeypatch.setattr(ingest_tcp.backend_client, "send_tag_rfid", fake_send_tag_rfid)
    monkeypatch.setattr(ingest_tcp.asyncio, "create_task", fake_create_task)

    line = (
        "RFID|300833B2DDD9014000000001|2026-07-02T22:15:33Z|gao-192.168.100.50|192.168.100.50|"
        "1|Portal Norte|-53|E280689400004003|915250|123.5|3000"
    )

    ok = await ingest_tcp.process_ingest_line(line, conn_id="rfid-test", remote_addr="10.0.0.50:7777")

    assert ok is True
    assert "coro" in created

    await created["coro"]

    assert sent["frame"].epc == "300833B2DDD9014000000001"
    assert sent["frame"].reader_code == "gao-192.168.100.50"
    assert sent["frame"].raw_event["transport_remote_addr"] == "10.0.0.50:7777"


@pytest.mark.asyncio
async def test_process_ingest_line_routes_receiver_heartbeat():
    line = (
        "RCV_HEARTBEAT|TMONE_TTE_RECEIVER_001|GW_BACKBONE_RECEIVER_001|192.168.100.53|"
        "0|1|4500|TMONE_TTE_SENDER_001|800|1|-79|9.25|192.168.100.10:7070"
    )

    ok = await ingest_tcp.process_ingest_line(line, conn_id="hb-test", remote_addr="10.0.0.53:6000")

    assert ok is True

    receivers = monitor.receiver_presence_payload(limit=10)["items"]
    receiver = next(item for item in receivers if item["receiver_id"] == "TMONE_TTE_RECEIVER_001")
    assert receiver["transport_ip"] == "192.168.100.53"
    assert receiver["linked_sender_id"] == "TMONE_TTE_SENDER_001"
    assert receiver["listener_target"] == "192.168.100.10:7070"
