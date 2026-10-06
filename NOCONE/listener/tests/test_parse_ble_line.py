from datetime import timezone
import pytest
from app.ingest_tcp import MIN_SANE_YEAR, parse_ble_line

def test_parse_ble_line_valid():
    line = "AA:BB:CC:DD:EE:00:BT:2025-11-18T21:46:36:GW_BACKBONE_NORTE:EDGE_BASIC:TMONE_TTE_001:-60"
    frame = parse_ble_line(line)
    assert frame.bt_id == "AA:BB:CC:DD:EE:00"
    assert frame.signal == "BT"
    assert frame.backbone_code == "GW_BACKBONE_NORTE"
    assert frame.edge_kind == "EDGE_BASIC"
    assert frame.edge_id == "TMONE_TTE_001"
    assert frame.rssi == -60
    assert frame.ts_edge.tzinfo == timezone.utc
    assert frame.ts_edge.year >= MIN_SANE_YEAR

@pytest.mark.parametrize("line", [
    "short:line",
    "AA:BB:CC:DD:EE:00:BT:not-a-ts:GW:EDGE:ID:-60",
    "AA:BB:CC:DD:EE:00:BT:2025-11-18T21:46:36:GW:EDGE:ID:not-int",
])
def test_parse_ble_line_rejects_invalid_data(line):
    with pytest.raises(ValueError):
        parse_ble_line(line)
