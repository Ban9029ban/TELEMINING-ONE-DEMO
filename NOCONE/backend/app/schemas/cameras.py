from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CameraVideoOut(BaseModel):
    id: int
    name: str
    device_kind: str = "camera"
    device_kind_label: str = "Camara"
    source: str
    source_type: str = "video_file"
    source_type_label: str = "Video local"
    camera_ip: str | None = None
    camera_port: int | None = None
    camera_path: str | None = None
    camera_user: str | None = None
    camera_password: str | None = None
    has_credentials: bool = False
    site: str | None = None
    nivel: str | None = None
    map_code: str | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    nok_map_code: str | None = None
    nok_x_pct: float | None = None
    nok_y_pct: float | None = None
    nok_alt_map_number: int | None = None
    nok_alt_display_name: str | None = None
    nok_enabled: bool = False
    nok_map_number: int | None = None
    nok_display_name: str | None = None
    notes: str | None = None
    resolved_source: str = ""
    playback_url: str = ""
    playback_kind: str = "video"
    uses_relay: bool = False
    is_live: bool = False
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class CameraSourceIn(BaseModel):
    name: str
    device_kind: str = "camera"
    source: str | None = None
    source_type: str = "video_file"
    camera_ip: str | None = None
    camera_port: int | None = None
    camera_path: str | None = None
    camera_user: str | None = None
    camera_password: str | None = None
    site: str | None = None
    nivel: str | None = None
    map_code: str | None = None
    x_pct: float | None = None
    y_pct: float | None = None
    nok_map_code: str | None = None
    nok_x_pct: float | None = None
    nok_y_pct: float | None = None
    nok_alt_map_number: int | None = None
    nok_alt_display_name: str | None = None
    nok_enabled: bool = False
    nok_map_number: int | None = None
    nok_display_name: str | None = None
    notes: str | None = None
    is_active: bool = True


class AiModelOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


class CamerasConfigOut(BaseModel):
    videos: list[CameraVideoOut]
    models: list[AiModelOut]


class CameraAnalyzeFrameIn(BaseModel):
    panel_key: str = "panel_0"
    video_id: int | None = None
    model_code: str = "operational_safety_monitor"
    include_operational: bool = False
    image_base64: str


class CameraDetectionOut(BaseModel):
    class_id: int | None = None
    class_name: str
    score: float
    x1: float
    y1: float
    x2: float
    y2: float


class CameraFindingOut(BaseModel):
    code: str
    label: str
    severity: str
    coverage: str
    zone: str
    confidence: float
    evidence: str
    uid: str


class CameraAnalyzeFrameOut(BaseModel):
    model_code: str
    persisted_count: int
    operational_detections: list[CameraDetectionOut] = []
    detections: list[CameraDetectionOut]
    findings: list[CameraFindingOut]


class CameraSourceProbeOut(BaseModel):
    ok: bool
    detail: str
    source_type: str
    uses_relay: bool
    playback_url: str | None = None


class CameraFindingSnapshotRowIn(BaseModel):
    code: str
    group: str
    label: str
    severity: str
    coverage: str
    coverage_mode: str | None = None
    active_count: int = 0
    total_count: int = 0
    last_seen_at: datetime | None = None
    last_evidence: str = ""


class CameraRecentFindingIn(BaseModel):
    event_id: str
    code: str
    group: str
    label: str
    severity: str
    coverage: str
    zone: str
    confidence: float = 0
    evidence: str = ""
    detected_at: datetime


class CameraAnalyticsSnapshotIn(BaseModel):
    panel_key: str = "panel_0"
    video_id: int
    model_code: str = "operational_safety_monitor"
    active_persons: int = 0
    active_vehicles: int = 0
    active_findings: int = 0
    cumulative_findings: int = 0
    summary_rows: list[CameraFindingSnapshotRowIn] = []
    recent_findings: list[CameraRecentFindingIn] = []


class CameraExternalFindingIn(BaseModel):
    external_event_id: str
    camera_id: int | None = None
    camera_name: str | None = None
    map_code: str | None = None
    panel_key: str = "external_panel"
    model_code: str = "external_ai"
    event_source: str = "external_ai"
    finding_code: str
    finding_group: str = "General"
    finding_label: str
    severity: str = "medium"
    coverage: str = "Tiempo real"
    zone: str = "-"
    confidence: float = 0
    evidence: str = ""
    detected_at: datetime | None = None
    active_persons: int | None = None
    active_vehicles: int | None = None
    active_findings: int | None = None
    cumulative_findings: int | None = None
    summary_rows: list[CameraFindingSnapshotRowIn] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)


class CameraExternalFindingOut(BaseModel):
    finding_event_id: int
    external_event_id: str
    video_id: int
    camera_name: str
    map_code: str | None = None
    evidence_video_url: str | None = None
    snapshot_updated: bool = False
    upload_evidence_url: str


class CameraEvidenceVideoUploadOut(BaseModel):
    finding_event_id: int
    evidence_video_url: str
    file_name: str
    content_type: str
    size_bytes: int
