from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_listener_health_and_status():
    assert client.get("/health").status_code == 200
    status = client.get("/status")
    assert status.status_code == 200
    payload = status.json()
    assert payload["listener"] == "ok"
    assert "ts" in payload
    assert "receivers" in payload
    assert "active_count" in payload["receivers"]

def test_ingest_variants_return_ack():
    payload = {"source": "tag_ble", "data": {"bt_id": "AA:BB"}}
    response = client.post("/ingest", json=payload)
    assert response.status_code == 200
    assert response.json()["received"] is True

    for route, source in [
        ("/ingest/tag-ble", "tag_ble"),
        ("/ingest/tag-rfid", "tag_rfid"),
        ("/ingest/ur", "ur"),
        ("/ingest/camera", "camera"),
        ("/ingest/gps", "gps"),
    ]:
        resp = client.post(route, json={"ok": True})
        assert resp.status_code == 200
        assert resp.json()["source"] == source
