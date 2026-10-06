from app.routers.tag_listener import (
    PORTICO_MODE_ACCESS,
    PORTICO_MODE_READ,
    _normalize_portico_mode,
    _resolve_rfid_direction_and_logic,
)


def test_normalize_portico_mode_defaults_to_read():
    assert _normalize_portico_mode(None) == PORTICO_MODE_READ
    assert _normalize_portico_mode("lectura") == PORTICO_MODE_READ
    assert _normalize_portico_mode("ACCESS") == PORTICO_MODE_ACCESS


def test_access_portico_sequence_1_then_2_is_entry():
    result = _resolve_rfid_direction_and_logic(
        operating_mode=PORTICO_MODE_ACCESS,
        antenna_port=2,
        antenna_in_port=1,
        antenna_out_port=2,
        previous_antenna_port=1,
    )

    assert result == {"direction": "in", "logic": "access_sequence_entry"}


def test_access_portico_sequence_2_then_1_is_exit():
    result = _resolve_rfid_direction_and_logic(
        operating_mode=PORTICO_MODE_ACCESS,
        antenna_port=1,
        antenna_in_port=1,
        antenna_out_port=2,
        previous_antenna_port=2,
    )

    assert result == {"direction": "out", "logic": "access_sequence_exit"}


def test_access_portico_single_read_keeps_presence_inside_portico():
    result = _resolve_rfid_direction_and_logic(
        operating_mode=PORTICO_MODE_ACCESS,
        antenna_port=2,
        antenna_in_port=1,
        antenna_out_port=2,
        previous_antenna_port=None,
    )

    assert result == {"direction": "in", "logic": "access_presence_exit_side"}


def test_read_portico_always_registers_presence():
    result = _resolve_rfid_direction_and_logic(
        operating_mode=PORTICO_MODE_READ,
        antenna_port=1,
        antenna_in_port=1,
        antenna_out_port=None,
        previous_antenna_port=2,
    )

    assert result == {"direction": "in", "logic": "read_presence"}
