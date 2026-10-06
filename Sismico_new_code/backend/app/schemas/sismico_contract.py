from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SismicoMapDefinition(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    image_url: Optional[str] = None
    width: int = 1920
    height: int = 1080


class SismicoGeometry(BaseModel):
    points: List[List[float]] = Field(default_factory=list)


class SismicoMapObject(BaseModel):
    code: str
    name: str
    type: Literal["polygon", "polyline", "point"] = "polygon"
    geometry: SismicoGeometry = Field(default_factory=SismicoGeometry)
    state_mode: Literal["dual", "tri", "quad"] = "dual"
    overlay_assets: Dict[str, str] = Field(default_factory=dict)
    default_state_value: str = "NORMAL"


class SismicoOverlay(BaseModel):
    code: str
    name: str
    type: Literal["image", "polyline", "polygon"] = "image"
    image_url: Optional[str] = None
    geometry: Optional[SismicoGeometry] = None


class SismicoStateCatalogItem(BaseModel):
    code: str
    label: str
    color: str


class SismicoSiteListItem(BaseModel):
    code: str
    name: str
    status: str
    last_sync_at: Optional[datetime] = None
    has_map: bool = False


class SismicoSiteInfo(BaseModel):
    code: str
    name: str
    description: Optional[str] = None


class SismicoRefreshConfig(BaseModel):
    polling_seconds: int = 30


class SismicoSiteDetail(BaseModel):
    site: SismicoSiteInfo
    map: SismicoMapDefinition
    objects: List[SismicoMapObject] = Field(default_factory=list)
    overlays: List[SismicoOverlay] = Field(default_factory=list)
    state_catalog: List[SismicoStateCatalogItem] = Field(default_factory=list)
    refresh: SismicoRefreshConfig = Field(default_factory=SismicoRefreshConfig)


class SismicoAlertItem(BaseModel):
    code: str
    level: str
    message: str


class SismicoObjectState(BaseModel):
    control_mode: str = 'manual'
    control_updated_at: Optional[datetime] = None
    object_code: str
    object_name: str
    state_code: str
    label: str
    value: str
    operational_state: Optional[str] = None
    source_name: Optional[str] = None
    source_status: Optional[str] = None
    observed_at: Optional[datetime] = None


class SismicoSiteStateResponse(BaseModel):
    site_code: str
    source_status: str
    external_sources_online: bool
    last_sync_at: Optional[datetime] = None
    last_capture_at: Optional[datetime] = None
    last_effective_record_at: Optional[datetime] = None
    last_effective_source_status: str = "unknown"
    last_effective_source_name: Optional[str] = None
    source_message: Optional[str] = None
    alerts: List[SismicoAlertItem] = Field(default_factory=list)
    object_states: List[SismicoObjectState] = Field(default_factory=list)


class SismicoSitesResponse(BaseModel):
    items: List[SismicoSiteListItem] = Field(default_factory=list)


class SismicoActivePolygonItem(BaseModel):
    map_object_id: int
    site_code: str
    site_name: str
    map_code: str
    map_name: str
    polygon_code: str
    polygon_name: str
    state_code: str
    state_label: str
    observed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class SismicoActivePolygonsResponse(BaseModel):
    items: List[SismicoActivePolygonItem] = Field(default_factory=list)


class SismicoPollingRunRequest(BaseModel):
    site_code: str
    force_endpoint_code: Optional[str] = None
    payload: Optional[dict] = None


class SismicoPollingRunResponse(BaseModel):
    ok: bool
    site_code: str
    run_id: Optional[int] = None
    status: str
    source_status: str = "unknown"
    external_sources_online: bool = False
    processed_objects: int = 0
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None


class SismicoPollingStatusResponse(BaseModel):
    site_code: str
    source_status: str
    external_sources_online: bool
    source_message: Optional[str] = None
    last_run: Optional[SismicoPollingRunResponse] = None


class SismicoHealthSiteItem(BaseModel):
    site_code: str
    source_status: str
    external_sources_online: bool
    last_sync_at: Optional[datetime] = None
    alerts_open: int = 0
    semaforo_enabled: bool = False


class SismicoHealthResponse(BaseModel):
    db_status: str
    polling_status: str
    sites: List[SismicoHealthSiteItem] = Field(default_factory=list)


class ParserRowItem(BaseModel):
    name: str
    raw_text: str = ""
    image_url: Optional[str] = None
    detected_state: Optional[str] = None
    source_mode: str = "text"


class ParserMatchItem(BaseModel):
    expected_polygon: str
    matched_row_name: Optional[str] = None
    operational_state: Optional[str] = None
    source_mode: str = "none"
    score: Optional[int] = None
    image_url: Optional[str] = None
    raw_text: Optional[str] = None
    notes: str = ""


class EndpointDiagnosticsItem(BaseModel):
    endpoint_code: str
    endpoint_name: str
    endpoint_url: str
    parser_type: str
    ok: bool
    status: str
    source_status: str
    rows_captured: int = 0
    matches: List[ParserMatchItem] = Field(default_factory=list)
    rows: List[ParserRowItem] = Field(default_factory=list)
    payload_excerpt: Optional[str] = None
    error_message: Optional[str] = None


class ObjectMappingTraceItem(BaseModel):
    object_code: str
    object_name: str
    mapped: bool
    expected_polygon: Optional[str] = None
    endpoint_code: Optional[str] = None
    endpoint_name: Optional[str] = None
    operational_state: Optional[str] = None
    notes: str = ""


class MissingPolygonItem(BaseModel):
    polygon_name: str
    endpoint_code: Optional[str] = None
    endpoint_name: Optional[str] = None
    operational_state: Optional[str] = None
    matched_row_name: Optional[str] = None
    reason: str


class SismicoDiagnosticsResponse(BaseModel):
    ok: bool
    site_code: str
    site_name: str
    run_id: Optional[int] = None
    status: str
    source_status: str = "unknown"
    external_sources_online: bool = False
    legacy_page: Optional[str] = None
    legacy_description: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    endpoints: List[EndpointDiagnosticsItem] = Field(default_factory=list)
    object_mappings: List[ObjectMappingTraceItem] = Field(default_factory=list)
    missing_polygons: List[MissingPolygonItem] = Field(default_factory=list)
    missing_aliases: List[str] = Field(default_factory=list)
    rows_total: int = 0
    mapped_objects_count: int = 0
    error_message: Optional[str] = None


class SemaforoConfigItem(BaseModel):
    site_code: str
    site_name: str
    devices: List[Dict[str, Any]] = Field(default_factory=list)
    rules: List[Dict[str, Any]] = Field(default_factory=list)


class SemaforoExecuteRequest(BaseModel):
    site_code: str
    action: Literal["rojo", "verde"]
    requested_by: str = "api"
    dry_run: bool = False


class SemaforoExecuteResponse(BaseModel):
    ok: bool
    site_code: str
    action: str
    results: List[Dict[str, Any]] = Field(default_factory=list)
