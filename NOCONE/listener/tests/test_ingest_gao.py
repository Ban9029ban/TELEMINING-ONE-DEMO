from datetime import timezone

from app.ingest_gao import _extract_stream_payload, iter_gao_event_dicts, parse_gao_event


def test_extract_stream_payload_supports_sse_data_lines():
    assert _extract_stream_payload('data: {"epc":"300833B2DDD9014000000001"}') == '{"epc":"300833B2DDD9014000000001"}'
    assert _extract_stream_payload(": keep-alive") is None
    assert _extract_stream_payload("event: tagInventory") is None
    assert _extract_stream_payload("") is None


def test_parse_gao_event_supports_nested_inventory_timestamp():
    event = {
        "reader_host": "192.168.100.50",
        "tagInventoryEvent": {
            "timestamp": "2026-06-15T18:30:00.000Z",
            "epc": "300833B2DDD9014000000001",
            "antennaPort": 1,
            "peakRssiCdbm": -5300,
            "frequency": 915250,
            "phaseAngle": 123,
            "tid": "E280689400004003",
        },
    }

    frame = parse_gao_event(event, fallback_reader_code="192.168.100.50")

    assert frame is not None
    assert frame.epc == "300833B2DDD9014000000001"
    assert frame.reader_code == "192.168.100.50"
    assert frame.reader_host == "192.168.100.50"
    assert frame.antenna_port == 1
    assert frame.rssi == -53
    assert frame.frequency == 915250
    assert frame.phase_angle == 123.0
    assert frame.tid == "E280689400004003"
    assert frame.ts_edge.tzinfo == timezone.utc
    assert frame.ts_edge.isoformat() == "2026-06-15T18:30:00+00:00"


def test_parse_gao_event_supports_tag_object_and_hostname():
    event = {
        "hostname": "gao-192.168.100.50",
        "timestamp": "2026-06-15T18:31:00.000Z",
        "tag": {
            "epc": "300833B2DDD9014000000002",
            "antennaPort": "2",
            "peakRssi": "-45",
        },
    }

    frame = parse_gao_event(event, fallback_reader_code="192.168.100.50")

    assert frame is not None
    assert frame.reader_code == "gao-192.168.100.50"
    assert frame.reader_host == "192.168.100.50"
    assert frame.antenna_port == 2
    assert frame.rssi == -45


def test_parse_gao_event_decodes_base64_epc_to_hex():
    event = {
        "hostname": "192.168.100.50",
        "timestamp": "2026-06-19T05:11:06.000Z",
        "tagInventoryEvent": {
            "epc": "AAAAAAAAAAAAESYW",
            "antennaPort": 1,
            "peakRssiCdbm": -3300,
        },
    }

    frame = parse_gao_event(event, fallback_reader_code="192.168.100.50")

    assert frame is not None
    assert frame.epc == "000000000000000000112616"


def test_parse_gao_event_decodes_urlsafe_base64_epc_to_hex():
    event = {
        "hostname": "192.168.100.50",
        "timestamp": "2026-06-19T05:11:06.000Z",
        "tagInventoryEvent": {
            "epc": "MDS3CLQrjYSqLtN2",
            "antennaPort": 1,
            "peakRssiCdbm": -6700,
        },
    }

    frame = parse_gao_event(event, fallback_reader_code="192.168.100.50")

    assert frame is not None
    assert frame.epc == "3034B708B42B8D84AA2ED376"


def test_parse_gao_event_ignores_non_inventory_events():
    event = {"eventType": "diagnostics", "timestamp": "2026-06-15T18:31:00.000Z"}

    assert parse_gao_event(event, fallback_reader_code="192.168.100.50") is None


def test_iter_gao_event_dicts_supports_webhook_batches():
    payload = {
        "eventReports": [
            {
                "hostname": "impinj-50",
                "tagInventoryEvent": {
                    "epcHex": "300833B2DDD9014000000003",
                    "peakRssiCdbm": -4700,
                },
            },
            {
                "hostname": "impinj-50",
                "antennaConnectedEvent": {"antennaPort": 1},
            },
        ]
    }

    events = list(iter_gao_event_dicts(payload))

    assert len(events) == 1
    assert events[0]["hostname"] == "impinj-50"
