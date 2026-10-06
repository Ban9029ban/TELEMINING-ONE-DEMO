from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.state_codes import CRITICAL, NORMAL, OFFLINE, STATE_COLORS, UNKNOWN, WARNING
from app.services.state_normalizer import normalize_state

SOURCE_STATUS_ORDER = ["online", "cached", "manual", "offline", "unknown"]
SOURCE_STATUS_COLORS = {
    "online": "#22c55e",
    "cached": "#f59e0b",
    "manual": "#2563eb",
    "offline": "#ef4444",
    "unknown": "#64748b",
}
SOURCE_STATUS_LABELS = {
    "online": "Online",
    "cached": "Cached",
    "manual": "Manual",
    "offline": "Offline",
    "unknown": "Unknown",
}

ALERT_SEVERITY_ORDER = ["critical", "high", "medium", "low", "info", "unknown"]
ALERT_SEVERITY_COLORS = {
    "critical": "#7f1d1d",
    "high": "#ef4444",
    "medium": "#f59e0b",
    "low": "#22c55e",
    "info": "#2563eb",
    "unknown": "#64748b",
}
ALERT_SEVERITY_LABELS = {
    "critical": "Critica",
    "high": "Alta",
    "medium": "Media",
    "low": "Baja",
    "info": "Info",
    "unknown": "Unknown",
}

STATE_ORDER = [NORMAL, WARNING, CRITICAL, OFFLINE, UNKNOWN]
STATE_LABELS = {
    NORMAL: "Normal",
    WARNING: "Warning",
    CRITICAL: "Critical",
    OFFLINE: "Offline",
    UNKNOWN: "Unknown",
}

RANGE_PRESETS = {
    "24h": {"label": "Ultimas 24 h", "delta": timedelta(hours=24)},
    "7d": {"label": "Ultimos 7 dias", "delta": timedelta(days=7)},
    "30d": {"label": "Ultimos 30 dias", "delta": timedelta(days=30)},
    "90d": {"label": "Ultimos 90 dias", "delta": timedelta(days=90)},
    "custom": {"label": "Personalizado", "delta": None},
}

INTERVAL_LABELS = {
    "auto": "Auto",
    "hour": "Hora",
    "day": "Dia",
    "week": "Semana",
}

FRESHNESS_STALE_MINUTES = 15
SCATTER_POINT_LIMIT = 240


@dataclass
class ResolvedFilters:
    site_code: Optional[str]
    map_code: Optional[str]
    range_key: str
    interval: str
    bucket: str
    top_n: int
    started_at: datetime
    finished_at: datetime
    generated_at: datetime


def _format_metric_number(value: int) -> str:
    return f"{int(value):,}".replace(",", ".")


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _format_datetime_label(value: Optional[datetime]) -> str:
    if not value:
        return "Sin dato"
    return value.astimezone(timezone.utc).strftime("%d-%m-%Y %H:%M UTC")


def _state_bucket_sql(primary_expr: str, fallback_expr: str) -> str:
    normalized = (
        f"COALESCE(NULLIF(LOWER({primary_expr}), ''), "
        f"NULLIF(LOWER({fallback_expr}), ''), 'offline')"
    )
    return f"""
        CASE
            WHEN {normalized} IN ('normal', 'verde', 'green', 'ok', 'centro', 'center', 'middle', 'media') THEN 'normal'
            WHEN {normalized} IN ('warning', 'warn', 'amarillo', 'yellow') THEN 'warning'
            WHEN {normalized} IN ('alerta', 'alta', 'superior', 'inferior', 'critical', 'critico', 'rojo', 'red', 'baja') THEN 'critical'
            WHEN {normalized} IN ('offline', 'off', 'sin datos', 'sin_datos', 'nodata') THEN 'offline'
            ELSE 'unknown'
        END
    """


def _severity_bucket(value: Optional[str]) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"critical", "critica", "critico"}:
        return "critical"
    if raw in {"high", "alta", "alto"}:
        return "high"
    if raw in {"medium", "media", "warning"}:
        return "medium"
    if raw in {"low", "baja", "bajo"}:
        return "low"
    if raw in {"info", "informacion", "informativo"}:
        return "info"
    return "unknown"


def _source_status_bucket(value: Optional[str]) -> str:
    raw = str(value or "").strip().lower()
    if raw in SOURCE_STATUS_ORDER:
        return raw
    return "unknown"


class ProductivityService:
    def __init__(self, db: Session):
        self.db = db

    def get_filters(self) -> dict:
        sites = self.db.execute(
            text(
                """
                SELECT s.code, s.name
                FROM site s
                WHERE COALESCE(s.is_active, TRUE) = TRUE
                ORDER BY s.name ASC
                """
            )
        ).mappings().all()
        maps = self.db.execute(
            text(
                """
                SELECT sm.code, sm.name, s.code AS site_code, s.name AS site_name
                FROM site_map sm
                JOIN site s ON s.id = sm.site_id
                WHERE COALESCE(sm.is_active, TRUE) = TRUE
                  AND COALESCE(s.is_active, TRUE) = TRUE
                ORDER BY s.name ASC, sm.name ASC
                """
            )
        ).mappings().all()

        return {
            "sites": [dict(row) for row in sites],
            "maps": [dict(row) for row in maps],
            "range_options": [
                {"code": code, "label": spec["label"]}
                for code, spec in RANGE_PRESETS.items()
            ],
            "interval_options": [
                {"code": code, "label": label}
                for code, label in INTERVAL_LABELS.items()
            ],
            "defaults": {
                "site_code": "all",
                "map_code": "all",
                "range_key": "7d",
                "interval": "auto",
                "top_n": 8,
                "refresh_seconds": 45,
            },
        }

    def get_dashboard(
        self,
        *,
        site_code: Optional[str] = None,
        map_code: Optional[str] = None,
        range_key: str = "7d",
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        interval: str = "auto",
        top_n: int = 8,
    ) -> dict:
        filters = self._resolve_filters(
            site_code=site_code,
            map_code=map_code,
            range_key=range_key,
            date_from=date_from,
            date_to=date_to,
            interval=interval,
            top_n=top_n,
        )

        summary = self._build_summary(filters)
        charts = [
            self._build_events_timeline_chart(filters),
            self._build_current_state_chart(filters),
            self._build_alerts_chart(filters),
            self._build_top_polygons_chart(filters),
            self._build_sync_correlation_chart(filters),
            self._build_source_status_chart(filters),
            self._build_activity_by_map_chart(filters),
            self._build_freshness_chart(filters),
        ]

        return {
            "generated_at": filters.generated_at.isoformat(),
            "filters": {
                "site_code": filters.site_code or "all",
                "map_code": filters.map_code or "all",
                "range_key": filters.range_key,
                "interval": filters.interval,
                "bucket": filters.bucket,
                "top_n": filters.top_n,
                "date_from": filters.started_at.isoformat(),
                "date_to": filters.finished_at.isoformat(),
                "refresh_seconds": 45,
            },
            "summary": summary,
            "charts": charts,
        }

    def get_summary_legacy(self, **kwargs) -> dict:
        dashboard = self.get_dashboard(**kwargs)
        metrics = {item["key"]: item for item in dashboard["summary"]}
        return {
            "events_total": metrics.get("events_total", {}).get("raw_value", 0),
            "alerts_open": metrics.get("alerts_open", {}).get("raw_value", 0),
            "sync_runs_total": metrics.get("sync_runs_total", {}).get("raw_value", 0),
            "energy_total": "No aplica",
            "totals": {
                "events_total": metrics.get("events_total", {}).get("raw_value", 0),
                "alerts_open": metrics.get("alerts_open", {}).get("raw_value", 0),
                "sync_runs_total": metrics.get("sync_runs_total", {}).get("raw_value", 0),
                "energy_total": "No aplica",
            },
        }

    def get_chart_legacy(self, **kwargs) -> list[dict]:
        chart = self._build_activity_by_map_chart(self._resolve_filters(**kwargs))
        items = []
        for item in chart.get("items", []):
            items.append(
                {
                    "label": item["label"],
                    "events": item["raw_value"],
                    "energy": item.get("secondary_raw_value", 0),
                }
            )
        return items

    def _resolve_filters(
        self,
        *,
        site_code: Optional[str],
        map_code: Optional[str],
        range_key: str,
        date_from: Optional[datetime],
        date_to: Optional[datetime],
        interval: str,
        top_n: int,
    ) -> ResolvedFilters:
        generated_at = datetime.now(timezone.utc)
        normalized_site = None if not site_code or site_code == "all" else site_code
        normalized_map = None if not map_code or map_code == "all" else map_code

        preset = RANGE_PRESETS.get(range_key or "7d", RANGE_PRESETS["7d"])
        finished_at = _as_utc(date_to) or generated_at
        if preset["delta"] is not None:
            started_at = _as_utc(date_from) or (finished_at - preset["delta"])
        else:
            started_at = _as_utc(date_from) or (finished_at - RANGE_PRESETS["7d"]["delta"])
        if started_at > finished_at:
            started_at, finished_at = finished_at, started_at

        resolved_interval = (interval or "auto").strip().lower()
        if resolved_interval not in {"auto", "hour", "day", "week"}:
            resolved_interval = "auto"
        if resolved_interval == "auto":
            total_hours = max((finished_at - started_at).total_seconds() / 3600.0, 1.0)
            if total_hours <= 72:
                bucket = "hour"
            elif total_hours <= 24 * 45:
                bucket = "day"
            else:
                bucket = "week"
        else:
            bucket = resolved_interval

        return ResolvedFilters(
            site_code=normalized_site,
            map_code=normalized_map,
            range_key=range_key if range_key in RANGE_PRESETS else "7d",
            interval=resolved_interval,
            bucket=bucket,
            top_n=max(3, min(int(top_n or 8), 12)),
            started_at=started_at,
            finished_at=finished_at,
            generated_at=generated_at,
        )

    def _map_dim_cte(self, filters: ResolvedFilters) -> tuple[str, dict]:
        clauses = [
            "COALESCE(s.is_active, TRUE) = TRUE",
            "COALESCE(sm.is_active, TRUE) = TRUE",
            "COALESCE(mo.is_active, TRUE) = TRUE",
        ]
        params: Dict[str, object] = {}
        if filters.site_code:
            clauses.append("s.code = :site_code")
            params["site_code"] = filters.site_code
        if filters.map_code:
            clauses.append("sm.code = :map_code")
            params["map_code"] = filters.map_code

        cte = f"""
            WITH map_dim AS (
                SELECT
                    mo.id AS map_object_id,
                    mo.code AS object_code,
                    mo.name AS object_name,
                    sm.id AS site_map_id,
                    sm.code AS map_code,
                    sm.name AS map_name,
                    s.id AS site_id,
                    s.code AS site_code,
                    s.name AS site_name
                FROM map_object mo
                JOIN site_map sm ON sm.id = mo.site_map_id
                JOIN site s ON s.id = sm.site_id
                WHERE {' AND '.join(clauses)}
            )
        """
        return cte, params

    def _site_scope_clause(self, filters: ResolvedFilters, alias: str = "s") -> tuple[str, dict]:
        params: Dict[str, object] = {}
        clauses = ["COALESCE(s.is_active, TRUE) = TRUE"]
        if filters.site_code:
            clauses.append(f"{alias}.code = :site_code")
            params["site_code"] = filters.site_code
        return " AND ".join(clauses), params

    def _build_summary(self, filters: ResolvedFilters) -> list[dict]:
        map_cte, map_params = self._map_dim_cte(filters)
        state_expr = _state_bucket_sql("ose.state_code", "ose.raw_value")

        event_row = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    COUNT(*) AS events_total,
                    SUM(CASE WHEN {state_expr} = 'critical' THEN 1 ELSE 0 END) AS critical_total,
                    MAX(COALESCE(ose.observed_at, ose.created_at)) AS last_event_at
                FROM object_state_event ose
                JOIN map_dim md ON md.map_object_id = ose.map_object_id
                WHERE COALESCE(ose.observed_at, ose.created_at) >= :started_at
                  AND COALESCE(ose.observed_at, ose.created_at) <= :finished_at
                """
            ),
            {
                **map_params,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
            },
        ).mappings().first() or {}

        polygon_total = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT COUNT(*) AS polygon_total
                FROM map_dim
                """
            ),
            map_params,
        ).scalar() or 0

        open_alerts = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT COUNT(*) AS alerts_open
                FROM alert_event ae
                LEFT JOIN map_dim md ON md.map_object_id = ae.source_object_id
                JOIN site s ON s.id = ae.site_id
                WHERE ae.status = 'open'
                  AND (:site_code IS NULL OR s.code = :site_code)
                  AND (:map_code IS NULL OR md.map_code = :map_code)
                """
            ),
            {
                "site_code": filters.site_code,
                "map_code": filters.map_code,
            },
        ).scalar() or 0

        sync_runs_total = self.db.execute(
            text(
                """
                SELECT COUNT(*) AS sync_runs_total
                FROM sismico_sync_run sr
                JOIN site s ON s.id = sr.site_id
                WHERE COALESCE(s.is_active, TRUE) = TRUE
                  AND (:site_code IS NULL OR s.code = :site_code)
                  AND COALESCE(sr.finished_at, sr.started_at) >= :started_at
                  AND COALESCE(sr.finished_at, sr.started_at) <= :finished_at
                """
            ),
            {
                "site_code": filters.site_code,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
            },
        ).scalar() or 0

        last_visible_row = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT MAX(ocs.observed_at) AS last_visible_at
                FROM map_dim md
                LEFT JOIN object_current_state ocs ON ocs.map_object_id = md.map_object_id
                """
            ),
            map_params,
        ).mappings().first() or {}
        last_visible_at = last_visible_row.get("last_visible_at") or event_row.get("last_event_at")

        return [
            {
                "key": "events_total",
                "label": "Eventos en rango",
                "value": _format_metric_number(event_row.get("events_total") or 0),
                "raw_value": int(event_row.get("events_total") or 0),
                "helper": f"Desde {_format_datetime_label(filters.started_at)}",
                "tone": "neutral",
            },
            {
                "key": "critical_events",
                "label": "Cambios criticos",
                "value": _format_metric_number(event_row.get("critical_total") or 0),
                "raw_value": int(event_row.get("critical_total") or 0),
                "helper": "Eventos con estado critico",
                "tone": "danger" if (event_row.get("critical_total") or 0) else "neutral",
            },
            {
                "key": "alerts_open",
                "label": "Alertas abiertas",
                "value": _format_metric_number(open_alerts),
                "raw_value": int(open_alerts),
                "helper": "Estado actual de alertas",
                "tone": "warning" if open_alerts else "success",
            },
            {
                "key": "polygons_total",
                "label": "Poligonos monitoreados",
                "value": _format_metric_number(polygon_total),
                "raw_value": int(polygon_total),
                "helper": "Objetos activos en el filtro",
                "tone": "info",
            },
            {
                "key": "sync_runs_total",
                "label": "Sync runs",
                "value": _format_metric_number(sync_runs_total),
                "raw_value": int(sync_runs_total),
                "helper": "Polling observado en el rango",
                "tone": "info",
            },
            {
                "key": "last_visible_at",
                "label": "Ultimo dato visible",
                "value": _format_datetime_label(last_visible_at),
                "raw_value": 0,
                "helper": "Maximo observed_at detectado",
                "tone": "neutral" if last_visible_at else "warning",
            },
        ]

    def _build_events_timeline_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, params = self._map_dim_cte(filters)
        state_expr = _state_bucket_sql("ose.state_code", "ose.raw_value")
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    DATE_TRUNC(:bucket, COALESCE(ose.observed_at, ose.created_at)) AS bucket_at,
                    {state_expr} AS state_bucket,
                    COUNT(*) AS total
                FROM object_state_event ose
                JOIN map_dim md ON md.map_object_id = ose.map_object_id
                WHERE COALESCE(ose.observed_at, ose.created_at) >= :started_at
                  AND COALESCE(ose.observed_at, ose.created_at) <= :finished_at
                GROUP BY bucket_at, state_bucket
                ORDER BY bucket_at ASC
                """
            ),
            {
                **params,
                "bucket": filters.bucket,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
            },
        ).mappings().all()

        bucket_labels = self._bucket_labels(filters)
        bucket_index = {item["key"]: idx for idx, item in enumerate(bucket_labels)}
        series_data = {state: [0 for _ in bucket_labels] for state in STATE_ORDER}
        for row in rows:
            bucket_key = self._bucket_key(row["bucket_at"], filters.bucket)
            idx = bucket_index.get(bucket_key)
            state_bucket = row["state_bucket"] if row["state_bucket"] in series_data else UNKNOWN
            if idx is not None:
                series_data[state_bucket][idx] = int(row["total"] or 0)

        return {
            "key": "events_timeline",
            "title": "Eventos por intervalo",
            "subtitle": "Historia de cambios de estado en el rango seleccionado",
            "type": "line",
            "empty_message": "Aun no hay historial de eventos para este rango.",
            "categories": [item["label"] for item in bucket_labels],
            "series": [
                {
                    "key": state,
                    "label": STATE_LABELS[state],
                    "color": STATE_COLORS[state],
                    "data": series_data[state],
                }
                for state in STATE_ORDER
            ],
            "has_data": any(any(values) for values in series_data.values()),
        }

    def _build_current_state_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, params = self._map_dim_cte(filters)
        state_expr = _state_bucket_sql("COALESCE(ocs.state_code, 'offline')", "COALESCE(ocs.raw_value, '')")
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    md.site_code,
                    md.site_name,
                    {state_expr} AS state_bucket,
                    COUNT(*) AS total
                FROM map_dim md
                LEFT JOIN object_current_state ocs ON ocs.map_object_id = md.map_object_id
                GROUP BY md.site_code, md.site_name, state_bucket
                ORDER BY md.site_name ASC
                """
            ),
            params,
        ).mappings().all()

        categories: list[str] = []
        site_index: Dict[str, int] = {}
        series_data = {state: [] for state in STATE_ORDER}
        for row in rows:
            site_code = row["site_code"]
            if site_code not in site_index:
                site_index[site_code] = len(categories)
                categories.append(row["site_name"])
                for state in STATE_ORDER:
                    series_data[state].append(0)
            state_bucket = row["state_bucket"] if row["state_bucket"] in series_data else UNKNOWN
            series_data[state_bucket][site_index[site_code]] = int(row["total"] or 0)

        return {
            "key": "current_state_distribution",
            "title": "Panorama actual por sitio",
            "subtitle": "Distribucion de poligonos segun el ultimo estado disponible",
            "type": "stacked_bar",
            "empty_message": "No hay poligonos activos para el filtro seleccionado.",
            "categories": categories,
            "series": [
                {
                    "key": state,
                    "label": STATE_LABELS[state],
                    "color": STATE_COLORS[state],
                    "data": series_data[state],
                }
                for state in STATE_ORDER
            ],
            "has_data": bool(categories),
        }

    def _build_alerts_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, _ = self._map_dim_cte(filters)
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    s.code AS site_code,
                    s.name AS site_name,
                    ae.severity,
                    COUNT(*) AS total
                FROM alert_event ae
                JOIN site s ON s.id = ae.site_id
                LEFT JOIN map_dim md ON md.map_object_id = ae.source_object_id
                WHERE (:site_code IS NULL OR s.code = :site_code)
                  AND (:map_code IS NULL OR md.map_code = :map_code)
                  AND ae.opened_at >= :started_at
                  AND ae.opened_at <= :finished_at
                GROUP BY s.code, s.name, ae.severity
                ORDER BY s.name ASC
                """
            ),
            {
                "site_code": filters.site_code,
                "map_code": filters.map_code,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
            },
        ).mappings().all()

        categories: list[str] = []
        site_index: Dict[str, int] = {}
        series_data = {severity: [] for severity in ALERT_SEVERITY_ORDER}
        for row in rows:
            site_code = row["site_code"]
            if site_code not in site_index:
                site_index[site_code] = len(categories)
                categories.append(row["site_name"])
                for severity in ALERT_SEVERITY_ORDER:
                    series_data[severity].append(0)
            severity = _severity_bucket(row["severity"])
            series_data[severity][site_index[site_code]] = int(row["total"] or 0)

        return {
            "key": "alerts_by_severity",
            "title": "Alertas por severidad",
            "subtitle": "Eventos de alerta registrados en la base para el rango activo",
            "type": "grouped_bar",
            "empty_message": "No hay alertas registradas para este filtro.",
            "categories": categories,
            "series": [
                {
                    "key": severity,
                    "label": ALERT_SEVERITY_LABELS[severity],
                    "color": ALERT_SEVERITY_COLORS[severity],
                    "data": series_data[severity],
                }
                for severity in ALERT_SEVERITY_ORDER
            ],
            "has_data": any(any(values) for values in series_data.values()),
        }

    def _build_top_polygons_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, params = self._map_dim_cte(filters)
        state_expr = _state_bucket_sql("ose.state_code", "ose.raw_value")
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    md.object_code,
                    md.object_name,
                    md.map_name,
                    md.site_name,
                    COUNT(*) AS total_changes,
                    SUM(CASE WHEN {state_expr} = 'critical' THEN 1 ELSE 0 END) AS critical_changes
                FROM object_state_event ose
                JOIN map_dim md ON md.map_object_id = ose.map_object_id
                WHERE COALESCE(ose.observed_at, ose.created_at) >= :started_at
                  AND COALESCE(ose.observed_at, ose.created_at) <= :finished_at
                GROUP BY md.object_code, md.object_name, md.map_name, md.site_name
                ORDER BY total_changes DESC, critical_changes DESC, md.object_name ASC
                LIMIT :top_n
                """
            ),
            {
                **params,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
                "top_n": filters.top_n,
            },
        ).mappings().all()

        items = []
        for row in rows:
            critical_changes = int(row["critical_changes"] or 0)
            items.append(
                {
                    "label": row["object_name"],
                    "detail": f"{row['site_name']} / {row['map_name']}",
                    "value": _format_metric_number(row["total_changes"] or 0),
                    "raw_value": int(row["total_changes"] or 0),
                    "secondary_label": "Criticos",
                    "secondary_value": _format_metric_number(critical_changes),
                    "secondary_raw_value": critical_changes,
                    "color": "#ef4444" if critical_changes else "#2563eb",
                }
            )

        return {
            "key": "top_polygons",
            "title": "Top poligonos por cambios",
            "subtitle": f"Ranking de hasta {filters.top_n} poligonos con mas actividad",
            "type": "horizontal_bar",
            "empty_message": "Aun no hay cambios historicos para construir el ranking.",
            "items": items,
            "has_data": bool(items),
        }

    def _build_sync_correlation_chart(self, filters: ResolvedFilters) -> dict:
        rows = self.db.execute(
            text(
                """
                SELECT
                    sr.id,
                    s.code AS site_code,
                    s.name AS site_name,
                    sr.source_status,
                    COALESCE(sr.records_found, 0) AS records_found,
                    COALESCE(sr.records_mapped, 0) AS records_mapped,
                    COALESCE(sr.alerts_generated, 0) AS alerts_generated,
                    COALESCE(sr.finished_at, sr.started_at) AS observed_at
                FROM sismico_sync_run sr
                JOIN site s ON s.id = sr.site_id
                WHERE COALESCE(s.is_active, TRUE) = TRUE
                  AND (:site_code IS NULL OR s.code = :site_code)
                  AND COALESCE(sr.finished_at, sr.started_at) >= :started_at
                  AND COALESCE(sr.finished_at, sr.started_at) <= :finished_at
                ORDER BY COALESCE(sr.finished_at, sr.started_at) DESC
                LIMIT :point_limit
                """
            ),
            {
                "site_code": filters.site_code,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
                "point_limit": SCATTER_POINT_LIMIT,
            },
        ).mappings().all()

        points = []
        for row in reversed(rows):
            status = _source_status_bucket(row["source_status"])
            records_found = int(row["records_found"] or 0)
            radius = 4
            if records_found >= 20:
                radius = 5
            if records_found >= 50:
                radius = 6
            if records_found >= 100:
                radius = 7
            points.append(
                {
                    "x": int(row["records_mapped"] or 0),
                    "y": int(row["alerts_generated"] or 0),
                    "label": f"Run #{row['id']} - {row['site_name']}",
                    "detail": _format_datetime_label(row["observed_at"]),
                    "size": radius,
                    "color": SOURCE_STATUS_COLORS[status],
                    "status": status,
                }
            )

        return {
            "key": "sync_correlation",
            "title": "Correlacion polling vs alertas",
            "subtitle": "Cada punto representa un sync run reciente",
            "type": "scatter",
            "empty_message": "Todavia no hay sync runs registrados en este rango.",
            "points": points,
            "x_label": "Registros mapeados",
            "y_label": "Alertas generadas",
            "has_data": bool(points),
        }

    def _build_source_status_chart(self, filters: ResolvedFilters) -> dict:
        rows = self.db.execute(
            text(
                """
                SELECT sr.source_status, COUNT(*) AS total
                FROM sismico_sync_run sr
                JOIN site s ON s.id = sr.site_id
                WHERE COALESCE(s.is_active, TRUE) = TRUE
                  AND (:site_code IS NULL OR s.code = :site_code)
                  AND COALESCE(sr.finished_at, sr.started_at) >= :started_at
                  AND COALESCE(sr.finished_at, sr.started_at) <= :finished_at
                GROUP BY sr.source_status
                """
            ),
            {
                "site_code": filters.site_code,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
            },
        ).mappings().all()

        counts = {status: 0 for status in SOURCE_STATUS_ORDER}
        for row in rows:
            counts[_source_status_bucket(row["source_status"])] = int(row["total"] or 0)
        segments = [
            {
                "key": status,
                "label": SOURCE_STATUS_LABELS[status],
                "value": _format_metric_number(counts[status]),
                "raw_value": counts[status],
                "color": SOURCE_STATUS_COLORS[status],
            }
            for status in SOURCE_STATUS_ORDER
        ]

        return {
            "key": "source_status_distribution",
            "title": "Fuente externa por estado",
            "subtitle": "Participacion de cada estado de fuente en los sync runs",
            "type": "segment_bar",
            "empty_message": "No hay sync runs para construir la distribucion de fuente.",
            "segments": segments,
            "has_data": sum(counts.values()) > 0,
        }

    def _build_activity_by_map_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, params = self._map_dim_cte(filters)
        state_expr = _state_bucket_sql("ose.state_code", "ose.raw_value")
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    md.map_code,
                    md.map_name,
                    md.site_name,
                    COUNT(*) AS total_events,
                    SUM(CASE WHEN {state_expr} = 'critical' THEN 1 ELSE 0 END) AS critical_events
                FROM object_state_event ose
                JOIN map_dim md ON md.map_object_id = ose.map_object_id
                WHERE COALESCE(ose.observed_at, ose.created_at) >= :started_at
                  AND COALESCE(ose.observed_at, ose.created_at) <= :finished_at
                GROUP BY md.map_code, md.map_name, md.site_name
                ORDER BY total_events DESC, md.map_name ASC
                LIMIT :top_n
                """
            ),
            {
                **params,
                "started_at": filters.started_at,
                "finished_at": filters.finished_at,
                "top_n": filters.top_n,
            },
        ).mappings().all()

        items = []
        for row in rows:
            critical_events = int(row["critical_events"] or 0)
            items.append(
                {
                    "label": row["map_name"],
                    "detail": row["site_name"],
                    "value": _format_metric_number(row["total_events"] or 0),
                    "raw_value": int(row["total_events"] or 0),
                    "secondary_label": "Criticos",
                    "secondary_value": _format_metric_number(critical_events),
                    "secondary_raw_value": critical_events,
                    "color": "#2563eb" if critical_events == 0 else "#f59e0b",
                }
            )

        return {
            "key": "activity_by_map",
            "title": "Actividad por plano",
            "subtitle": "Planos con mayor movimiento historico dentro del rango",
            "type": "horizontal_bar",
            "empty_message": "No hay eventos historicos por plano en este filtro.",
            "items": items,
            "has_data": bool(items),
        }

    def _build_freshness_chart(self, filters: ResolvedFilters) -> dict:
        map_cte, params = self._map_dim_cte(filters)
        rows = self.db.execute(
            text(
                f"""
                {map_cte}
                SELECT
                    md.map_code,
                    md.map_name,
                    md.site_name,
                    COUNT(*) AS polygons_total,
                    COUNT(ocs.observed_at) AS polygons_with_data,
                    MAX(ocs.observed_at) AS last_observed_at,
                    AVG(EXTRACT(EPOCH FROM (:generated_at - ocs.observed_at)) / 60.0) AS avg_lag_minutes,
                    SUM(
                        CASE
                            WHEN ocs.observed_at IS NULL THEN 1
                            WHEN ocs.observed_at < :stale_threshold THEN 1
                            ELSE 0
                        END
                    ) AS stale_or_missing
                FROM map_dim md
                LEFT JOIN object_current_state ocs ON ocs.map_object_id = md.map_object_id
                GROUP BY md.map_code, md.map_name, md.site_name
                ORDER BY avg_lag_minutes DESC NULLS LAST, md.map_name ASC
                """
            ),
            {
                **params,
                "generated_at": filters.generated_at,
                "stale_threshold": filters.generated_at - timedelta(minutes=FRESHNESS_STALE_MINUTES),
            },
        ).mappings().all()

        items = []
        for row in rows:
            avg_lag = float(row["avg_lag_minutes"] or 0.0)
            stale_or_missing = int(row["stale_or_missing"] or 0)
            polygons_total = int(row["polygons_total"] or 0)
            polygons_with_data = int(row["polygons_with_data"] or 0)
            display_value = f"{avg_lag:.1f} min"
            raw_value = round(avg_lag, 2)
            if polygons_with_data == 0:
                color = "#ef4444"
                display_value = "Sin lectura"
                raw_value = float(FRESHNESS_STALE_MINUTES * 6)
            elif stale_or_missing > 0:
                color = "#f59e0b"
            else:
                color = "#22c55e"
            items.append(
                {
                    "label": row["map_name"],
                    "detail": f"{row['site_name']} / ultimo {_format_datetime_label(row['last_observed_at'])}",
                    "value": display_value,
                    "raw_value": raw_value,
                    "secondary_label": "Stale o sin lectura",
                    "secondary_value": f"{stale_or_missing}/{polygons_total}",
                    "secondary_raw_value": stale_or_missing,
                    "color": color,
                }
            )

        return {
            "key": "freshness_by_map",
            "title": "Frescura del ultimo dato",
            "subtitle": f"Promedio de minutos desde el ultimo observed_at por plano. Stale > {FRESHNESS_STALE_MINUTES} min",
            "type": "horizontal_bar",
            "empty_message": "No hay planos activos para medir frescura.",
            "items": items,
            "has_data": bool(items),
        }

    def _bucket_labels(self, filters: ResolvedFilters) -> list[dict]:
        buckets = []
        current = self._floor_bucket(filters.started_at, filters.bucket)
        limit = filters.finished_at
        while current <= limit:
            buckets.append(
                {
                    "key": self._bucket_key(current, filters.bucket),
                    "label": self._bucket_label(current, filters.bucket),
                }
            )
            current = self._next_bucket(current, filters.bucket)
        return buckets

    def _bucket_key(self, value: datetime, bucket: str) -> str:
        value = _as_utc(value) or datetime.now(timezone.utc)
        if bucket == "hour":
            return value.strftime("%Y-%m-%dT%H:00:00Z")
        if bucket == "day":
            return value.strftime("%Y-%m-%d")
        return value.strftime("%G-W%V")

    def _bucket_label(self, value: datetime, bucket: str) -> str:
        value = _as_utc(value) or datetime.now(timezone.utc)
        if bucket == "hour":
            return value.strftime("%d/%m %Hh")
        if bucket == "day":
            return value.strftime("%d/%m")
        return value.strftime("Sem %V")

    def _floor_bucket(self, value: datetime, bucket: str) -> datetime:
        value = (_as_utc(value) or datetime.now(timezone.utc)).replace(minute=0, second=0, microsecond=0)
        if bucket == "hour":
            return value
        if bucket == "day":
            return value.replace(hour=0)
        start = value.replace(hour=0) - timedelta(days=value.weekday())
        return start

    def _next_bucket(self, value: datetime, bucket: str) -> datetime:
        if bucket == "hour":
            return value + timedelta(hours=1)
        if bucket == "day":
            return value + timedelta(days=1)
        return value + timedelta(weeks=1)
