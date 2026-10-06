from datetime import timezone

import pytest

from app.ingest_tcp import MIN_SANE_YEAR, parse_rfid_line


def test_parse_rfid_line_valid():
    line = (
        "RFID|300833B2DDD9014000000001|2026-07-02T22:15:33Z|gao-192.168.100.50|192.168.100.50|"
        "1|Portal Norte|-53|E280689400004003|915250|123.5|3000"
    )

    frame = parse_rfid_line(line)

    assert frame.epc == "300833B2DDD9014000000001"
    assert frame.signal == "RFID_UHF"
    assert frame.reader_code == "gao-192.168.100.50"
    assert frame.reader_host == "192.168.100.50"
    assert frame.antenna_port == 1
    assert frame.antenna_name == "Portal Norte"
    assert frame.rssi == -53
    assert frame.tid == "E280689400004003"
    assert frame.frequency == 915250
    assert frame.phase_angle == 123.5
    assert frame.transmit_power_cdbm == 3000
    assert frame.ts_edge.tzinfo == timezone.utc
    assert frame.ts_edge.year >= MIN_SANE_YEAR


@pytest.mark.parametrize(
    "line",
    [
        "RFID|missing-fields",
        "RFID||2026-07-02T22:15:33Z|gao|192.168.100.50|1||-53||| |",
        "RFID|300833B2DDD9014000000001|bad-ts|gao|192.168.100.50|1||-53||| |",
        "NOTRFID|300833B2DDD9014000000001|2026-07-02T22:15:33Z|gao|192.168.100.50|1||-53||| |",
    ],
)
def test_parse_rfid_line_rejects_invalid_data(line):
    with pytest.raises(ValueError):
        parse_rfid_line(line)
