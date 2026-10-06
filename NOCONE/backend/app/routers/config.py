# backend/app/routers/config.py
# Hotfix: make config endpoints tolerant to schema drift (missing columns / type mismatches),
# and restore the full set of /api/config endpoints (CRUD + tag assignments + person extra).
# Generated: 2026-01-28 (America/Sao_Paulo)

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.db import get_db
from app.services.app_settings import (
    get_camera_monitoring_settings_payload,
    ensure_app_setting_schema as ensure_shared_app_setting_schema,
    upsert_app_setting,
    upsert_camera_monitoring_interval_seconds,
)
from app.services.production_module import (
    build_empty_payload,
    enrich_payload_from_db,
    load_seed_payload,
    validate_task_tracking,
)
from app.services.production_workbook import build_production_workbook_bytes

router = APIRouter(prefix="/config", tags=["config"])

_UPDATE_CATALOG_KEY = "zenit_updates_catalog"
_DEFAULT_UPDATE_CATALOG = [
    {
        "id": "control-trafico-barreras",
        "name": "Control de tráfico vial / barreras",
        "version": "2.3.0",
        "description": "Panel independiente de Control de Tráfico integrado en el menú lateral de Zenit.",
        "route": "/control-trafico-barreras",
        "installed": True,
        "hidden": False,
    }
]


# ---------- helpers (schema drift tolerant) ----------

_IDENTIFIER_RE = r"^[A-Za-z_][A-Za-z0-9_]*$"


def _dump_json(value: Any) -> str:
    return json.dumps(jsonable_encoder(value), ensure_ascii=False)


def _normalize_text_search(value: Any) -> str:
    return (
        str(value or "")
        .replace("á", "a")
        .replace("é", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ú", "u")
        .replace("Á", "A")
        .replace("É", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ú", "U")
        .lower()
        .strip()
    )


def _filter_production_tasks(
    tasks: List[Dict[str, Any]],
    *,
    date: str | None = None,
    turno: str | None = None,
    nivel: str | None = None,
    map_code: str | None = None,
    search: str | None = None,
) -> List[Dict[str, Any]]:
    normalized_search = _normalize_text_search(search)

    def _matches(task: Dict[str, Any]) -> bool:
        if date and str(task.get("date") or "")[:10] != date:
            return False
        if turno and str(task.get("turno") or "") != turno:
            return False
        if nivel and str(task.get("nivel") or "") != nivel:
            return False
        if map_code and str(task.get("mapCode") or "") != map_code:
            return False
        if not normalized_search:
            return True

        haystack = " ".join(
            [
                str(task.get("postura") or ""),
                str(task.get("activity") or ""),
                str(task.get("type") or ""),
                str(task.get("crewPlanned") or ""),
                str(task.get("crewReal") or ""),
                str(task.get("equipmentPlanned") or ""),
                str(task.get("equipmentReal") or ""),
                str(task.get("observation") or ""),
                " ".join(str(item) for item in (task.get("roles") or [])),
                " ".join(
                    str(item.get("label") or item.get("name") or "")
                    for item in (task.get("linkedPeople") or [])
                ),
                " ".join(
                    str(item.get("label") or item.get("name") or "")
                    for item in (task.get("linkedVehicles") or [])
                ),
            ]
        )
        return normalized_search in _normalize_text_search(haystack)

    return [task for task in tasks if _matches(task)]


def _is_identifier(name: str) -> bool:
    return bool(re.match(_IDENTIFIER_RE, name))


async def _table_exists(db: AsyncSession, table: str, schema: str = "public") -> bool:
    if not _is_identifier(schema) or not _is_identifier(table):
        return False
    q = text(
        """
        SELECT EXISTS(
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = :schema
              AND table_name   = :table
        ) AS ok
        """
    )
    res = await db.execute(q, {"schema": schema, "table": table})
    row = res.first()
    return bool(row[0]) if row else False


async def _find_existing_table(
    db: AsyncSession, candidates: List[str], schema: str = "public"
) -> Optional[str]:
    for t in candidates:
        if _is_identifier(t) and await _table_exists(db, t, schema=schema):
            return t
    return None


async def _get_columns(db: AsyncSession, table: str, schema: str = "public") -> Set[str]:
    if not _is_identifier(schema) or not _is_identifier(table):
        return set()
    q = text(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = :schema
          AND table_name   = :table
        """
    )
    res = await db.execute(q, {"schema": schema, "table": table})
    return {r[0] for r in res.fetchall()}


def _pick_id_column(cols: Set[str]) -> str:
    # Prefer id, otherwise pick the first common pattern.
    for c in ("id", "company_id", "person_id", "equipment_id", "vehicle_id", "tag_id", "portico_id"):
        if c in cols:
            return c
    # Fallback: any column that ends with _id
    for c in cols:
        if c.endswith("_id"):
            return c
    return "id"


def _pick_active_column(cols: Set[str]) -> Optional[str]:
    for c in ("active", "is_active", "enabled", "is_enabled"):
        if c in cols:
            return c
    return None


def _safe_payload_for_columns(cols: Set[str], payload: Dict[str, Any]) -> Dict[str, Any]:
    # Keep only keys that exist as columns AND are valid SQL identifiers.
    out: Dict[str, Any] = {}
    for k, v in payload.items():
        if not isinstance(k, str):
            continue
        if not _is_identifier(k):
            continue
        if k in cols:
            out[k] = v
    return out


def _slug_token(value: str, fallback: str = "ITEM") -> str:
    normalized = re.sub(r"[^A-Za-z0-9]+", "_", (value or "").strip().upper()).strip("_")
    return normalized[:32] or fallback


def _split_full_name(full_name: str) -> Tuple[Optional[str], Optional[str]]:
    pieces = [piece for piece in (full_name or "").strip().split() if piece]
    if not pieces:
        return None, None
    if len(pieces) == 1:
        return pieces[0], None
    return pieces[0], " ".join(pieces[1:])


def _status_text_from_bool(value: Any) -> str:
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"online", "activo", "active", "alerta", "warning"}:
            return lowered
        if lowered in {"offline", "inactivo", "inactive"}:
            return "offline"
    return "online" if bool(value) else "offline"


def _clean_portico_mode(value: Any) -> str:
    lowered = str(value or "").strip().lower()
    if lowered in {"access", "acceso"}:
        return "ACCESS"
    return "READ"


def _clean_positive_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if value in (None, ""):
        return default
    try:
        parsed = int(value)
    except Exception:
        return default
    return parsed if parsed > 0 else default


async def _scalar(
    db: AsyncSession,
    sql: str,
    params: Optional[Dict[str, Any]] = None,
) -> Any:
    res = await db.execute(text(sql), params or {})
    row = res.first()
    return row[0] if row else None


async def _ensure_gateway(
    db: AsyncSession,
    gateway_id: Optional[str],
    portico_name: str,
    gateway_name: Optional[str] = None,
) -> str:
    if gateway_id:
        exists = await _scalar(
            db,
            "SELECT id FROM gateway WHERE CAST(id AS text) = :gateway_id LIMIT 1",
            {"gateway_id": str(gateway_id)},
        )
        if exists:
            return str(exists)

    clean_gateway_name = (gateway_name or "").strip()
    if clean_gateway_name:
        exists = await _scalar(
            db,
            "SELECT id FROM gateway WHERE name = :name LIMIT 1",
            {"name": clean_gateway_name},
        )
        if exists:
            return str(exists)

        created = await _scalar(
            db,
            "INSERT INTO gateway (name) VALUES (:name) RETURNING id",
            {"name": clean_gateway_name},
        )
        if created:
            return str(created)

    created = await _scalar(
        db,
        "INSERT INTO gateway (name) VALUES (:name) RETURNING id",
        {"name": f"GW-{_slug_token(portico_name or 'PORTICO')}"},
    )
    if not created:
        raise HTTPException(status_code=400, detail="No fue posible crear gateway para el pórtico")
    return str(created)


async def _ensure_portico_type(db: AsyncSession, want_climate: bool = False) -> int:
    code = "CLIMATE" if want_climate else "BASIC"
    portico_type_id = await _scalar(
        db,
        "SELECT id FROM access_portico_type WHERE code = :code LIMIT 1",
        {"code": code},
    )
    if portico_type_id:
        return int(portico_type_id)

    inserted = await _scalar(
        db,
        """
        INSERT INTO access_portico_type (code, name, description)
        VALUES (:code, :name, :description)
        RETURNING id
        """,
        {
            "code": code,
            "name": "Pórtico con clima" if want_climate else "Pórtico estándar",
            "description": "Generado automáticamente por configuración",
        },
    )
    if not inserted:
        raise HTTPException(status_code=400, detail="No fue posible crear tipo de pórtico")
    return int(inserted)


async def _ensure_equipment_type(db: AsyncSession, eq_type: Optional[str]) -> Optional[int]:
    clean = (eq_type or "").strip()
    if not clean:
        return None

    code = _slug_token(clean, fallback="GENERAL")
    current = await _scalar(
        db,
        """
        SELECT id
        FROM equipment_type
        WHERE UPPER(code) = :code OR UPPER(name) = :name
        LIMIT 1
        """,
        {"code": code, "name": clean.upper()},
    )
    if current:
        return int(current)

    inserted = await _scalar(
        db,
        """
        INSERT INTO equipment_type (code, name, description)
        VALUES (:code, :name, :description)
        RETURNING id
        """,
        {
            "code": code,
            "name": clean,
            "description": "Creado desde módulo de configuración",
        },
    )
    return int(inserted) if inserted else None


async def _generate_equipment_code(db: AsyncSession, name: str) -> str:
    next_id = await _scalar(db, "SELECT COALESCE(MAX(id), 0) + 1 FROM equipment")
    base = _slug_token(name, fallback="EQ")
    return f"EQ-{base[:20]}-{int(next_id or 1):04d}"


async def _upsert_vehicle_company(
    db: AsyncSession,
    vehicle_id: int,
    company_id: Optional[int],
) -> None:
    await db.execute(
        text("UPDATE vehicle_company SET active = FALSE WHERE vehicle_id = :vehicle_id AND active = TRUE"),
        {"vehicle_id": vehicle_id},
    )
    if company_id:
        await db.execute(
            text(
                """
                INSERT INTO vehicle_company (vehicle_id, company_id, active)
                VALUES (:vehicle_id, :company_id, TRUE)
                """
            ),
            {"vehicle_id": vehicle_id, "company_id": company_id},
        )


async def _upsert_map_device_for_portico(
    db: AsyncSession,
    portico_id: int,
    *,
    label: str,
    map_code: Optional[str],
    x_pct: Optional[float],
    y_pct: Optional[float],
    has_climate: bool = False,
) -> None:
    kind = "portico_clima" if has_climate else "portico"
    existing_row_res = await db.execute(
        text(
            """
        SELECT id
             , map_code
             , x_pct
             , y_pct
        FROM map_device
        WHERE ref_id = :ref_id
          AND kind IN ('portico', 'portico_clima')
        ORDER BY id DESC
        LIMIT 1
        """
        ),
        {"ref_id": portico_id},
    )
    existing_row = existing_row_res.mappings().first()
    existing_id = existing_row["id"] if existing_row else None

    if x_pct is None and existing_row:
        x_pct = float(existing_row["x_pct"]) if existing_row["x_pct"] is not None else None
    if y_pct is None and existing_row:
        y_pct = float(existing_row["y_pct"]) if existing_row["y_pct"] is not None else None
    if map_code is None and existing_row:
        map_code = existing_row["map_code"]
    if x_pct is None or y_pct is None:
        return

    payload = {
        "ref_id": portico_id,
        "kind": kind,
        "label": label,
        "map_code": map_code or "NTI_andes_norte",
        "x_pct": x_pct,
        "y_pct": y_pct,
        "id": existing_id,
    }
    if existing_id:
        await db.execute(
            text(
                """
                UPDATE map_device
                SET map_code = :map_code,
                    kind = :kind,
                    label = :label,
                    x_pct = :x_pct,
                    y_pct = :y_pct
                WHERE id = :id
                """
            ),
            payload,
        )
    else:
        await db.execute(
            text(
                """
                INSERT INTO map_device (map_code, kind, ref_id, label, x_pct, y_pct)
                VALUES (:map_code, :kind, :ref_id, :label, :x_pct, :y_pct)
                """
            ),
            payload,
        )


async def _select_list(
    db: AsyncSession,
    table: str,
    preferred_cols: List[str],
    schema: str = "public",
    where_sql: str = "",
    params: Optional[Dict[str, Any]] = None,
    order_by: Optional[str] = None,
) -> List[Dict[str, Any]]:
    cols = await _get_columns(db, table, schema=schema)
    if not cols:
        return []

    select_cols = [c for c in preferred_cols if c in cols]
    if not select_cols:
        # Pick a safe minimal set.
        minimal = ["id", "name", "created_at", "updated_at"]
        select_cols = [c for c in minimal if c in cols] or sorted(list(cols))[:8]

    col_sql = ", ".join(select_cols)
    sql = f"SELECT {col_sql} FROM {table}"
    if where_sql:
        sql += f" WHERE {where_sql}"
    if order_by:
        sql += f" ORDER BY {order_by}"

    res = await db.execute(text(sql), params or {})
    return [dict(r) for r in res.mappings().all()]


async def _select_one_by_id(
    db: AsyncSession,
    table: str,
    id_value: Any,
    schema: str = "public",
    id_col: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    cols = await _get_columns(db, table, schema=schema)
    if not cols:
        return None
    id_col = id_col or _pick_id_column(cols)
    if id_col not in cols:
        id_col = _pick_id_column(cols)

    # IMPORTANT: avoid `:bind::text` (SQLAlchemy `text()` can parse the cast as part of the bind name)
    sql = f"SELECT * FROM {table} WHERE {id_col} = :id_value LIMIT 1"
    res = await db.execute(text(sql), {"id_value": int(id_value) if str(id_value).isdigit() else id_value})
    row = res.mappings().first()
    return dict(row) if row else None


async def _insert_row(
    db: AsyncSession,
    table: str,
    payload: Dict[str, Any],
    schema: str = "public",
    id_col: Optional[str] = None,
) -> Dict[str, Any]:
    if not await _table_exists(db, table, schema=schema):
        raise HTTPException(status_code=404, detail=f"Table not found: {table}")

    cols = await _get_columns(db, table, schema=schema)
    if not cols:
        raise HTTPException(status_code=404, detail=f"Table has no columns: {table}")

    id_col = id_col or _pick_id_column(cols)
    data = _safe_payload_for_columns(cols, payload)
    data.pop(id_col, None)  # never insert ID from client

    if not data:
        # Insert default row if DB supports it; else raise.
        try:
            res = await db.execute(text(f"INSERT INTO {table} DEFAULT VALUES RETURNING *"))
            await db.commit()
            row = res.mappings().first()
            return dict(row) if row else {}
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=400, detail="No valid fields to insert") from e

    keys = list(data.keys())
    col_sql = ", ".join(keys)
    val_sql = ", ".join([f":{k}" for k in keys])

    sql = f"INSERT INTO {table} ({col_sql}) VALUES ({val_sql}) RETURNING *"
    try:
        res = await db.execute(text(sql), data)
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Insert failed: {str(e)}") from e

    row = res.mappings().first()
    return dict(row) if row else {}


async def _update_row(
    db: AsyncSession,
    table: str,
    id_value: Any,
    payload: Dict[str, Any],
    schema: str = "public",
    id_col: Optional[str] = None,
) -> Dict[str, Any]:
    if not await _table_exists(db, table, schema=schema):
        raise HTTPException(status_code=404, detail=f"Table not found: {table}")

    cols = await _get_columns(db, table, schema=schema)
    if not cols:
        raise HTTPException(status_code=404, detail=f"Table has no columns: {table}")

    id_col = id_col or _pick_id_column(cols)
    data = _safe_payload_for_columns(cols, payload)
    data.pop(id_col, None)

    if not data:
        current = await _select_one_by_id(db, table, id_value, schema=schema, id_col=id_col)
        if not current:
            raise HTTPException(status_code=404, detail="Not found")
        return current

    set_sql = ", ".join([f"{k} = :{k}" for k in data.keys()])
    data["id_value"] = int(id_value) if str(id_value).isdigit() else id_value

    # IMPORTANT: avoid `:bind::text` (SQLAlchemy `text()` can parse the cast as part of the bind name)
    sql = f"UPDATE {table} SET {set_sql} WHERE {id_col} = :id_value RETURNING *"
    try:
        res = await db.execute(text(sql), data)
        row = res.mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(status_code=404, detail="Not found")
        await db.commit()
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Update failed: {str(e)}") from e


async def _delete_row(
    db: AsyncSession,
    table: str,
    id_value: Any,
    schema: str = "public",
    id_col: Optional[str] = None,
) -> Dict[str, Any]:
    if not await _table_exists(db, table, schema=schema):
        raise HTTPException(status_code=404, detail=f"Table not found: {table}")

    cols = await _get_columns(db, table, schema=schema)
    if not cols:
        raise HTTPException(status_code=404, detail=f"Table has no columns: {table}")

    id_col = id_col or _pick_id_column(cols)
    try:
        sql = f"DELETE FROM {table} WHERE CAST({id_col} AS text) = :id_value RETURNING *"
        res = await db.execute(text(sql), {"id_value": str(id_value)})

        row = res.mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(status_code=404, detail="Not found")
        await db.commit()
        return dict(row)
    except HTTPException:
        raise
    except IntegrityError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="No se puede eliminar: hay registros vinculados. Reasigna o elimina esas relaciones antes de continuar.") from e
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Delete failed: {str(e)}") from e


# ---------- base list endpoints (kept compatible with current frontend) ----------

@router.get("/companies")
async def list_companies(db: AsyncSession = Depends(get_db)):
    # company table might differ across deployments; choose a flexible column list.
    return await _select_list(
        db,
        table="company",
        preferred_cols=["id", "name", "rut", "address", "phone", "email", "active", "created_at", "updated_at"],
        order_by="id DESC" if "id" in await _get_columns(db, "company") else None,
    )


_PERSON_EXTRA_TABLE_CANDIDATES = [
    "person_extra",
    "person_extras",
    "person_detail",
    "person_details",
    "person_metadata",
    "person_meta",
]

_PERSON_EXTRA_SCHEMA_COLUMNS = {
    "driver_license": "TEXT",
    "driver_license_exp": "DATE",
    "medical_exams": "TEXT",
    "medical_exams_exp": "DATE",
    "entry_type": "TEXT",
    "entry_exp": "DATE",
    "site_induction": "TEXT",
    "site_induction_exp": "DATE",
    "height_work_cert": "TEXT",
    "height_work_cert_exp": "DATE",
    "contract_end": "DATE",
    "allergies": "TEXT",
    "medical_notes": "TEXT",
    "address": "TEXT",
    "phone_primary": "TEXT",
    "phone_emergency": "TEXT",
    "emergency_contact_name": "TEXT",
    "blood_type": "TEXT",
    "ppe_size": "TEXT",
    "photo_url": "TEXT",
    "extra": "JSONB NOT NULL DEFAULT '{}'::jsonb",
    "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT now()",
}

_EXTERNAL_SOURCE_DEFAULTS: Dict[str, Dict[str, str]] = {
    "control_vial_url": {
        "label": "Semaforos control vial",
        "value": "http://devtm.denial.cl:19091/",
        "description": "Panel externo del control vial operacional.",
    },
}

_PRODUCTION_MODULE_SETTING_KEY = "production_module_payload"
_PRODUCTION_MODULE_DEFAULTS: Dict[str, Any] = {
    "permissions": {
        "allowedRoles": ["admin_produccion"],
    }
}


def _pick_person_fk_column(cols: Set[str]) -> Optional[str]:
    for c in ("person_id", "id_person", "personid"):
        if c in cols:
            return c
    return None


async def _ensure_person_extra_schema(db: AsyncSession) -> Tuple[str, str]:
    table = await _find_existing_table(db, _PERSON_EXTRA_TABLE_CANDIDATES)

    try:
        if not table:
            table = "person_extra"
            await db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS person_extra (
                        person_id BIGINT PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
                        driver_license TEXT,
                        driver_license_exp DATE,
                        medical_exams TEXT,
                        medical_exams_exp DATE,
                        entry_type TEXT,
                        entry_exp DATE,
                        site_induction TEXT,
                        site_induction_exp DATE,
                        height_work_cert TEXT,
                        height_work_cert_exp DATE,
                        contract_end DATE,
                        allergies TEXT,
                        medical_notes TEXT,
                        address TEXT,
                        phone_primary TEXT,
                        phone_emergency TEXT,
                        emergency_contact_name TEXT,
                        blood_type TEXT,
                        ppe_size TEXT,
                        photo_url TEXT,
                        extra JSONB NOT NULL DEFAULT '{}'::jsonb,
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            )

        if not _is_identifier(table):
            raise HTTPException(status_code=500, detail="Invalid person extra table identifier")

        cols = await _get_columns(db, table)
        fk = _pick_person_fk_column(cols)
        if not fk and table == "person_extra":
            await db.execute(
                text(
                    """
                    ALTER TABLE person_extra
                    ADD COLUMN IF NOT EXISTS person_id BIGINT REFERENCES person(id) ON DELETE CASCADE
                    """
                )
            )
            fk = "person_id"

        if not fk or not _is_identifier(fk):
            raise HTTPException(
                status_code=500,
                detail="Person extra table missing person reference column",
            )

        for column_name, column_ddl in _PERSON_EXTRA_SCHEMA_COLUMNS.items():
            if not _is_identifier(column_name):
                continue
            await db.execute(
                text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column_name} {column_ddl}"
                )
            )

        await db.execute(
            text(f"CREATE INDEX IF NOT EXISTS idx_{table}_updated_at ON {table}(updated_at)")
        )
        await db.commit()
        return table, fk
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"No fue posible preparar el modelo de datos de personas: {str(e)}",
        ) from e


async def _ensure_person_demo_profiles(db: AsyncSession, table: str, fk: str) -> None:
    if not _is_identifier(table) or not _is_identifier(fk):
        return

    missing_sql = f"""
    SELECT COUNT(*)
    FROM person p
    LEFT JOIN {table} px
      ON CAST(px.{fk} AS text) = CAST(p.id AS text)
    WHERE
         px.{fk} IS NULL
      OR NULLIF(BTRIM(COALESCE(p.position, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p.group_name, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p.address, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p.phone, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p.emergency_phone, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(p.blood_type, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(px.driver_license, '')), '') IS NULL
      OR px.driver_license_exp IS NULL
      OR NULLIF(BTRIM(COALESCE(px.medical_exams, '')), '') IS NULL
      OR px.medical_exams_exp IS NULL
      OR NULLIF(BTRIM(COALESCE(px.entry_type, '')), '') IS NULL
      OR px.entry_exp IS NULL
      OR NULLIF(BTRIM(COALESCE(px.site_induction, '')), '') IS NULL
      OR px.site_induction_exp IS NULL
      OR NULLIF(BTRIM(COALESCE(px.height_work_cert, '')), '') IS NULL
      OR px.height_work_cert_exp IS NULL
      OR px.contract_end IS NULL
      OR NULLIF(BTRIM(COALESCE(px.phone_primary, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(px.phone_emergency, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(px.emergency_contact_name, '')), '') IS NULL
      OR NULLIF(BTRIM(COALESCE(px.ppe_size, '')), '') IS NULL
    """
    missing_count = int(await _scalar(db, missing_sql) or 0)
    expiry_sql = f"""
    SELECT
        COUNT(*) FILTER (
            WHERE
                px.driver_license_exp < CURRENT_DATE
                OR px.medical_exams_exp < CURRENT_DATE
                OR px.entry_exp < CURRENT_DATE
                OR px.site_induction_exp < CURRENT_DATE
                OR px.height_work_cert_exp < CURRENT_DATE
                OR px.contract_end < CURRENT_DATE
        ) AS expired_people,
        COUNT(*) FILTER (
            WHERE
                px.driver_license_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
                OR px.medical_exams_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
                OR px.entry_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
                OR px.site_induction_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
                OR px.height_work_cert_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
                OR px.contract_end BETWEEN CURRENT_DATE AND CURRENT_DATE + 15
        ) AS within15_people,
        COUNT(*) FILTER (
            WHERE
                px.driver_license_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                OR px.medical_exams_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                OR px.entry_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                OR px.site_induction_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                OR px.height_work_cert_exp BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
                OR px.contract_end BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
        ) AS within30_people
    FROM {table} px
    """
    expiry_row = (await db.execute(text(expiry_sql))).mappings().first() or {}
    expired_people = int(expiry_row.get("expired_people") or 0)
    within15_people = int(expiry_row.get("within15_people") or 0)
    within30_people = int(expiry_row.get("within30_people") or 0)
    needs_expiry_reset = (
        expired_people > 40
        or within15_people > 40
        or within30_people > 60
    )
    if missing_count <= 0 and not needs_expiry_reset:
        return

    generated_cte = """
    WITH ranked AS (
        SELECT
            p.id,
            p.full_name,
            COALESCE(
                NULLIF(BTRIM(p.address), ''),
                'Campamento norte'
            ) AS base_address,
            COALESCE(
                NULLIF(BTRIM(p.phone), ''),
                '+56 9 6' || LPAD((((p.id * 37)::bigint) % 10000000)::text, 7, '0')
            ) AS base_phone,
            COALESCE(
                NULLIF(BTRIM(p.emergency_phone), ''),
                '+56 9 7' || LPAD((((p.id * 53)::bigint) % 10000000)::text, 7, '0')
            ) AS base_emergency_phone,
            COALESCE(
                NULLIF(BTRIM(p.blood_type), ''),
                (ARRAY['O+', 'A+', 'B+', 'AB+'])[1 + ((p.id - 1) % 4)::int]
            ) AS base_blood_type,
            ROW_NUMBER() OVER (ORDER BY p.id) AS rn
        FROM person p
    ),
    generated AS (
        SELECT
            r.id AS person_id_value,
            r.id::text AS person_id_text,
            (ARRAY['A2', 'B', 'D', 'A4'])[1 + ((r.id - 1) % 4)::int] || ' / TM-' || LPAD(r.id::text, 4, '0') AS driver_license,
            CASE
                WHEN r.rn BETWEEN 1 AND 5 THEN CURRENT_DATE - (r.rn::int)
                ELSE CURRENT_DATE + (180 + ((r.rn - 1) % 120)::int)
            END AS driver_license_exp,
            'Ocupacional mina subterranea'::text AS medical_exams,
            CASE
                WHEN r.rn BETWEEN 6 AND 10 THEN CURRENT_DATE - ((r.rn - 5)::int)
                ELSE CURRENT_DATE + (210 + ((r.rn - 1) % 120)::int)
            END AS medical_exams_exp,
            CASE (r.id % 3)::int
                WHEN 0 THEN 'permanente'
                WHEN 1 THEN 'contratista'
                ELSE 'pase_visita'
            END AS entry_type,
            CASE
                WHEN r.rn BETWEEN 11 AND 15 THEN CURRENT_DATE + ((r.rn - 10)::int)
                ELSE CURRENT_DATE + (240 + ((r.rn - 1) % 120)::int)
            END AS entry_exp,
            (ARRAY[
                'Induccion Diamante NP',
                'Induccion Andes Norte',
                'Induccion UCL',
                'Induccion Mina Central'
            ])[1 + ((r.id - 1) % 4)::int] AS site_induction,
            CASE
                WHEN r.rn BETWEEN 16 AND 20 THEN CURRENT_DATE + ((r.rn - 15)::int)
                ELSE CURRENT_DATE + (270 + ((r.rn - 1) % 120)::int)
            END AS site_induction_exp,
            CASE
                WHEN (r.id % 2)::int = 0 THEN 'Certificacion vigente'
                ELSE 'Certificacion base'
            END AS height_work_cert,
            CASE
                WHEN r.rn BETWEEN 21 AND 25 THEN CURRENT_DATE + (15 + (r.rn - 20)::int)
                ELSE CURRENT_DATE + (300 + ((r.rn - 1) % 120)::int)
            END AS height_work_cert_exp,
            CASE
                WHEN r.rn BETWEEN 26 AND 30 THEN CURRENT_DATE + (15 + (r.rn - 25)::int)
                ELSE CURRENT_DATE + (330 + ((r.rn - 1) % 120)::int)
            END AS contract_end,
            CASE
                WHEN (r.id % 5)::int = 0 THEN 'Penicilina'
                WHEN (r.id % 7)::int = 0 THEN 'Polvo'
                ELSE 'Sin alergias declaradas'
            END AS allergies,
            'Ficha demo completa para filtros, alertas y seguimiento de RRHH en mineria.'::text AS medical_notes,
            r.base_address AS address,
            r.base_phone AS phone_primary,
            r.base_emergency_phone AS phone_emergency,
            split_part(r.full_name, ' ', 1) || ' Contacto' AS emergency_contact_name,
            r.base_blood_type AS blood_type,
            (ARRAY['S', 'M', 'L', 'XL'])[1 + ((r.id - 1) % 4)::int] AS ppe_size
        FROM ranked r
    )
    """

    try:
        await db.execute(
            text(
                """
                UPDATE person p
                SET
                    first_name = COALESCE(
                        NULLIF(BTRIM(p.first_name), ''),
                        split_part(p.full_name, ' ', 1)
                    ),
                    last_name = COALESCE(
                        NULLIF(BTRIM(p.last_name), ''),
                        NULLIF(regexp_replace(p.full_name, '^[^ ]+\\s*', ''), '')
                    ),
                    birth_date = COALESCE(
                        p.birth_date,
                        (CURRENT_DATE - make_interval(years => 22 + ((p.id % 28)::int)))::date
                    ),
                    address = COALESCE(
                        NULLIF(BTRIM(p.address), ''),
                        'Campamento ' || (ARRAY['Norte', 'Central', 'Sur', 'Andes'])[1 + ((p.id - 1) % 4)::int]
                    ),
                    blood_type = COALESCE(
                        NULLIF(BTRIM(p.blood_type), ''),
                        (ARRAY['O+', 'A+', 'B+', 'AB+'])[1 + ((p.id - 1) % 4)::int]
                    ),
                    phone = COALESCE(
                        NULLIF(BTRIM(p.phone), ''),
                        '+56 9 6' || LPAD((((p.id * 37)::bigint) % 10000000)::text, 7, '0')
                    ),
                    emergency_phone = COALESCE(
                        NULLIF(BTRIM(p.emergency_phone), ''),
                        '+56 9 7' || LPAD((((p.id * 53)::bigint) % 10000000)::text, 7, '0')
                    ),
                    position = COALESCE(
                        NULLIF(BTRIM(p.position), ''),
                        (ARRAY[
                            'Operador Jumbo',
                            'Supervisor de Turno',
                            'Mantenedor Electrico',
                            'Mecanico Mina',
                            'Topografo',
                            'Prevencionista'
                        ])[1 + ((p.id - 1) % 6)::int]
                    ),
                    group_name = COALESCE(
                        NULLIF(BTRIM(p.group_name), ''),
                        (ARRAY['Turno A', 'Turno B', 'Turno C', 'Contratistas'])[1 + ((p.id - 1) % 4)::int]
                    ),
                    updated_at = now()
                """
            )
        )

        insert_sql = f"""
        {generated_cte}
        INSERT INTO {table} (
            {fk},
            driver_license,
            driver_license_exp,
            medical_exams,
            medical_exams_exp,
            entry_type,
            entry_exp,
            site_induction,
            site_induction_exp,
            height_work_cert,
            height_work_cert_exp,
            contract_end,
            allergies,
            medical_notes,
            address,
            phone_primary,
            phone_emergency,
            emergency_contact_name,
            blood_type,
            ppe_size,
            photo_url
        )
        SELECT
            g.person_id_value,
            g.driver_license,
            g.driver_license_exp,
            g.medical_exams,
            g.medical_exams_exp,
            g.entry_type,
            g.entry_exp,
            g.site_induction,
            g.site_induction_exp,
            g.height_work_cert,
            g.height_work_cert_exp,
            g.contract_end,
            g.allergies,
            g.medical_notes,
            g.address,
            g.phone_primary,
            g.phone_emergency,
            g.emergency_contact_name,
            g.blood_type,
            g.ppe_size,
            NULL
        FROM generated g
        LEFT JOIN {table} px
          ON CAST(px.{fk} AS text) = g.person_id_text
        WHERE px.{fk} IS NULL
        """
        await db.execute(text(insert_sql))

        update_sql = f"""
        {generated_cte}
        UPDATE {table} px
        SET
            driver_license = COALESCE(NULLIF(BTRIM(px.driver_license), ''), g.driver_license),
            driver_license_exp = COALESCE(px.driver_license_exp, g.driver_license_exp),
            medical_exams = COALESCE(NULLIF(BTRIM(px.medical_exams), ''), g.medical_exams),
            medical_exams_exp = COALESCE(px.medical_exams_exp, g.medical_exams_exp),
            entry_type = COALESCE(NULLIF(BTRIM(px.entry_type), ''), g.entry_type),
            entry_exp = COALESCE(px.entry_exp, g.entry_exp),
            site_induction = COALESCE(NULLIF(BTRIM(px.site_induction), ''), g.site_induction),
            site_induction_exp = COALESCE(px.site_induction_exp, g.site_induction_exp),
            height_work_cert = COALESCE(NULLIF(BTRIM(px.height_work_cert), ''), g.height_work_cert),
            height_work_cert_exp = COALESCE(px.height_work_cert_exp, g.height_work_cert_exp),
            contract_end = COALESCE(px.contract_end, g.contract_end),
            allergies = COALESCE(NULLIF(BTRIM(px.allergies), ''), g.allergies),
            medical_notes = COALESCE(NULLIF(BTRIM(px.medical_notes), ''), g.medical_notes),
            address = COALESCE(NULLIF(BTRIM(px.address), ''), g.address),
            phone_primary = COALESCE(NULLIF(BTRIM(px.phone_primary), ''), g.phone_primary),
            phone_emergency = COALESCE(NULLIF(BTRIM(px.phone_emergency), ''), g.phone_emergency),
            emergency_contact_name = COALESCE(NULLIF(BTRIM(px.emergency_contact_name), ''), g.emergency_contact_name),
            blood_type = COALESCE(NULLIF(BTRIM(px.blood_type), ''), g.blood_type),
            ppe_size = COALESCE(NULLIF(BTRIM(px.ppe_size), ''), g.ppe_size),
            updated_at = now()
        FROM generated g
        WHERE CAST(px.{fk} AS text) = g.person_id_text
        """
        await db.execute(text(update_sql))

        if needs_expiry_reset:
            force_expiry_sql = f"""
            {generated_cte}
            UPDATE {table} px
            SET
                driver_license_exp = g.driver_license_exp,
                medical_exams_exp = g.medical_exams_exp,
                entry_exp = g.entry_exp,
                site_induction_exp = g.site_induction_exp,
                height_work_cert_exp = g.height_work_cert_exp,
                contract_end = g.contract_end,
                updated_at = now()
            FROM generated g
            WHERE CAST(px.{fk} AS text) = g.person_id_text
            """
            await db.execute(text(force_expiry_sql))

        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"No fue posible completar la ficha demo de personas: {str(e)}",
        ) from e


async def _ensure_app_setting_schema(db: AsyncSession) -> None:
    try:
        await ensure_shared_app_setting_schema(db)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No fue posible preparar las fuentes externas: {str(e)}",
        ) from e


def _validate_external_source_url(value: str, field_name: str) -> str:
    clean = (value or "").strip()
    if not clean:
        raise HTTPException(status_code=422, detail=f"{field_name} es requerido")

    parsed = urlparse(clean)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status_code=422,
            detail=f"{field_name} debe ser una URL absoluta http/https",
        )
    return clean


def _normalize_allowed_roles(raw_roles: Any) -> List[str]:
    if not isinstance(raw_roles, list):
        return list(_PRODUCTION_MODULE_DEFAULTS["permissions"]["allowedRoles"])

    normalized = []
    seen = set()
    for item in raw_roles:
        role = str(item or "").strip()
        if not role:
            continue
        lowered = role.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        normalized.append(role)

    return normalized or list(_PRODUCTION_MODULE_DEFAULTS["permissions"]["allowedRoles"])


def _normalize_production_module_payload(payload: Any) -> Dict[str, Any]:
    normalized = payload if isinstance(payload, dict) else {}
    permissions = normalized.get("permissions")
    if not isinstance(permissions, dict):
        permissions = {}
    permissions["allowedRoles"] = _normalize_allowed_roles(permissions.get("allowedRoles"))
    normalized["permissions"] = permissions
    return normalized


@router.get("/persons")
async def list_persons(db: AsyncSession = Depends(get_db)):
    person_extra_table, person_extra_fk = await _ensure_person_extra_schema(db)
    await _ensure_person_demo_profiles(db, person_extra_table, person_extra_fk)
    sql = f"""
    SELECT
        p.id,
        p.company_id,
        c.name AS company_name,
        p.rut,
        p.full_name,
        COALESCE(NULLIF(p.position, ''), NULLIF(p.group_name, '')) AS role,
        p.phone,
        p.active,
        p.created_at,
        p.updated_at,
        px.driver_license,
        px.driver_license_exp,
        px.medical_exams,
        px.medical_exams_exp,
        px.entry_type,
        px.entry_exp,
        px.site_induction,
        px.site_induction_exp,
        px.height_work_cert,
        px.height_work_cert_exp,
        px.contract_end,
        px.allergies,
        px.medical_notes,
        COALESCE(px.address, p.address) AS address,
        COALESCE(px.phone_primary, p.phone) AS phone_primary,
        COALESCE(px.phone_emergency, p.emergency_phone) AS phone_emergency,
        px.emergency_contact_name,
        COALESCE(px.blood_type, p.blood_type) AS blood_type,
        px.ppe_size,
        px.photo_url,
        px.updated_at AS extra_updated_at,
        ta.id AS assignment_id,
        t.id AS tag_id,
        t.code AS tag_code
    FROM person p
    LEFT JOIN company c
        ON c.id = p.company_id
    LEFT JOIN {person_extra_table} px
        ON px.{person_extra_fk} = p.id
    LEFT JOIN LATERAL (
        SELECT ta.id, ta.tag_id
        FROM tag_assignment ta
        WHERE ta.entity_type = 'person'
          AND ta.entity_id = p.id
          AND ta.active = TRUE
        ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC
        LIMIT 1
    ) ta ON TRUE
    LEFT JOIN tag t
        ON t.id = ta.tag_id
    ORDER BY p.id DESC
    """
    res = await db.execute(text(sql))
    return [dict(row) for row in res.mappings().all()]


@router.get("/equipment")
async def list_equipment(db: AsyncSession = Depends(get_db)):
    sql = """
    SELECT
        e.id,
        e.company_id,
        c.name AS company_name,
        e.code,
        e.name,
        COALESCE(et.name, et.code) AS type,
        e.description,
        e.critical,
        e.active,
        e.created_at,
        e.updated_at
    FROM equipment e
    LEFT JOIN company c
        ON c.id = e.company_id
    LEFT JOIN equipment_type et
        ON et.id = e.equipment_type_id
    ORDER BY e.id DESC
    """
    res = await db.execute(text(sql))
    return [dict(row) for row in res.mappings().all()]


@router.get("/vehicles")
async def list_vehicles(db: AsyncSession = Depends(get_db)):
    sql = """
    SELECT
        v.id,
        v.patente,
        vc.company_id,
        c.name AS company_name,
        v.level,
        v.status AS status_label,
        CASE
            WHEN LOWER(COALESCE(v.status, 'offline')) IN ('online', 'active', 'activo', 'alerta', 'warning')
            THEN TRUE
            ELSE FALSE
        END AS status,
        ta.id AS assignment_id,
        t.id AS tag_id,
        t.code AS tag_code,
        NULL::text AS descripcion
    FROM vehicles v
    LEFT JOIN LATERAL (
        SELECT vehicle_id, company_id
        FROM vehicle_company vc
        WHERE vc.vehicle_id = v.id
          AND vc.active = TRUE
        ORDER BY vc.valid_from DESC, vc.id DESC
        LIMIT 1
    ) vc ON TRUE
    LEFT JOIN company c
        ON c.id = vc.company_id
    LEFT JOIN LATERAL (
        SELECT ta.id, ta.tag_id
        FROM tag_assignment ta
        WHERE ta.entity_type = 'vehicle'
          AND ta.entity_id = v.id
          AND ta.active = TRUE
        ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC
        LIMIT 1
    ) ta ON TRUE
    LEFT JOIN tag t
        ON t.id = ta.tag_id
    ORDER BY v.id DESC
    """
    res = await db.execute(text(sql))
    return [dict(row) for row in res.mappings().all()]


@router.get("/tags")
async def list_tags(db: AsyncSession = Depends(get_db)):
    sql = """
    SELECT
        t.id,
        t.code,
        NULL::text AS description,
        TRUE AS active,
        ta.id AS assignment_id,
        ta.entity_type,
        ta.entity_id,
        CASE
            WHEN ta.entity_type = 'person' THEN p.full_name
            WHEN ta.entity_type = 'vehicle' THEN v.patente
            WHEN ta.entity_type = 'equipment' THEN e.name
            ELSE ta.display_name
        END AS assigned_to
    FROM tag t
    LEFT JOIN LATERAL (
        SELECT ta.*
        FROM tag_assignment ta
        WHERE ta.tag_id = t.id
          AND ta.active = TRUE
        ORDER BY ta.updated_at DESC NULLS LAST, ta.id DESC
        LIMIT 1
    ) ta ON TRUE
    LEFT JOIN person p
        ON ta.entity_type = 'person' AND p.id = ta.entity_id
    LEFT JOIN vehicles v
        ON ta.entity_type = 'vehicle' AND v.id = ta.entity_id
    LEFT JOIN equipment e
        ON ta.entity_type = 'equipment' AND e.id = ta.entity_id
    ORDER BY t.code ASC, t.id DESC
    """
    res = await db.execute(text(sql))
    return [dict(row) for row in res.mappings().all()]


@router.get("/porticos")
async def list_porticos(db: AsyncSession = Depends(get_db)):
    sql = """
    SELECT
        ap.id,
        ap.name,
        ap.gateway_id,
        g.name AS gateway_name,
        ap.specific_name,
        ap.site,
        ap.nivel,
        ap.site_code,
        ap.zone,
        ap.active,
        ap.has_climate,
        apt.code AS portico_type_code,
        ap.operating_mode,
        ap.antenna_in_port,
        ap.antenna_out_port,
        ap.sequence_window_seconds,
        md.map_code,
        md.x_pct,
        md.y_pct,
        ap.created_at,
        ap.updated_at
    FROM access_portico ap
    LEFT JOIN gateway g
        ON g.id = ap.gateway_id
    LEFT JOIN access_portico_type apt
        ON apt.id = ap.portico_type_id
    LEFT JOIN LATERAL (
        SELECT md.map_code, md.x_pct, md.y_pct
        FROM map_device md
        WHERE md.ref_id = ap.id
          AND md.kind IN ('portico', 'portico_clima')
        ORDER BY md.id DESC
        LIMIT 1
    ) md ON TRUE
    ORDER BY ap.id DESC
    """
    res = await db.execute(text(sql))
    return [dict(row) for row in res.mappings().all()]


# ---------- External Sources ----------

@router.get("/camera-monitoring")
async def get_camera_monitoring_settings(db: AsyncSession = Depends(get_db)):
    try:
        return await get_camera_monitoring_settings_payload(db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No fue posible leer la configuracion de monitoreo de camaras: {str(e)}",
        ) from e


@router.put("/camera-monitoring")
async def update_camera_monitoring_settings(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    if "refresh_interval_seconds" not in payload:
        raise HTTPException(
            status_code=422,
            detail="refresh_interval_seconds es requerido",
        )

    try:
        settings_payload = await upsert_camera_monitoring_interval_seconds(
            db,
            payload.get("refresh_interval_seconds"),
        )
        await db.commit()
        return settings_payload
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible guardar la configuracion de monitoreo de camaras: {str(e)}",
        ) from e


@router.get("/updates")
async def get_update_catalog(db: AsyncSession = Depends(get_db)):
    await _ensure_app_setting_schema(db)
    result = await db.execute(
        text("SELECT value FROM app_setting WHERE key = :key LIMIT 1"),
        {"key": _UPDATE_CATALOG_KEY},
    )
    raw = result.scalar_one_or_none()
    if not raw:
        return {"items": _DEFAULT_UPDATE_CATALOG}
    try:
        items = json.loads(raw)
    except (TypeError, ValueError):
        items = _DEFAULT_UPDATE_CATALOG
    if not isinstance(items, list):
        items = _DEFAULT_UPDATE_CATALOG
    return {"items": items}


@router.put("/updates/{update_id}")
async def update_catalog_entry(
    update_id: str,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    if update_id not in {item["id"] for item in _DEFAULT_UPDATE_CATALOG}:
        raise HTTPException(status_code=404, detail="Actualización no encontrada")
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"install", "uninstall", "hide", "unhide"}:
        raise HTTPException(status_code=422, detail="Acción de actualización inválida")

    catalog = await get_update_catalog(db)
    items = json.loads(json.dumps(catalog.get("items") or _DEFAULT_UPDATE_CATALOG))
    entry = next((item for item in items if item.get("id") == update_id), None)
    if entry is None:
        entry = dict(_DEFAULT_UPDATE_CATALOG[0])
        items.append(entry)
    if action == "install":
        entry["installed"] = True
        entry["hidden"] = False
    elif action == "uninstall":
        entry["installed"] = False
        entry["hidden"] = False
    elif action == "hide":
        entry["hidden"] = True
    else:
        entry["hidden"] = False

    try:
        await upsert_app_setting(
            db,
            key=_UPDATE_CATALOG_KEY,
            value=json.dumps(items, ensure_ascii=False),
            description="Estado de instalación y visibilidad de actualizaciones de Zenit.",
            category="updates",
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"No fue posible guardar la actualización: {exc}") from exc
    return entry

@router.get("/external-sources")
async def get_external_sources(db: AsyncSession = Depends(get_db)):
    await _ensure_app_setting_schema(db)
    res = await db.execute(
        text(
            """
            SELECT key, value, description, category, updated_at
            FROM app_setting
            WHERE category = 'external_sources'
            ORDER BY key ASC
            """
        )
    )
    rows = {row["key"]: dict(row) for row in res.mappings().all()}

    payload: Dict[str, Any] = {}
    items: List[Dict[str, Any]] = []
    for key, meta in _EXTERNAL_SOURCE_DEFAULTS.items():
        row = rows.get(key) or {}
        url = row.get("value") or meta["value"]
        payload[key] = url
        items.append(
            {
                "key": key,
                "label": meta["label"],
                "url": url,
                "description": row.get("description") or meta["description"],
                "updated_at": row.get("updated_at"),
            }
        )

    payload["items"] = items
    return payload


@router.put("/external-sources")
async def update_external_sources(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_app_setting_schema(db)

    updates: Dict[str, str] = {}
    for key in _EXTERNAL_SOURCE_DEFAULTS.keys():
        if key in payload:
            updates[key] = _validate_external_source_url(str(payload.get(key) or ""), key)

    if not updates:
        raise HTTPException(status_code=422, detail="No se recibieron URLs para actualizar")

    try:
        for key, value in updates.items():
            await upsert_app_setting(
                db,
                key=key,
                value=value,
                description=_EXTERNAL_SOURCE_DEFAULTS[key]["description"],
                category="external_sources",
            )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible guardar las fuentes externas: {str(e)}",
        ) from e

    return await get_external_sources(db)


@router.get("/production-module")
async def get_production_module(db: AsyncSession = Depends(get_db)):
    await _ensure_app_setting_schema(db)
    res = await db.execute(
        text(
            """
            SELECT value, updated_at
            FROM app_setting
            WHERE key = :key
            LIMIT 1
            """
        ),
        {"key": _PRODUCTION_MODULE_SETTING_KEY},
    )
    row = res.mappings().first()

    if row and row.get("value"):
        try:
            payload = json.loads(row["value"])
        except json.JSONDecodeError:
            payload = load_seed_payload()
    else:
        payload = load_seed_payload()

    normalized = _normalize_production_module_payload(payload)
    all_schedule_tasks = (
        (normalized.get("schedule", {}).get("controlMineria") or [])
        + (normalized.get("schedule", {}).get("controlOOCC") or [])
    )
    linked_count = sum(1 for task in all_schedule_tasks if task.get("trackingPorticoId"))

    needs_refresh = (
        not row
        or not all_schedule_tasks
        or linked_count < min(8, len(all_schedule_tasks))
        or not (normalized.get("schedule", {}).get("hoursMineria", {}).get("crew"))
    )

    try:
        enriched = await enrich_payload_from_db(db, normalized if normalized else build_empty_payload())
    except Exception:
        # La base operativa puede no contener tags de antiguos seeds demo.
        # No debe impedir abrir ni editar la configuración de Producción.
        await db.rollback()
        enriched = normalized if normalized else build_empty_payload()

    if needs_refresh:
        try:
            await upsert_app_setting(
                db,
                key=_PRODUCTION_MODULE_SETTING_KEY,
                value=_dump_json(enriched),
                description="Configuracion, permisos y simulacion del modulo Produccion.",
                category="production_module",
            )
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise HTTPException(
                status_code=400,
                detail=f"No fue posible sembrar el modulo de produccion: {str(e)}",
            ) from e

        refreshed = await db.execute(
            text(
                """
                SELECT updated_at
                FROM app_setting
                WHERE key = :key
                LIMIT 1
                """
            ),
            {"key": _PRODUCTION_MODULE_SETTING_KEY},
        )
        fresh_row = refreshed.mappings().first() or {}
        enriched["updated_at"] = fresh_row.get("updated_at")
        return enriched

    try:
        await db.commit()
    except Exception:
        await db.rollback()

    enriched["updated_at"] = row.get("updated_at") if row else None
    return enriched


@router.get("/production-module/export.xlsx")
async def export_production_module_workbook(
    domain: str = Query("all"),
    date: str | None = Query(None),
    turno: str | None = Query(None),
    nivel: str | None = Query(None),
    map_code: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    payload = await get_production_module(db)
    schedule = payload.get("schedule") or {}

    mineria_tasks = _filter_production_tasks(
        list(schedule.get("controlMineria") or []),
        date=date,
        turno=turno,
        nivel=nivel,
        map_code=map_code,
        search=search,
    )
    oocc_tasks = _filter_production_tasks(
        list(schedule.get("controlOOCC") or []),
        date=date,
        turno=turno,
        nivel=nivel,
        map_code=map_code,
        search=search,
    )

    focus = domain if domain in {"mineria", "oocc"} else None
    workbook = build_production_workbook_bytes(
        payload,
        mineria_tasks=mineria_tasks,
        oocc_tasks=oocc_tasks,
        focus=focus,
    )

    operation_date = date or str((payload.get("meta") or {}).get("operationDate") or "")[:10] or "operacion"
    scope = focus or "completo"
    filename = f"produccion_{scope}_{operation_date}.xlsx"

    return StreamingResponse(
        workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/production-module/validate-tracking")
async def validate_production_tracking_task(
    task: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    return await validate_task_tracking(db, task)


@router.put("/production-module")
async def update_production_module(
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_app_setting_schema(db)
    normalized = _normalize_production_module_payload(payload)
    enriched = await enrich_payload_from_db(db, normalized)

    try:
        await upsert_app_setting(
            db,
            key=_PRODUCTION_MODULE_SETTING_KEY,
            value=_dump_json(enriched),
            description="Configuracion, permisos y simulacion del modulo Produccion.",
            category="production_module",
        )
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible guardar el modulo de produccion: {str(e)}",
        ) from e

    return await get_production_module(db)


# ---------- CRUD: companies ----------

@router.post("/companies", status_code=status.HTTP_201_CREATED)
async def create_company(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    return await _insert_row(db, table="company", payload=payload)


@router.put("/companies/{company_id}")
async def update_company(
    company_id: str = Path(..., description="Company ID"),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    return await _update_row(db, table="company", id_value=company_id, payload=payload)


@router.delete("/companies/{company_id}")
async def delete_company(company_id: str = Path(..., description="Company ID"), db: AsyncSession = Depends(get_db)):
    return await _delete_row(db, table="company", id_value=company_id)


# ---------- CRUD: persons ----------

@router.post("/persons", status_code=status.HTTP_201_CREATED)
async def create_person(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    full_name = (payload.get("full_name") or "").strip()
    if not full_name:
        raise HTTPException(status_code=422, detail="full_name es requerido")

    first_name, last_name = _split_full_name(full_name)
    person_payload = {
        "company_id": payload.get("company_id"),
        "rut": (payload.get("rut") or "").strip() or None,
        "full_name": full_name,
        "first_name": (payload.get("first_name") or first_name or "").strip() or None,
        "last_name": (payload.get("last_name") or last_name or "").strip() or None,
        "position": (payload.get("role") or payload.get("position") or "").strip() or None,
        "phone": (payload.get("phone") or "").strip() or None,
        "active": True if payload.get("active") is None else bool(payload.get("active")),
    }
    return await _insert_row(db, table="person", payload=person_payload)


@router.put("/persons/{person_id}")
async def update_person(
    person_id: str = Path(..., description="Person ID"),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    update_payload: Dict[str, Any] = {}
    if "company_id" in payload:
        update_payload["company_id"] = payload.get("company_id")
    if "rut" in payload:
        update_payload["rut"] = (payload.get("rut") or "").strip() or None
    if "full_name" in payload:
        full_name = (payload.get("full_name") or "").strip()
        update_payload["full_name"] = full_name or None
        first_name, last_name = _split_full_name(full_name)
        update_payload.setdefault("first_name", first_name)
        update_payload.setdefault("last_name", last_name)
    if "first_name" in payload:
        update_payload["first_name"] = (payload.get("first_name") or "").strip() or None
    if "last_name" in payload:
        update_payload["last_name"] = (payload.get("last_name") or "").strip() or None
    if "role" in payload or "position" in payload:
        update_payload["position"] = (payload.get("role") or payload.get("position") or "").strip() or None
    if "phone" in payload:
        update_payload["phone"] = (payload.get("phone") or "").strip() or None
    if "active" in payload:
        update_payload["active"] = bool(payload.get("active"))
    return await _update_row(db, table="person", id_value=person_id, payload=update_payload)


@router.delete("/persons/{person_id}")
async def delete_person(person_id: str = Path(..., description="Person ID"), db: AsyncSession = Depends(get_db)):
    return await _delete_row(db, table="person", id_value=person_id)


# ---------- Person Extra (GET + Upsert) ----------


@router.get("/persons/{person_id}/extra")
async def get_person_extra(person_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    table, fk = await _ensure_person_extra_schema(db)
    await _ensure_person_demo_profiles(db, table, fk)

    sql = f"SELECT * FROM {table} WHERE CAST({fk} AS text) = :pid LIMIT 1"
    res = await db.execute(text(sql), {"pid": str(person_id)})
    row = res.mappings().first()
    return dict(row) if row else {}


@router.put("/persons/{person_id}/extra")
async def upsert_person_extra(
    person_id: str = Path(...),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    table, fk = await _ensure_person_extra_schema(db)
    cols = await _get_columns(db, table)

    # Check if exists
    existing_sql = f"SELECT * FROM {table} WHERE CAST({fk} AS text) = :pid LIMIT 1"
    existing = await db.execute(text(existing_sql), {"pid": str(person_id)})
    existing_row = existing.mappings().first()

    data = _safe_payload_for_columns(cols, payload)
    # asyncpg no convierte strings ISO a DATE automaticamente. Normalizamos
    # los campos de vencimiento enviados por el formulario HTML.
    for field in (
        "driver_license_exp", "medical_exams_exp", "entry_exp",
        "site_induction_exp", "height_work_cert_exp", "contract_end",
    ):
        if field in data and isinstance(data[field], str):
            value = data[field].strip()
            data[field] = datetime_type.strptime(value, "%Y-%m-%d").date() if value else None
    data[fk] = int(person_id) if str(person_id).isdigit() else person_id

    try:
        if existing_row:
            # Update by fk (safe for 1:1).
            data.pop("id", None)
            set_parts = [f"{k} = :{k}" for k in data.keys() if k != fk]
            if "updated_at" in cols:
                set_parts.append("updated_at = now()")
            set_sql = ", ".join(set_parts)
            if not set_sql:
                return dict(existing_row)
            upd_sql = f"UPDATE {table} SET {set_sql} WHERE CAST({fk} AS text) = :pid RETURNING *"
            params = dict(data)
            params["pid"] = str(person_id)
            res = await db.execute(text(upd_sql), params)
        else:
            # Insert
            res = await db.execute(
                text(
                    "INSERT INTO "
                    + table
                    + " ("
                    + ", ".join(data.keys())
                    + ") VALUES ("
                    + ", ".join([f":{k}" for k in data.keys()])
                    + ") RETURNING *"
                ),
                data,
            )

        row = res.mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Upsert failed")
        await db.commit()
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Upsert failed: {str(e)}") from e


# ---------- CRUD: equipment ----------

@router.post("/equipment", status_code=status.HTTP_201_CREATED)
async def create_equipment(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name es requerido")

    equipment_type_id = await _ensure_equipment_type(db, payload.get("type"))
    equipment_payload = {
        "company_id": payload.get("company_id"),
        "equipment_type_id": equipment_type_id,
        "code": (payload.get("code") or "").strip() or await _generate_equipment_code(db, name),
        "name": name,
        "description": (payload.get("description") or "").strip() or None,
        "critical": bool(payload.get("critical")) if payload.get("critical") is not None else False,
        "active": True if payload.get("active") is None else bool(payload.get("active")),
    }
    return await _insert_row(db, table="equipment", payload=equipment_payload)


@router.put("/equipment/{equipment_id}")
async def update_equipment(
    equipment_id: str = Path(...),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    update_payload: Dict[str, Any] = {}
    if "company_id" in payload:
        update_payload["company_id"] = payload.get("company_id")
    if "type" in payload:
        update_payload["equipment_type_id"] = await _ensure_equipment_type(db, payload.get("type"))
    if "name" in payload:
        update_payload["name"] = (payload.get("name") or "").strip() or None
    if "description" in payload:
        update_payload["description"] = (payload.get("description") or "").strip() or None
    if "critical" in payload:
        update_payload["critical"] = bool(payload.get("critical"))
    if "active" in payload:
        update_payload["active"] = bool(payload.get("active"))
    return await _update_row(db, table="equipment", id_value=equipment_id, payload=update_payload)


@router.delete("/equipment/{equipment_id}")
async def delete_equipment(equipment_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    return await _delete_row(db, table="equipment", id_value=equipment_id)


# ---------- CRUD: vehicles ----------

@router.post("/vehicles", status_code=status.HTTP_201_CREATED)
async def create_vehicle(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    patente = (payload.get("patente") or payload.get("plate") or "").strip()
    if not patente:
        raise HTTPException(status_code=422, detail="patente es requerida")

    vehicle_payload = {
        "patente": patente,
        "status": _status_text_from_bool(payload.get("status", True)),
        "level": payload.get("level"),
    }

    try:
        created = await _insert_row(db, table="vehicles", payload=vehicle_payload)
        if created.get("id"):
            await _upsert_vehicle_company(
                db,
                vehicle_id=int(created["id"]),
                company_id=int(payload["company_id"]) if payload.get("company_id") else None,
            )
            await db.commit()
        return created
    except Exception:
        await db.rollback()
        raise


@router.put("/vehicles/{vehicle_id}")
async def update_vehicle(
    vehicle_id: str = Path(...),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    update_payload: Dict[str, Any] = {}
    if "patente" in payload or "plate" in payload:
        update_payload["patente"] = (payload.get("patente") or payload.get("plate") or "").strip() or None
    if "status" in payload:
        update_payload["status"] = _status_text_from_bool(payload.get("status"))
    if "level" in payload:
        update_payload["level"] = payload.get("level")

    try:
        updated = await _update_row(db, table="vehicles", id_value=vehicle_id, payload=update_payload)
        if "company_id" in payload:
            await _upsert_vehicle_company(
                db,
                vehicle_id=int(vehicle_id),
                company_id=int(payload["company_id"]) if payload.get("company_id") else None,
            )
            await db.commit()
        return updated
    except Exception:
        await db.rollback()
        raise


@router.delete("/vehicles/{vehicle_id}")
async def delete_vehicle(vehicle_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    try:
        await db.execute(
            text("UPDATE vehicle_company SET active = FALSE WHERE vehicle_id = :vehicle_id AND active = TRUE"),
            {"vehicle_id": int(vehicle_id)},
        )
        await db.execute(
            text(
                """
                UPDATE tag_assignment
                SET active = FALSE
                WHERE entity_type = 'vehicle'
                  AND entity_id = :vehicle_id
                  AND active = TRUE
                """
            ),
            {"vehicle_id": int(vehicle_id)},
        )
        res = await db.execute(
            text(
                """
                UPDATE vehicles
                SET status = 'offline'
                WHERE id = :vehicle_id
                RETURNING *
                """
            ),
            {"vehicle_id": int(vehicle_id)},
        )
        row = res.mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(status_code=404, detail="Not found")
        await db.commit()
        return dict(row)
    except Exception:
        await db.rollback()
        raise


# ---------- CRUD: tags ----------

@router.post("/tags", status_code=status.HTTP_201_CREATED)
async def create_tag(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    return await _insert_row(db, table="tag", payload=payload)


@router.put("/tags/{tag_id}")
async def update_tag(
    tag_id: str = Path(...),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    return await _update_row(db, table="tag", id_value=tag_id, payload=payload)


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    return await _delete_row(db, table="tag", id_value=tag_id)


# ---------- Entity-Tag + Tag Assignments ----------

_TAG_ASSIGN_TABLE_CANDIDATES = [
    "tag_assignment",
    "tag_assignments",
    "entity_tag",
    "entity_tag_assignment",
]


def _pick_entity_type_column(cols: Set[str]) -> Optional[str]:
    for c in ("entity_type", "entity", "type", "entity_kind"):
        if c in cols:
            return c
    return None


def _pick_entity_id_column(cols: Set[str]) -> Optional[str]:
    for c in ("entity_id", "id_entity", "entityid", "subject_id"):
        if c in cols:
            return c
    return None


@router.get("/entity-tag")
async def get_entity_tag(
    entity_type: str = Query(..., description="Entity type (e.g. person, vehicle, equipment)"),
    entity_id: str = Query(..., description="Entity id"),
    db: AsyncSession = Depends(get_db),
):
    ta_table = await _find_existing_table(db, _TAG_ASSIGN_TABLE_CANDIDATES)
    if not ta_table:
        return {}

    ta_cols = await _get_columns(db, ta_table)
    type_col = _pick_entity_type_column(ta_cols)
    eid_col = _pick_entity_id_column(ta_cols)
    tag_id_col = "tag_id" if "tag_id" in ta_cols else None
    if not (type_col and eid_col and tag_id_col):
        return {}

    # Try to enrich with tag table if present.
    tag_exists = await _table_exists(db, "tag")
    active_col = _pick_active_column(ta_cols)
    active_select = f"ta.{active_col} AS assignment_active" if active_col else "TRUE AS assignment_active"

    where = f"ta.{type_col} = :etype AND CAST(ta.{eid_col} AS text) = :eid"
    if active_col:
        # For status columns, "false" usually means inactive.
        where += f" AND (ta.{active_col} IS NULL OR ta.{active_col} = true)"

    if tag_exists:
        sql = (
            f"SELECT ta.id AS assignment_id, ta.tag_id, ta.{type_col} AS entity_type, ta.{eid_col} AS entity_id, "
            f"       ta.display_name, {active_select}, "
            f"       t.id AS tag_pk, t.code "
            f"FROM {ta_table} ta "
            f"LEFT JOIN tag t ON t.id = ta.{tag_id_col} "
            f"WHERE {where} "
            f"ORDER BY ta.id DESC "
            f"LIMIT 1"
        )
    else:
        sql = (
            f"SELECT ta.id AS assignment_id, ta.tag_id, ta.{type_col} AS entity_type, ta.{eid_col} AS entity_id, "
            f"       ta.display_name, {active_select} "
            f"FROM {ta_table} ta "
            f"WHERE {where} "
            f"ORDER BY ta.id DESC "
            f"LIMIT 1"
        )

    res = await db.execute(text(sql), {"etype": entity_type, "eid": str(entity_id)})
    row = res.mappings().first()
    return dict(row) if row else {}


@router.post("/tag-assignments", status_code=status.HTTP_201_CREATED)
async def assign_tag(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    ta_table = await _find_existing_table(db, _TAG_ASSIGN_TABLE_CANDIDATES)
    if not ta_table:
        raise HTTPException(status_code=404, detail="Tag assignment table not found")

    cols = await _get_columns(db, ta_table)
    type_col = _pick_entity_type_column(cols)
    eid_col = _pick_entity_id_column(cols)
    if not type_col or not eid_col or ("tag_id" not in cols):
        raise HTTPException(status_code=400, detail="Tag assignment table missing required columns")

    raw_tag_id = payload.get("tag_id")
    if isinstance(raw_tag_id, list):
        raw_tag_id = raw_tag_id[0] if raw_tag_id else None
    raw_entity_id = payload.get("entity_id")
    if isinstance(raw_entity_id, list):
        raw_entity_id = raw_entity_id[0] if raw_entity_id else None

    # Require minimum fields from payload (regardless of column names).
    if "entity_type" not in payload or "entity_id" not in payload or "tag_id" not in payload:
        raise HTTPException(status_code=422, detail="Body must include: entity_type, entity_id, tag_id")

    # Normalize payload into real table columns.
    normalized = dict(payload)
    normalized[type_col] = payload.get("entity_type")
    normalized[eid_col] = int(raw_entity_id) if str(raw_entity_id).isdigit() else raw_entity_id
    normalized["tag_id"] = raw_tag_id

    data = _safe_payload_for_columns(cols, normalized)

    # Optional: deactivate previous assignment for this entity
    active_col = _pick_active_column(cols)
    try:
        if active_col:
            deact_sql = (
                f"UPDATE {ta_table} SET {active_col} = false "
                f"WHERE {type_col} = :etype AND CAST({eid_col} AS text) = :eid"
            )
            await db.execute(text(deact_sql), {"etype": payload["entity_type"], "eid": str(raw_entity_id)})
            # A tag must never stay activo en múltiples entidades.
            await db.execute(
                text(f"UPDATE {ta_table} SET {active_col} = false WHERE tag_id = :tag_id"),
                {"tag_id": raw_tag_id},
            )
            # Ensure inserted row becomes active when column exists.
            data.setdefault(active_col, True)

        res = await db.execute(
            text(
                "INSERT INTO "
                + ta_table
                + " ("
                + ", ".join(data.keys())
                + ") VALUES ("
                + ", ".join([f":{k}" for k in data.keys()])
                + ") RETURNING *"
            ),
            data,
        )
        row = res.mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(status_code=400, detail="Assign failed")
        await db.commit()
        return dict(row)
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"Assign failed: {str(e)}") from e


@router.delete("/tag-assignments/{assignment_id}")
async def unassign_tag(assignment_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    ta_table = await _find_existing_table(db, _TAG_ASSIGN_TABLE_CANDIDATES)
    if not ta_table:
        raise HTTPException(status_code=404, detail="Tag assignment table not found")
    return await _delete_row(db, table=ta_table, id_value=assignment_id)


@router.put("/equipment-portico-rules/{equipment_id}")
async def set_equipment_portico_rule(
    equipment_id: int,
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    """Define el unico portico autorizado para un equipo con RFID."""
    allowed_portico_id = payload.get("allowed_portico_id")
    if not isinstance(allowed_portico_id, int) or allowed_portico_id < 1:
        raise HTTPException(status_code=422, detail="allowed_portico_id es requerido")
    result = await db.execute(
        text(
            """
            INSERT INTO equipment_portico_rule (equipment_id, allowed_portico_id, active, updated_at)
            VALUES (:equipment_id, :allowed_portico_id, TRUE, NOW())
            ON CONFLICT (equipment_id) DO UPDATE
            SET allowed_portico_id = EXCLUDED.allowed_portico_id,
                active = TRUE,
                updated_at = NOW()
            RETURNING equipment_id, allowed_portico_id, active
            """
        ),
        {"equipment_id": equipment_id, "allowed_portico_id": allowed_portico_id},
    )
    row = result.mappings().first()
    await db.commit()
    return dict(row)


@router.get("/equipment-portico-rules/{equipment_id}")
async def get_equipment_portico_rule(equipment_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("SELECT equipment_id, allowed_portico_id, active FROM equipment_portico_rule WHERE equipment_id = :equipment_id AND active = TRUE"),
        {"equipment_id": equipment_id},
    )
    row = result.mappings().first()
    return dict(row) if row else {"equipment_id": equipment_id, "allowed_portico_id": None, "active": False}


# ---------- CRUD: porticos ----------

@router.post("/porticos", status_code=status.HTTP_201_CREATED)
async def create_portico(payload: Dict[str, Any] = Body(...), db: AsyncSession = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="name es requerido")

    operating_mode = _clean_portico_mode(payload.get("operating_mode"))
    antenna_in_port = _clean_positive_int(payload.get("antenna_in_port"), default=1)
    antenna_out_port = _clean_positive_int(payload.get("antenna_out_port"))
    if operating_mode != "ACCESS":
        antenna_out_port = None

    gateway_id = await _ensure_gateway(
        db,
        payload.get("gateway_id"),
        name,
        gateway_name=payload.get("gateway_name"),
    )
    has_climate = bool(payload.get("has_climate"))
    portico_type_id = await _ensure_portico_type(db, want_climate=has_climate)
    portico_payload = {
        "gateway_id": gateway_id,
        "name": name,
        "specific_name": (payload.get("specific_name") or "").strip() or None,
        "site": (payload.get("site") or "").strip() or None,
        "nivel": (payload.get("nivel") or "").strip() or None,
        "site_code": (payload.get("site_code") or "").strip() or None,
        "zone": (payload.get("zone") or "").strip() or None,
        "portico_type_id": portico_type_id,
        "operating_mode": operating_mode,
        "antenna_in_port": antenna_in_port,
        "antenna_out_port": antenna_out_port,
        "sequence_window_seconds": _clean_positive_int(payload.get("sequence_window_seconds"), default=15),
        "has_climate": has_climate,
        "active": True if payload.get("active") is None else bool(payload.get("active")),
    }
    try:
        created = await _insert_row(db, table="access_portico", payload=portico_payload)
        if created.get("id"):
            await _upsert_map_device_for_portico(
                db,
                int(created["id"]),
                label=created.get("name") or name,
                map_code=payload.get("map_code"),
                x_pct=payload.get("x_pct"),
                y_pct=payload.get("y_pct"),
                has_climate=has_climate,
            )
            await db.commit()
        return created
    except Exception:
        await db.rollback()
        raise


@router.put("/porticos/{portico_id}")
async def update_portico(
    portico_id: str = Path(...),
    payload: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    current = await _select_one_by_id(db, table="access_portico", id_value=portico_id)
    if not current:
        raise HTTPException(status_code=404, detail="Not found")

    has_climate = bool(payload.get("has_climate")) if "has_climate" in payload else bool(current.get("has_climate"))
    current_mode = _clean_portico_mode(current.get("operating_mode"))
    operating_mode = _clean_portico_mode(payload.get("operating_mode")) if "operating_mode" in payload else current_mode
    update_payload: Dict[str, Any] = {}
    if "gateway_id" in payload:
        update_payload["gateway_id"] = await _ensure_gateway(
            db,
            payload.get("gateway_id"),
            (payload.get("name") or current.get("name") or f"PORTICO-{portico_id}"),
            gateway_name=payload.get("gateway_name"),
        )
    elif "gateway_name" in payload:
        update_payload["gateway_id"] = await _ensure_gateway(
            db,
            None,
            (payload.get("name") or current.get("name") or f"PORTICO-{portico_id}"),
            gateway_name=payload.get("gateway_name"),
        )
    if "name" in payload:
        update_payload["name"] = (payload.get("name") or "").strip() or None
    if "specific_name" in payload:
        update_payload["specific_name"] = (payload.get("specific_name") or "").strip() or None
    if "site" in payload:
        update_payload["site"] = (payload.get("site") or "").strip() or None
    if "nivel" in payload:
        update_payload["nivel"] = (payload.get("nivel") or "").strip() or None
    if "site_code" in payload:
        update_payload["site_code"] = (payload.get("site_code") or "").strip() or None
    if "zone" in payload:
        update_payload["zone"] = (payload.get("zone") or "").strip() or None
    if "active" in payload:
        update_payload["active"] = bool(payload.get("active"))
    if "operating_mode" in payload:
        update_payload["operating_mode"] = operating_mode
    if "antenna_in_port" in payload or current.get("antenna_in_port") is not None:
        update_payload["antenna_in_port"] = _clean_positive_int(
            payload.get("antenna_in_port"),
            default=_clean_positive_int(current.get("antenna_in_port"), default=1),
        )
    if "antenna_out_port" in payload or current.get("antenna_out_port") is not None or operating_mode != "ACCESS":
        update_payload["antenna_out_port"] = (
            _clean_positive_int(
                payload.get("antenna_out_port"),
                default=_clean_positive_int(current.get("antenna_out_port")),
            )
            if operating_mode == "ACCESS"
            else None
        )
    if "sequence_window_seconds" in payload:
        update_payload["sequence_window_seconds"] = _clean_positive_int(
            payload.get("sequence_window_seconds"),
            default=_clean_positive_int(current.get("sequence_window_seconds"), default=15),
        )
    if "has_climate" in payload:
        update_payload["has_climate"] = has_climate
        update_payload["portico_type_id"] = await _ensure_portico_type(db, want_climate=has_climate)

    try:
        updated = await _update_row(db, table="access_portico", id_value=portico_id, payload=update_payload)
        if any(key in payload for key in ("x_pct", "y_pct", "map_code", "name", "has_climate")):
            await _upsert_map_device_for_portico(
                db,
                int(portico_id),
                label=updated.get("name") or current.get("name") or f"Portico {portico_id}",
                map_code=payload.get("map_code"),
                x_pct=payload.get("x_pct"),
                y_pct=payload.get("y_pct"),
                has_climate=has_climate,
            )
            await db.commit()
        return updated
    except Exception:
        await db.rollback()
        raise


@router.delete("/porticos/{portico_id}")
async def delete_portico(portico_id: str = Path(...), db: AsyncSession = Depends(get_db)):
    return await _delete_row(db, table="access_portico", id_value=portico_id)
