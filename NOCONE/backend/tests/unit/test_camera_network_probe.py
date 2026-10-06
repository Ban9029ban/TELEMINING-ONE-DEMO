import asyncio
from unittest.mock import AsyncMock, Mock
import pytest
from app.routers import cameras


@pytest.mark.parametrize("online", [True, False])
def test_camera_requires_protocol_reply_when_ping_fails_even_if_tcp_accepts(monkeypatch, online):
    monkeypatch.setattr(cameras, "_run_icmp_ping", AsyncMock(return_value=(False,1,"timeout","icmp")))
    monkeypatch.setattr(cameras, "_run_tcp_probe", AsyncMock(return_value=(True,1,None,"tcp")))
    monkeypatch.setattr(cameras, "_run_rtsp_probe", AsyncMock(return_value=(online,12,None)))
    result=asyncio.run(cameras._probe_camera_network({"id":1,"camera_ip":"192.0.2.10","camera_port":554}))
    assert result.is_online is online
    assert result.check_method == "rtsp"


@pytest.mark.parametrize("reply,online", [
    (b"RTSP/1.0 200 OK\r\nCSeq: 7183\r\n\r\n",True),
    (b"RTSP/1.0 401 Unauthorized\r\nCSeq: 7183\r\n\r\n",True),
    (b"HTTP/1.1 200 OK\r\nCSeq: 7183\r\n\r\n",False),
    (b"RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n",False),
])
def test_rtsp_validates_response_and_request_sequence(monkeypatch, reply, online):
    reader=Mock(readuntil=AsyncMock(return_value=reply))
    writer=Mock(drain=AsyncMock(),wait_closed=AsyncMock())
    monkeypatch.setattr(cameras.asyncio,"open_connection",AsyncMock(return_value=(reader,writer)))
    assert asyncio.run(cameras._run_rtsp_probe("192.0.2.10",554))[0] is online
    writer.close.assert_called_once()


def test_tcp_accept_without_reply_is_offline(monkeypatch):
    reader=Mock(readuntil=AsyncMock(side_effect=asyncio.TimeoutError()))
    writer=Mock(drain=AsyncMock(),wait_closed=AsyncMock())
    monkeypatch.setattr(cameras.asyncio,"open_connection",AsyncMock(return_value=(reader,writer)))
    assert not asyncio.run(cameras._run_rtsp_probe("192.0.2.10",554))[0]
    writer.close.assert_called_once()


@pytest.mark.parametrize("device_kind", ["camera", "gate", "fan"])
def test_ping_is_sufficient_for_network_connectivity_without_video(monkeypatch, device_kind):
    monkeypatch.setattr(cameras, "_run_icmp_ping", AsyncMock(return_value=(True, 7, None, "icmp")))
    protocol=AsyncMock(side_effect=AssertionError("Ping already confirmed connectivity"))
    monkeypatch.setattr(cameras,"_run_rtsp_probe",protocol)
    monkeypatch.setattr(cameras,"_probe_camera_stream_available",protocol)
    result=asyncio.run(cameras._probe_camera_network({"id":1,"camera_ip":"192.168.100.176","device_kind":device_kind}))
    assert result.is_online
    assert result.check_method == "icmp"
    assert result.response_ms == 7
    assert result.error_detail is None
    protocol.assert_not_called()
