from __future__ import annotations

from typing import Any, Dict, Iterable, List, Set, Tuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


PermissionItem = Dict[str, Any]
PermissionPair = Tuple[str, str]


PERMISSION_CATALOG: List[PermissionItem] = [
    {"module_key": "tracking", "submodule_key": "tracking", "label": "Tracking", "sort_order": 10},
    {"module_key": "tracking", "submodule_key": "mapa", "label": "Tracking / Mapa", "sort_order": 11},
    {"module_key": "tracking", "submodule_key": "alertas", "label": "Tracking / Alertas", "sort_order": 12},
    {"module_key": "tracking", "submodule_key": "tiempo_real", "label": "Tracking / Tiempo real", "sort_order": 13},
    {"module_key": "tracking", "submodule_key": "movimiento", "label": "Tracking / Movimiento", "sort_order": 14},
    {"module_key": "tracking", "submodule_key": "zonas_det", "label": "Tracking / Zonas DET", "sort_order": 15},
    {"module_key": "produccion", "submodule_key": "produccion", "label": "Produccion", "sort_order": 20},
    {"module_key": "produccion", "submodule_key": "plano", "label": "Produccion / Plano", "sort_order": 21},
    {"module_key": "produccion", "submodule_key": "gantt_mineria", "label": "Produccion / Gantt mineria", "sort_order": 22},
    {"module_key": "produccion", "submodule_key": "control_mineria", "label": "Produccion / Control mineria", "sort_order": 23},
    {"module_key": "produccion", "submodule_key": "gantt_oocc", "label": "Produccion / Gantt OO.CC", "sort_order": 24},
    {"module_key": "produccion", "submodule_key": "control_oocc", "label": "Produccion / Control OO.CC", "sort_order": 25},
    {"module_key": "produccion", "submodule_key": "horas_mineria", "label": "Produccion / Horas mineria", "sort_order": 26},
    {"module_key": "acceso", "submodule_key": "acceso", "label": "Acceso", "sort_order": 30},
    {"module_key": "camaras", "submodule_key": "camaras", "label": "Camaras", "sort_order": 40},
    {"module_key": "camaras", "submodule_key": "ver_camaras", "label": "Camaras / Ver camaras", "sort_order": 41},
    {"module_key": "camaras", "submodule_key": "nok_camaras", "label": "NOC", "sort_order": 42},
    {"module_key": "productividad", "submodule_key": "productividad", "label": "Productividad", "sort_order": 50},
    {"module_key": "sismico", "submodule_key": "sismico", "label": "Semaforos sismicos", "sort_order": 60},
    {"module_key": "control_vial", "submodule_key": "control_vial", "label": "Semaforos control vial", "sort_order": 70},
    {"module_key": "agente_ia", "submodule_key": "agente_ia", "label": "Agente IA TM One", "sort_order": 80},
    {"module_key": "configuracion", "submodule_key": "configuracion", "label": "Configuracion", "sort_order": 90},
    {"module_key": "configuracion", "submodule_key": "empresas", "label": "Configuracion / Empresas", "sort_order": 91},
    {"module_key": "configuracion", "submodule_key": "personas", "label": "Configuracion / Personas", "sort_order": 92},
    {"module_key": "configuracion", "submodule_key": "equipos", "label": "Configuracion / Equipos", "sort_order": 93},
    {"module_key": "configuracion", "submodule_key": "porticos", "label": "Configuracion / Porticos", "sort_order": 94},
    {"module_key": "configuracion", "submodule_key": "tags", "label": "Configuracion / Tags", "sort_order": 95},
    {"module_key": "configuracion", "submodule_key": "vehiculos", "label": "Configuracion / Vehiculos", "sort_order": 96},
    {"module_key": "configuracion", "submodule_key": "camaras", "label": "Configuracion / Camaras", "sort_order": 97},
    {"module_key": "configuracion", "submodule_key": "produccion", "label": "Configuracion / Produccion", "sort_order": 98},
    {"module_key": "configuracion", "submodule_key": "usuarios_permisos", "label": "Configuracion / Usuarios y permisos", "sort_order": 99},
    {"module_key": "configuracion", "submodule_key": "fuentes_externas", "label": "Configuracion / Fuentes externas", "sort_order": 100},
    {"module_key": "configuracion", "submodule_key": "actualizaciones", "label": "Configuracion / Actualizaciones", "sort_order": 101},
]


def _pairs_for_module(module_key: str) -> Set[PermissionPair]:
    return {
        (item["module_key"], item["submodule_key"])
        for item in PERMISSION_CATALOG
        if item["module_key"] == module_key
    }


ROLE_PERMISSION_PRESETS: Dict[str, Set[PermissionPair]] = {
    "admin": {
        (item["module_key"], item["submodule_key"])
        for item in PERMISSION_CATALOG
    },
    "admin_produccion": _pairs_for_module("produccion"),
    "produccion": _pairs_for_module("produccion"),
    "tracking": _pairs_for_module("tracking"),
    "acceso": _pairs_for_module("acceso"),
    "camaras": _pairs_for_module("camaras"),
    "nok_camaras": {("camaras", "nok_camaras")},
    "configuracion": _pairs_for_module("configuracion"),
    "productividad": _pairs_for_module("productividad"),
    "sismico": _pairs_for_module("sismico"),
    "control_vial": _pairs_for_module("control_vial"),
    "agente_ia": _pairs_for_module("agente_ia"),
}


DEFAULT_USERS: List[Dict[str, Any]] = [
    {"username": "admin", "full_name": "Administrador", "password": "admin123", "role": "admin"},
    {
        "username": "admin_produccion",
        "full_name": "Admin Produccion",
        "password": "123",
        "role": "admin_produccion",
    },
    {"username": "tracking", "full_name": "Usuario Tracking", "password": "123", "role": "tracking"},
    {"username": "produccion", "full_name": "Usuario Produccion", "password": "123", "role": "produccion"},
    {"username": "acceso", "full_name": "Usuario Acceso", "password": "123", "role": "acceso"},
    {"username": "camaras", "full_name": "Usuario Camaras", "password": "123", "role": "camaras"},
    {"username": "productividad", "full_name": "Usuario Productividad", "password": "123", "role": "productividad"},
    {"username": "sismico", "full_name": "Usuario Sismico", "password": "123", "role": "sismico"},
    {"username": "control_vial", "full_name": "Usuario Control Vial", "password": "123", "role": "control_vial"},
    {"username": "agente_ia", "full_name": "Usuario Agente IA", "password": "123", "role": "agente_ia"},
]


def normalize_role(role: str | None) -> str:
    return str(role or "").strip().lower()


def is_admin_role(role: str | None) -> bool:
    return normalize_role(role) == "admin"


def permission_key(module_key: str, submodule_key: str) -> str:
    return f"{module_key}:{submodule_key}"


def get_permission_pairs_for_role(role: str | None) -> Set[PermissionPair]:
    normalized = normalize_role(role)
    if normalized == "admin":
        return {
            (item["module_key"], item["submodule_key"])
            for item in PERMISSION_CATALOG
        }
    return set(ROLE_PERMISSION_PRESETS.get(normalized, set()))


def build_effective_permission_map(
    user_role: str | None,
    overrides: Dict[PermissionPair, bool] | None = None,
) -> Dict[PermissionPair, bool]:
    if is_admin_role(user_role):
        return {
            (item["module_key"], item["submodule_key"]): True
            for item in PERMISSION_CATALOG
        }

    effective: Dict[PermissionPair, bool] = {}
    preset_pairs = get_permission_pairs_for_role(user_role)
    override_map = overrides or {}

    for item in PERMISSION_CATALOG:
        pair = (item["module_key"], item["submodule_key"])
        if pair in override_map:
            effective[pair] = bool(override_map[pair])
        else:
            effective[pair] = pair in preset_pairs

    return effective


async def ensure_permission_schema(session: AsyncSession) -> None:
    await session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS user_permission_catalog (
                module_key TEXT NOT NULL,
                submodule_key TEXT NOT NULL,
                label TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (module_key, submodule_key)
            )
            """
        )
    )
    await session.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS user_permission_assignment (
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                module_key TEXT NOT NULL,
                submodule_key TEXT NOT NULL,
                allowed BOOLEAN NOT NULL DEFAULT FALSE,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, module_key, submodule_key)
            )
            """
        )
    )

    for item in PERMISSION_CATALOG:
        await session.execute(
            text(
                """
                INSERT INTO user_permission_catalog (module_key, submodule_key, label, sort_order)
                VALUES (:module_key, :submodule_key, :label, :sort_order)
                ON CONFLICT (module_key, submodule_key) DO UPDATE
                SET label = EXCLUDED.label,
                    sort_order = EXCLUDED.sort_order
                """
            ),
            item,
        )

    await session.commit()


async def get_user_permission_overrides(
    session: AsyncSession,
    user_id: int,
) -> Dict[PermissionPair, bool]:
    await ensure_permission_schema(session)
    result = await session.execute(
        text(
            """
            SELECT module_key, submodule_key, allowed
            FROM user_permission_assignment
            WHERE user_id = :user_id
            """
        ),
        {"user_id": user_id},
    )
    return {
        (str(row["module_key"]), str(row["submodule_key"])): bool(row["allowed"])
        for row in result.mappings().all()
    }


async def user_has_any_permission(
    session: AsyncSession,
    user_id: int,
    user_role: str | None,
    required_pairs: Iterable[PermissionPair],
) -> bool:
    requested = {
        (str(module_key or "").strip(), str(submodule_key or "").strip())
        for module_key, submodule_key in required_pairs
        if str(module_key or "").strip() and str(submodule_key or "").strip()
    }
    if not requested:
        return False

    effective = build_effective_permission_map(
        user_role,
        await get_user_permission_overrides(session, user_id),
    )
    return any(bool(effective.get(pair)) for pair in requested)


async def replace_user_permissions(session: AsyncSession, user_id: int, allowed_pairs: Iterable[PermissionPair]) -> None:
    await ensure_permission_schema(session)
    await session.execute(
        text("DELETE FROM user_permission_assignment WHERE user_id = :user_id"),
        {"user_id": user_id},
    )

    rows = [
        {
            "user_id": user_id,
            "module_key": module_key,
            "submodule_key": submodule_key,
        }
        for module_key, submodule_key in set(allowed_pairs)
    ]

    for row in rows:
        await session.execute(
            text(
                """
                INSERT INTO user_permission_assignment (user_id, module_key, submodule_key, allowed, updated_at)
                VALUES (:user_id, :module_key, :submodule_key, TRUE, now())
                ON CONFLICT (user_id, module_key, submodule_key) DO UPDATE
                SET allowed = TRUE,
                    updated_at = now()
                """
            ),
            row,
        )

    await session.commit()
