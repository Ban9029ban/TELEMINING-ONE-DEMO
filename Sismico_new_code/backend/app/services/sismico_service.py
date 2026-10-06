from __future__ import annotations

from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.state_codes import CRITICAL, NORMAL, OFFLINE, STATE_COLORS, UNKNOWN, WARNING
from app.models.alert import AlertEvent
from app.models.external_source_capture import ExternalSourceCapture
from app.models.map_object import MapObject
from app.models.organization import Organization
from app.models.remote_endpoint import RemoteEndpoint
from app.models.remote_source import RemoteSource
from app.models.site import Site
from app.models.site_map import SiteMap
from app.models.sismico_runtime import ObjectCurrentState, SemaforoDevice, SismicoSyncRun
from app.schemas.sismico_contract import (
    SismicoActivePolygonItem,
    SismicoActivePolygonsResponse,
    SismicoAlertItem,
    SismicoHealthResponse,
    SismicoHealthSiteItem,
    SismicoMapDefinition,
    SismicoMapObject,
    SismicoObjectState,
    SismicoPollingRunResponse,
    SismicoPollingStatusResponse,
    SismicoRefreshConfig,
    SismicoSiteDetail,
    SismicoSiteInfo,
    SismicoSiteListItem,
    SismicoSiteStateResponse,
    SismicoSitesResponse,
    SismicoStateCatalogItem,
)
from app.services.legacy_source_adapter import defaults_for_site
from app.services.state_normalizer import display_label


@dataclass
class BlueprintObject:
    code: str
    name: str
    geometry_points: List[List[float]]
    state_mode: str = "dual"
    default_value: str = "NORMAL"
    overlay_assets: Dict[str, str] = field(default_factory=dict)
    legacy_codes: List[str] = field(default_factory=list)


SITE_BLUEPRINTS: Dict[str, Dict] = {
    "diamante": {
        "description": "Monitoreo sísmico reutilizable basado en lectura legacy Codelco/HDIS.",
        "map": {"image_url": "/assets/legacy/map.png", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject("diamante_pipa", "Diamante PIPA", [[180, 150], [260, 150], [260, 240], [180, 240]], "dual", "NORMAL"),
            BlueprintObject("footprint_hw", "FootPrint HW", [[720, 140], [940, 140], [940, 480], [720, 480]], "dual", "NORMAL"),
            BlueprintObject("footprint_fw", "FootPrint Fw", [[1160, 170], [1270, 170], [1270, 280], [1160, 280]], "dual", "NORMAL"),
            BlueprintObject("bde", "Bajo Diamante Esmeralda", [[760, 420], [1040, 420], [1040, 560], [760, 560]], "tri", "CENTRO"),
        ],
    },
    "andesita": {
        "description": "Lectura Andesita desde JSON/HTML legacy parametrizable.",
        "map": {"image_url": "/assets/legacy/img_andesita/ANDESITAMAP.jpg", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject("andesita_norte_hw", "Andesita Norte HW", [[910, 220], [1020, 220], [1020, 320], [910, 320]], "tri", "CENTRO"),
            BlueprintObject("andesita_norte_fw", "Andesita Norte FW", [[1360, 230], [1460, 230], [1460, 320], [1360, 320]], "tri", "CENTRO"),
            BlueprintObject("andesita_sur_hw", "Andesita Sur HW", [[920, 530], [1180, 530], [1180, 680], [920, 680]], "tri", "CENTRO"),
            BlueprintObject("andesita_sur_fw", "Andesita Sur FW", [[1210, 580], [1340, 580], [1340, 700], [1210, 700]], "tri", "CENTRO"),
        ],
    },
    "andes_norte": {
        "description": "Lectura Andes Norte basada en scraping legacy por patrones múltiples.",
        "map": {"image_url": "/legacy/updates-20260911/andesnorte/ANNI.jpg", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject("bajo_andesita_profundo", "Poligono Bajo Andesita Profundo", [[704, 150], [1024, 150], [1024, 610], [704, 610]], "tri", "CENTRO"),
            BlueprintObject("bajo_andesita_under", "Poligono Bajo Andesita Under", [[747, 335], [1024, 335], [1024, 610], [747, 610]], "tri", "CENTRO"),
            BlueprintObject("monitoreo_post_evento_2025", "Monitoreo Post Evento 2025", [[820, 120], [1120, 120], [1120, 300], [820, 300]], "tri", "CENTRO", legacy_codes=["ann_monitoreo_post_evento_2025"]),
            BlueprintObject("monitoreo_post_evento", "Monitoreo Post Evento", [[1180, 100], [1420, 100], [1420, 250], [1180, 250]], "dual", "NORMAL", legacy_codes=["ann_monitoreo_post_evento"]),
            BlueprintObject("monitoreo_post_evento_fw", "Monitoreo Post Evento FW", [[1180, 250], [1420, 250], [1420, 390], [1180, 390]], "dual", "NORMAL", legacy_codes=["ann_monitoreo_post_evento_fw"]),
            BlueprintObject("bajo_footprint_an", "Bajo Andes Norte", [[1100, 327], [1250, 327], [1250, 434], [1100, 434]], "tri", "CENTRO", legacy_codes=["ann_bajo_footprint_an", "ann_bajo_andes_norte", "bajo_andes_norte"]),
            BlueprintObject("adit_74_75", "ADIT 74 - 75", [[860, 180], [980, 180], [980, 300], [860, 300]], "tri", "CENTRO", legacy_codes=["ann_adit_74_75", "ann_adit_74_75_profundo"]),
            BlueprintObject("poligono_pilar_2", "Poligono Pilar 2", [[960, 360], [1030, 360], [1030, 430], [960, 430]], "tri", "CENTRO", legacy_codes=["ann_pilar_2", "ann_pilar_2_profundo"]),
            BlueprintObject("inicio_caving", "Inicio Caving", [[1120, 220], [1260, 220], [1260, 340], [1120, 340]], "tri", "CENTRO", legacy_codes=["ann_inicio_caving"]),
            BlueprintObject("pacifico", "Pacifico", [[960, 140], [1120, 140], [1120, 260], [960, 260]], "dual", "NORMAL", legacy_codes=["ann_pacifico"]),
            BlueprintObject("cabecera_fw_norte", "Cabecera FW Norte", [[1040, 420], [1220, 420], [1220, 520], [1040, 520]], "dual", "NORMAL", legacy_codes=["ann_cab_fw_norte", "ann_cabecera_fw_norte"]),
            BlueprintObject("cabecera_hw", "Cabecera HW", [[1040, 530], [1210, 530], [1210, 630], [1040, 630]], "dual", "NORMAL", legacy_codes=["ann_cab_hw", "ann_cabecera_hw"]),
            BlueprintObject("an_norte_hw", "AN Norte HW", [[1260, 420], [1420, 420], [1420, 520], [1260, 520]], "tri", "CENTRO", legacy_codes=["ann_an_norte_hw"]),
            BlueprintObject("an_norte_fw", "AN Norte FW", [[1260, 530], [1420, 530], [1420, 630], [1260, 630]], "tri", "CENTRO", legacy_codes=["ann_an_norte_fw"]),
            BlueprintObject("an_sur_hw", "AN Sur HW", [[1260, 640], [1420, 640], [1420, 740], [1260, 740]], "tri", "CENTRO", legacy_codes=["ann_an_sur_hw"]),
            BlueprintObject("tc_oim", "TC OIM", [[360, 460], [520, 460], [520, 560], [360, 560]], "traffic", "VERDE", legacy_codes=["ann_tc_oim"]),
            BlueprintObject("p_4600", "P 4600", [[360, 340], [460, 340], [460, 430], [360, 430]], "traffic", "VERDE", legacy_codes=["ann_p4600"]),
        ],
    },
    "andes_norte_tunel_correa": {
        "description": "Dashboard Túnel Correa basado en layout legacy con polígonos manuales y automáticos.",
        "map": {"image_url": "/legacy/updates-20260911/tunnelcorrea/TC.jpg", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject("tc_bajo_andesita_profundo", "Poligono Bajo Andesita Profundo", [[1133, 0], [1522, 0], [1522, 495], [1133, 495]], "tri", "CENTRO"),
            BlueprintObject("tc_bajo_andesita_under", "Poligono Bajo Andesita Under", [[1169, 126], [1527, 126], [1527, 495], [1169, 495]], "tri", "CENTRO"),
            BlueprintObject("tc_pilar_2_profundo", "Polígono Pilar 2 Profundo", [[980, 350], [1310, 350], [1310, 780], [980, 780]], "tri", "CENTRO"),
            BlueprintObject("tc_tc_oim", "TC OIM", [[1120, 150], [1410, 150], [1410, 360], [1120, 360]], "traffic", "VERDE"),
            BlueprintObject("tc_p_4600", "P 4600", [[520, 420], [930, 420], [930, 770], [520, 770]], "traffic", "VERDE"),
        ],
    },
    "pilar_norte": {
        "description": "Pilar Norte derivado del polígono legacy Pilar 2 de Andes Norte.",
        "map": {"image_url": "/assets/legacy/ANNI/ANNI.jpg", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject(
                "ann_pilar_2",
                "Poligono Pilar 2",
                [[950, 350], [1035, 350], [1035, 430], [950, 430]],
                "tri",
                "CENTRO",
                legacy_codes=["pilar_norte_inferior", "pilar_norte_centro", "pilar_norte_superior"],
            ),
        ],
    },
    "esmeralda": {
        "description": "Esmeralda derivado del polígono legacy Bajo Diamante Esmeralda.",
        "map": {"image_url": "/legacy/diamante/map.png", "width": 1600, "height": 900},
        "objects": [
            BlueprintObject(
                "diamante_bajo_diamante_esmeralda",
                "Bajo Diamante Esmeralda",
                [[810, 460], [1010, 460], [1010, 560], [810, 560]],
                "tri",
                "CENTRO",
                legacy_codes=["esmeralda_inferior", "esmeralda_centro", "esmeralda_superior"],
            ),
        ],
    },
}


def normalize_site_code(site_code: str) -> str:
    return (site_code or "").strip().lower().replace("-", "_")


def normalize_source_status(value: Optional[str]) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return UNKNOWN
    if raw in {"online", "offline", "cached", "manual", "unknown"}:
        return raw
    return raw


def build_source_message(source_status: Optional[str], error_message: Optional[str] = None) -> Optional[str]:
    if error_message:
        return error_message
    normalized = normalize_source_status(source_status)
    if normalized == "online":
        return "Fuentes externas operativas"
    if normalized == "cached":
        return "Usando ultima captura en cache"
    if normalized == "manual":
        return "Ultimo registro aplicado manualmente"
    if normalized == "offline":
        return "Fuentes externas sin lectura"
    return "Estado de fuentes externas no disponible"


@dataclass
class EffectiveRecordInfo:
    recorded_at: Optional[datetime]
    source_status: str = UNKNOWN
    source_name: Optional[str] = None


def resolve_effective_record(
    *,
    last_object_observed_at: Optional[datetime],
    last_object_source_status: Optional[str],
    last_object_source_name: Optional[str],
    last_capture_at: Optional[datetime],
    last_sync_at: Optional[datetime],
    fallback_source_status: Optional[str],
) -> EffectiveRecordInfo:
    fallback_status = normalize_source_status(fallback_source_status)
    object_status = normalize_source_status(last_object_source_status)
    if last_object_observed_at:
        return EffectiveRecordInfo(
            recorded_at=last_object_observed_at,
            source_status=(object_status if object_status != UNKNOWN else fallback_status),
            source_name=last_object_source_name,
        )
    if last_capture_at:
        return EffectiveRecordInfo(recorded_at=last_capture_at, source_status=fallback_status)
    if last_sync_at:
        return EffectiveRecordInfo(recorded_at=last_sync_at, source_status=fallback_status)
    return EffectiveRecordInfo(recorded_at=None, source_status=fallback_status)


class SismicoService:
    def __init__(self, db: Session):
        self.db = db

    def _site_name(self, code: str) -> str:
        return code.replace("_", " ").title()

    def _state_mode_for_object(self, obj_name: str) -> str:
        return "tri" if obj_name.lower() in {
            "bajo diamante esmeralda",
            "bajo andes norte",
            "monitoreo post evento 2025",
            "adit 74 - 75",
            "poligono pilar 2",
            "inicio caving",
            "an norte hw",
            "an norte fw",
            "an sur hw",
        } else "dual"

    def ensure_seeded_sites(self) -> None:
        org = self.db.query(Organization).filter(Organization.code == "telemining").first()
        if not org:
            org = Organization(code="telemining", name="Telemining", is_active=True)
            self.db.add(org)
            self.db.flush()

        for code, blueprint in SITE_BLUEPRINTS.items():
            site = self.db.query(Site).filter(Site.code == code).first()
            if not site:
                site = Site(
                    organization_id=org.id,
                    code=code,
                    name=self._site_name(code),
                    is_active=True,
                )
                self.db.add(site)
                self.db.flush()
            else:
                changed = False
                if site.organization_id != org.id:
                    site.organization_id = org.id
                    changed = True
                expected_name = self._site_name(code)
                if site.name != expected_name:
                    site.name = expected_name
                    changed = True
                if not site.is_active:
                    site.is_active = True
                    changed = True
                if changed:
                    self.db.flush()

            map_code = f"{code}_main"
            site_map = self.db.query(SiteMap).filter(SiteMap.code == map_code).first()
            if not site_map:
                site_map = SiteMap(
                    site_id=site.id,
                    code=map_code,
                    name=f"{site.name} principal",
                    image_url=blueprint["map"]["image_url"],
                    is_active=True,
                )
                self.db.add(site_map)
                self.db.flush()
            else:
                changed = False
                if site_map.site_id != site.id:
                    site_map.site_id = site.id
                    changed = True
                expected_map_name = f"{site.name} principal"
                if site_map.name != expected_map_name:
                    site_map.name = expected_map_name
                    changed = True
                if site_map.image_url != blueprint["map"]["image_url"]:
                    site_map.image_url = blueprint["map"]["image_url"]
                    changed = True
                if not site_map.is_active:
                    site_map.is_active = True
                    changed = True
                if changed:
                    self.db.flush()

            # Supersede the old TC template without deleting its objects/history.
            if code == "andes_norte_tunel_correa":
                legacy_map = self.db.query(SiteMap).filter(SiteMap.site_id == site.id, SiteMap.code == code).first()
                if legacy_map and legacy_map.id != site_map.id and legacy_map.is_active:
                    legacy_map.is_active = False
                    self.db.flush()

            for obj in blueprint["objects"]:
                map_object = (
                    self.db.query(MapObject)
                    .filter(MapObject.site_map_id == site_map.id, MapObject.code.in_([obj.code, *obj.legacy_codes]))
                    .order_by(MapObject.id.asc())
                    .first()
                )
                geometry_json = {"points": obj.geometry_points}
                if not map_object:
                    map_object = MapObject(
                        site_map_id=site_map.id,
                        code=obj.code,
                        name=obj.name,
                        object_type="polygon",
                        geometry_type="polygon",
                        geometry_json=geometry_json,
                        state_code="offline",
                        is_active=True,
                    )
                    self.db.add(map_object)
                    self.db.flush()
                else:
                    changed = False
                    if map_object.site_map_id != site_map.id:
                        map_object.site_map_id = site_map.id
                        changed = True
                    if map_object.code != obj.code:
                        map_object.code = obj.code
                        changed = True
                    if map_object.name != obj.name:
                        map_object.name = obj.name
                        changed = True
                    if map_object.object_type != "polygon":
                        map_object.object_type = "polygon"
                        changed = True
                    if map_object.geometry_type != "polygon":
                        map_object.geometry_type = "polygon"
                        changed = True
                    if (map_object.geometry_json or {}) != geometry_json:
                        map_object.geometry_json = geometry_json
                        changed = True
                    if not map_object.is_active:
                        map_object.is_active = True
                        changed = True
                    if changed:
                        self.db.flush()

            managed_legacy_codes = {
                legacy_code
                for obj in blueprint["objects"]
                for legacy_code in obj.legacy_codes
                if legacy_code and legacy_code != obj.code
            }
            if managed_legacy_codes:
                stale_objects = (
                    self.db.query(MapObject)
                    .filter(MapObject.site_map_id == site_map.id, MapObject.code.in_(list(managed_legacy_codes)))
                    .all()
                )
                for stale_object in stale_objects:
                    if stale_object.is_active:
                        stale_object.is_active = False
                        self.db.flush()

            source_code = f"{code}_source"
            remote_source = self.db.query(RemoteSource).filter(RemoteSource.code == source_code).first()
            if not remote_source:
                remote_source = RemoteSource(
                    site_id=site.id,
                    code=source_code,
                    name=f"{site.name} source",
                    source_type="api_rest",
                    base_url="",
                    is_active=True,
                )
                self.db.add(remote_source)
                self.db.flush()
            else:
                changed = False
                if remote_source.site_id != site.id:
                    remote_source.site_id = site.id
                    changed = True
                if remote_source.name != f"{site.name} source":
                    remote_source.name = f"{site.name} source"
                    changed = True
                if remote_source.source_type != "api_rest":
                    remote_source.source_type = "api_rest"
                    changed = True
                if remote_source.base_url is None:
                    remote_source.base_url = ""
                    changed = True
                if not remote_source.is_active:
                    remote_source.is_active = True
                    changed = True
                if changed:
                    self.db.flush()

            for default_endpoint in defaults_for_site(code):
                endpoint = self.db.query(RemoteEndpoint).filter(RemoteEndpoint.code == default_endpoint["code"]).first()
                if not endpoint:
                    endpoint = RemoteEndpoint(
                        remote_source_id=remote_source.id,
                        site_id=site.id,
                        code=default_endpoint["code"],
                        name=default_endpoint["name"],
                        endpoint_url=default_endpoint["endpoint_url"],
                        endpoint_kind=default_endpoint["endpoint_kind"],
                        polling_seconds=default_endpoint["polling_seconds"],
                        parser_type=default_endpoint["parser_type"],
                        is_enabled=True,
                    )
                    self.db.add(endpoint)
                    self.db.flush()
                else:
                    changed = False
                    if endpoint.remote_source_id != remote_source.id:
                        endpoint.remote_source_id = remote_source.id
                        changed = True
                    if endpoint.site_id != site.id:
                        endpoint.site_id = site.id
                        changed = True
                    for field_name in ["name", "endpoint_url", "endpoint_kind", "polling_seconds", "parser_type"]:
                        new_value = default_endpoint[field_name]
                        if getattr(endpoint, field_name) != new_value:
                            setattr(endpoint, field_name, new_value)
                            changed = True
                    if not endpoint.is_enabled:
                        endpoint.is_enabled = True
                        changed = True
                    if changed:
                        self.db.flush()

        self.db.commit()

    def list_sites(self) -> SismicoSitesResponse:
        self.ensure_seeded_sites()
        items = []
        sites = self.db.query(Site).filter(Site.is_active == True).order_by(Site.name.asc()).all()
        for site in sites:
            last_run = (
                self.db.query(SismicoSyncRun)
                .filter(SismicoSyncRun.site_id == site.id)
                .order_by(SismicoSyncRun.started_at.desc())
                .first()
            )
            site_map = self.db.query(SiteMap).filter(SiteMap.site_id == site.id, SiteMap.is_active == True).first()
            items.append(
                SismicoSiteListItem(
                    code=site.code,
                    name=site.name,
                    status=normalize_source_status(last_run.source_status if last_run else UNKNOWN),
                    last_sync_at=(last_run.finished_at or last_run.started_at) if last_run else None,
                    has_map=bool(site_map and site_map.image_url),
                )
            )
        return SismicoSitesResponse(items=items)

    def get_site_definition(self, site_code: str) -> SismicoSiteDetail:
        self.ensure_seeded_sites()
        code = normalize_site_code(site_code)
        site = self.db.query(Site).filter(Site.code == code).first()
        if not site:
            raise ValueError(f"Site {site_code} no encontrado")

        blueprint = SITE_BLUEPRINTS.get(code, {"description": site.name, "map": {"image_url": None, "width": 1600, "height": 900}, "objects": []})
        blueprint_modes = {}
        blueprint_default_values = {}
        for blueprint_object in blueprint.get("objects", []):
            blueprint_modes[blueprint_object.code] = blueprint_object.state_mode
            blueprint_default_values[blueprint_object.code] = blueprint_object.default_value
            for legacy_code in blueprint_object.legacy_codes:
                blueprint_modes[legacy_code] = blueprint_object.state_mode
                blueprint_default_values[legacy_code] = blueprint_object.default_value
        site_map = self.db.query(SiteMap).filter(SiteMap.site_id == site.id, SiteMap.is_active == True).first()
        objects = (
            self.db.query(MapObject)
            .filter(MapObject.site_map_id == site_map.id if site_map else None, MapObject.is_active == True)
            .order_by(MapObject.name.asc())
            .all()
            if site_map
            else []
        )

        object_models = []
        for obj in objects:
            object_models.append(
                SismicoMapObject(
                    code=obj.code,
                    name=obj.name,
                    type="polygon",
                    geometry={"points": (obj.geometry_json or {}).get("points", [])},
                    state_mode=blueprint_modes.get(obj.code, self._state_mode_for_object(obj.name)),
                    overlay_assets={},
                    default_state_value=blueprint_default_values.get(obj.code, "NORMAL"),
                )
            )

        state_catalog = [
            SismicoStateCatalogItem(code=NORMAL, label="Normal", color=STATE_COLORS[NORMAL]),
            SismicoStateCatalogItem(code=WARNING, label="Advertencia / Centro", color=STATE_COLORS[WARNING]),
            SismicoStateCatalogItem(code=CRITICAL, label="Crítico / Alerta", color=STATE_COLORS[CRITICAL]),
            SismicoStateCatalogItem(code=OFFLINE, label="Fuente externa OFF", color=STATE_COLORS[OFFLINE]),
            SismicoStateCatalogItem(code=UNKNOWN, label="Desconocido", color=STATE_COLORS[UNKNOWN]),
        ]

        refresh_seconds = 15
        endpoint = self._first_enabled_endpoint(site.id)
        if endpoint and endpoint.polling_seconds:
            refresh_seconds = endpoint.polling_seconds

        return SismicoSiteDetail(
            site=SismicoSiteInfo(code=site.code, name=site.name, description=blueprint["description"]),
            map=SismicoMapDefinition(
                code=(site_map.code if site_map else code),
                name=(site_map.name if site_map else site.name),
                image_url=(site_map.image_url if site_map and site_map.image_url else blueprint["map"]["image_url"]),
                width=blueprint["map"]["width"],
                height=blueprint["map"]["height"],
            ),
            objects=object_models,
            overlays=[],
            state_catalog=state_catalog,
            refresh=SismicoRefreshConfig(polling_seconds=refresh_seconds),
        )

    def get_active_polygons(self) -> SismicoActivePolygonsResponse:
        rows = (
            self.db.query(ObjectCurrentState, MapObject, SiteMap, Site)
            .join(MapObject, MapObject.id == ObjectCurrentState.map_object_id)
            .join(SiteMap, SiteMap.id == MapObject.site_map_id)
            .join(Site, Site.id == SiteMap.site_id)
            .filter(
                Site.is_active == True,
                SiteMap.is_active == True,
                MapObject.is_active == True,
                ObjectCurrentState.state_code.in_([WARNING, CRITICAL]),
            )
            .order_by(ObjectCurrentState.observed_at.desc().nullslast(), ObjectCurrentState.updated_at.desc())
            .all()
        )

        return SismicoActivePolygonsResponse(
            items=[
                SismicoActivePolygonItem(
                    map_object_id=current.map_object_id,
                    site_code=site.code,
                    site_name=site.name,
                    map_code=site_map.code,
                    map_name=site_map.name,
                    polygon_code=map_object.code,
                    polygon_name=map_object.name,
                    state_code=current.state_code,
                    state_label=display_label(current.raw_value, current.state_code),
                    observed_at=current.observed_at,
                    updated_at=current.updated_at,
                )
                for current, map_object, site_map, site in rows
            ]
        )

    def get_site_current_state(self, site_code: str) -> SismicoSiteStateResponse:
        self.ensure_seeded_sites()
        code = normalize_site_code(site_code)
        site = self.db.query(Site).filter(Site.code == code).first()
        if not site:
            raise ValueError(f"Site {site_code} no encontrado")

        last_run = (
            self.db.query(SismicoSyncRun)
            .filter(SismicoSyncRun.site_id == site.id)
            .order_by(SismicoSyncRun.started_at.desc())
            .first()
        )
        objects = (
            self.db.query(MapObject, ObjectCurrentState)
            .outerjoin(ObjectCurrentState, ObjectCurrentState.map_object_id == MapObject.id)
            .join(SiteMap, SiteMap.id == MapObject.site_map_id)
            .filter(SiteMap.site_id == site.id, MapObject.is_active == True)
            .order_by(MapObject.name.asc())
            .all()
        )
        from app.services.polygon_control_mode import control_rows
        modes = control_rows(self.db)
        object_states = []
        last_object_observed_at = None
        last_object_source_status = None
        last_object_source_name = None
        for obj, current in objects:
            state_code = current.state_code if current else OFFLINE
            raw_value = current.raw_value if current else ""
            current_observed_at = current.observed_at if current else None
            current_source_status = normalize_source_status(current.source_status if current else None)
            object_states.append(
                SismicoObjectState(
                    control_mode=modes.get(obj.id, {}).get('mode', 'auto'),
                    control_updated_at=modes.get(obj.id, {}).get('updated_at'),
                    object_code=obj.code,
                    object_name=obj.name,
                    state_code=state_code,
                    label=display_label(raw_value, state_code),
                    value=(raw_value or display_label(raw_value, state_code)),
                    operational_state=(raw_value or None),
                    source_name=(current.source_name if current else None),
                    source_status=(current_source_status if current else None),
                    observed_at=current_observed_at,
                )
            )
            if current_observed_at and (last_object_observed_at is None or current_observed_at > last_object_observed_at):
                last_object_observed_at = current_observed_at
                last_object_source_status = current_source_status
                last_object_source_name = current.source_name if current else None

        alerts = (
            self.db.query(AlertEvent)
            .filter(AlertEvent.site_id == site.id, AlertEvent.status == "open")
            .order_by(AlertEvent.opened_at.desc())
            .all()
        )
        last_capture_at = (
            self.db.query(func.max(ExternalSourceCapture.observed_at))
            .filter(ExternalSourceCapture.site_code == site.code)
            .scalar()
        )

        source_status = normalize_source_status(last_run.source_status if last_run else OFFLINE)
        last_sync_at = (last_run.finished_at or last_run.started_at) if last_run else None
        effective_record = resolve_effective_record(
            last_object_observed_at=last_object_observed_at,
            last_object_source_status=last_object_source_status,
            last_object_source_name=last_object_source_name,
            last_capture_at=last_capture_at,
            last_sync_at=last_sync_at,
            fallback_source_status=source_status,
        )
        source_message = build_source_message(source_status, last_run.error_message if last_run else None)
        return SismicoSiteStateResponse(
            site_code=site.code,
            source_status=source_status,
            external_sources_online=source_status == "online",
            source_message=source_message,
            last_sync_at=last_sync_at,
            last_capture_at=last_capture_at,
            last_effective_record_at=effective_record.recorded_at,
            last_effective_source_status=effective_record.source_status,
            last_effective_source_name=effective_record.source_name,
            alerts=[
                SismicoAlertItem(code=f"alert_{a.id}", level=a.severity, message=a.message or a.title)
                for a in alerts
            ],
            object_states=object_states,
        )

    def get_polling_status(self, site_code: str) -> SismicoPollingStatusResponse:
        self.ensure_seeded_sites()
        code = normalize_site_code(site_code)
        site = self.db.query(Site).filter(Site.code == code).first()
        if not site:
            raise ValueError(f"Site {site_code} no encontrado")

        last_run = (
            self.db.query(SismicoSyncRun)
            .filter(SismicoSyncRun.site_id == site.id)
            .order_by(SismicoSyncRun.started_at.desc())
            .first()
        )
        run_model = None
        if last_run:
            normalized_run_status = normalize_source_status(last_run.source_status)
            run_model = SismicoPollingRunResponse(
                ok=last_run.status == "completed",
                site_code=site.code,
                run_id=last_run.id,
                status=last_run.status,
                source_status=normalized_run_status,
                external_sources_online=normalized_run_status == "online",
                processed_objects=last_run.records_mapped or 0,
                started_at=last_run.started_at,
                finished_at=last_run.finished_at,
                error_message=last_run.error_message,
            )

        source_status = normalize_source_status(last_run.source_status if last_run else OFFLINE)
        return SismicoPollingStatusResponse(
            site_code=site.code,
            source_status=source_status,
            external_sources_online=source_status == "online",
            source_message=build_source_message(source_status, last_run.error_message if last_run else None),
            last_run=run_model,
        )

    def get_health(self) -> SismicoHealthResponse:
        self.ensure_seeded_sites()
        sites = self.db.query(Site).filter(Site.is_active == True).order_by(Site.name.asc()).all()
        items = []
        for site in sites:
            last_run = (
                self.db.query(SismicoSyncRun)
                .filter(SismicoSyncRun.site_id == site.id)
                .order_by(SismicoSyncRun.started_at.desc())
                .first()
            )
            alerts_open = self.db.query(func.count(AlertEvent.id)).filter(AlertEvent.site_id == site.id, AlertEvent.status == "open").scalar() or 0
            semaforo_enabled = self.db.query(func.count(SemaforoDevice.id)).filter(SemaforoDevice.site_id == site.id, SemaforoDevice.enabled == True).scalar() > 0
            source_status = normalize_source_status(last_run.source_status if last_run else OFFLINE)
            items.append(
                SismicoHealthSiteItem(
                    site_code=site.code,
                    source_status=source_status,
                    external_sources_online=source_status == "online",
                    last_sync_at=(last_run.finished_at or last_run.started_at) if last_run else None,
                    alerts_open=alerts_open,
                    semaforo_enabled=semaforo_enabled,
                )
            )
        return SismicoHealthResponse(db_status="online", polling_status="online", sites=items)

    def _first_enabled_endpoint(self, site_id: int):
        return (
            self.db.query(RemoteEndpoint)
            .filter(RemoteEndpoint.site_id == site_id, RemoteEndpoint.is_enabled == True)
            .order_by(RemoteEndpoint.id.asc())
            .first()
        )
