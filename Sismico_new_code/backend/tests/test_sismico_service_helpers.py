from datetime import datetime, timedelta, timezone

from app.core.state_codes import UNKNOWN
from app.services.sismico_service import (
    build_source_message,
    resolve_effective_record,
)


def test_build_source_message_supports_runtime_statuses():
    assert build_source_message("online") == "Fuentes externas operativas"
    assert build_source_message("cached") == "Usando ultima captura en cache"
    assert build_source_message("manual") == "Ultimo registro aplicado manualmente"
    assert build_source_message("offline") == "Fuentes externas sin lectura"
    assert build_source_message("unknown") == "Estado de fuentes externas no disponible"
    assert build_source_message("offline", "fallo remoto") == "fallo remoto"


def test_resolve_effective_record_prefers_latest_visible_object_state():
    now = datetime.now(timezone.utc)
    info = resolve_effective_record(
        last_object_observed_at=now - timedelta(minutes=8),
        last_object_source_status="manual",
        last_object_source_name="legacy_site_ui",
        last_capture_at=now - timedelta(minutes=1),
        last_sync_at=now - timedelta(minutes=2),
        fallback_source_status="cached",
    )

    assert info.recorded_at == now - timedelta(minutes=8)
    assert info.source_status == "manual"
    assert info.source_name == "legacy_site_ui"


def test_resolve_effective_record_falls_back_to_capture_then_sync():
    now = datetime.now(timezone.utc)

    capture_info = resolve_effective_record(
        last_object_observed_at=None,
        last_object_source_status=None,
        last_object_source_name=None,
        last_capture_at=now - timedelta(minutes=3),
        last_sync_at=now - timedelta(minutes=7),
        fallback_source_status="cached",
    )
    assert capture_info.recorded_at == now - timedelta(minutes=3)
    assert capture_info.source_status == "cached"
    assert capture_info.source_name is None

    sync_info = resolve_effective_record(
        last_object_observed_at=None,
        last_object_source_status=None,
        last_object_source_name=None,
        last_capture_at=None,
        last_sync_at=now - timedelta(minutes=7),
        fallback_source_status="offline",
    )
    assert sync_info.recorded_at == now - timedelta(minutes=7)
    assert sync_info.source_status == "offline"
    assert sync_info.source_name is None

    empty_info = resolve_effective_record(
        last_object_observed_at=None,
        last_object_source_status=None,
        last_object_source_name=None,
        last_capture_at=None,
        last_sync_at=None,
        fallback_source_status=None,
    )
    assert empty_info.recorded_at is None
    assert empty_info.source_status == UNKNOWN
