import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from app.routers import config, cameras
from fastapi import HTTPException

@pytest.mark.parametrize("table", ["company","person","equipment","vehicles","tag","access_portico"])
def test_delete_removes_row_even_when_it_has_active_column(monkeypatch,table):
    monkeypatch.setattr(config,"_table_exists",AsyncMock(return_value=True))
    monkeypatch.setattr(config,"_get_columns",AsyncMock(return_value={"id","active"}))
    result=Mock();result.mappings.return_value.first.return_value={"id":77}
    db=SimpleNamespace(execute=AsyncMock(return_value=result),commit=AsyncMock(),rollback=AsyncMock())
    asyncio.run(config._delete_row(db,table,77))
    assert str(db.execute.call_args.args[0]).startswith("DELETE FROM "+table)
    db.commit.assert_awaited_once()


def test_camera_delete_removes_source_and_map_references(monkeypatch):
    monkeypatch.setattr(cameras,"_require_camera_permission",AsyncMock())
    monkeypatch.setattr(cameras,"_ensure_camera_source_schema",AsyncMock())
    monkeypatch.setattr(cameras,"_fetch_camera_row",AsyncMock(return_value={"id":77,"name":"Test","source":"","source_type":"rtsp"}))
    monkeypatch.setattr(cameras,"CameraVideoOut",lambda **row:row)
    monkeypatch.setattr(cameras,"_next_camera_id",AsyncMock(return_value=78))
    db=SimpleNamespace(execute=AsyncMock(),commit=AsyncMock())
    asyncio.run(cameras.deactivate_camera_source(77,db,SimpleNamespace()))
    sql=[str(call.args[0]) for call in db.execute.call_args_list]
    assert any("DELETE FROM camera_video" in query for query in sql)
    assert any("DELETE FROM map_device" in query for query in sql)
    assert not any("SET is_active" in query for query in sql)
    db.commit.assert_awaited_once()


def test_list_does_not_recreate_deleted_support_devices(monkeypatch):
    monkeypatch.setattr(cameras,"_ensure_camera_source_schema",AsyncMock())
    seed=AsyncMock(side_effect=AssertionError("Reads must not insert devices"))
    monkeypatch.setattr(cameras,"_ensure_default_nok_support_devices",seed)
    monkeypatch.setattr(cameras,"_sync_camera_map_devices",AsyncMock())
    result=Mock();result.mappings.return_value.all.return_value=[]
    db=SimpleNamespace(execute=AsyncMock(return_value=result))
    assert asyncio.run(cameras._fetch_camera_rows(db))==[]
    seed.assert_not_called()


def test_noc_keeps_inactive_configured_camera_and_drops_deleted_camera(monkeypatch):
    row = {"id": 77, "name": "Existing camera", "is_active": False,
           "nok_enabled": True, "map_code": "test-map", "x_pct": 10, "y_pct": 20}
    rows = [row]
    monkeypatch.setattr(cameras, "_fetch_camera_rows", AsyncMock(side_effect=lambda *args, **kwargs: list(rows)))
    monkeypatch.setattr(cameras, "_fetch_nok_map_entries", AsyncMock(return_value=[]))
    refresh = AsyncMock(return_value={})
    monkeypatch.setattr(cameras, "_refresh_camera_network_snapshot", refresh)
    monkeypatch.setattr(cameras, "_get_camera_network_interval_seconds", AsyncMock(return_value=30))
    asyncio.run(cameras._build_nok_camera_overview(SimpleNamespace()))
    assert [item["id"] for item in refresh.call_args.kwargs["rows"]] == [77]
    rows.clear()
    overview = asyncio.run(cameras._build_nok_camera_overview(SimpleNamespace()))
    assert refresh.call_args.kwargs["rows"] == []
    assert overview["summary"]["total_cameras"] == 0
