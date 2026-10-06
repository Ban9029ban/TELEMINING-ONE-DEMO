from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

from app.core.config import settings


BASE_SQL_FILES = (
    "00_init.sql",
    "01_indexes_views.sql",
    "02_extra_models_seed.sql",
    "03_person_extra.sql",
    "04_app_setting.sql",
    "camera_video.sql",
)

PROFILE_SQL_FILES: dict[str, tuple[str, ...]] = {
    "schema_only": BASE_SQL_FILES,
    "pilot_min": BASE_SQL_FILES
    + (
        "zenit_piloto_produccion.sql",
        "fix_demo_encoding.sql",
        "99_fix_fleet_activity_seed.sql",
        "99_fix_fleet_full_distribution.sql",
    ),
    "demo_full": BASE_SQL_FILES
    + (
        "zenit_demo_1_dia_todos.sql",
        "zenit_demo_3_meses.sql",
        "fix_demo_encoding.sql",
        "99_fix_fleet_activity_seed.sql",
        "99_fix_fleet_full_distribution.sql",
    ),
}

BOOTSTRAP_MARKER_KEY = "system_db_bootstrap_profile"
BOOTSTRAP_MARKER_CATEGORY = "system"
BOOTSTRAP_MARKER_DESCRIPTION = "Perfil aplicado automaticamente al arrancar Docker."


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _load_sql_file(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


async def _ensure_bootstrap_table(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_setting (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            category TEXT NOT NULL DEFAULT 'general',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_app_setting_category ON app_setting(category)"
    )


async def _get_current_marker(conn: asyncpg.Connection) -> str | None:
    try:
        await _ensure_bootstrap_table(conn)
        return await conn.fetchval(
            "SELECT value FROM app_setting WHERE key = $1",
            BOOTSTRAP_MARKER_KEY,
        )
    except Exception:
        return None


async def _store_marker(conn: asyncpg.Connection, marker_value: str) -> None:
    await _ensure_bootstrap_table(conn)
    await conn.execute(
        """
        INSERT INTO app_setting (key, value, description, category)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = EXCLUDED.description,
            category = EXCLUDED.category,
            updated_at = NOW()
        """,
        BOOTSTRAP_MARKER_KEY,
        marker_value,
        BOOTSTRAP_MARKER_DESCRIPTION,
        BOOTSTRAP_MARKER_CATEGORY,
    )


async def _apply_sql_profile(profile: str, profile_version: str, bootstrap_dir: Path, force: bool) -> None:
    files = PROFILE_SQL_FILES.get(profile)
    if not files:
        valid_profiles = ", ".join(sorted(PROFILE_SQL_FILES))
        raise RuntimeError(f"Perfil de bootstrap desconocido: {profile}. Opciones: {valid_profiles}")

    db_url = settings.SQLALCHEMY_SYNC_URI
    marker_value = f"{profile}:{profile_version}"

    if not bootstrap_dir.exists():
        raise RuntimeError(f"No existe el directorio de SQL bootstrap: {bootstrap_dir}")

    conn = await asyncpg.connect(
        dsn=db_url,
        timeout=30,
        command_timeout=3600,
        ssl=False,
    )
    try:
        current_marker = await _get_current_marker(conn)
        if current_marker == marker_value and not force:
            print(f"[bootstrap] perfil ya aplicado: {marker_value}")
            return

        print(f"[bootstrap] ejecutando perfil={profile} version={profile_version} force={force}")
        for file_name in files:
            sql_path = bootstrap_dir / file_name
            if not sql_path.exists():
                raise RuntimeError(f"No existe el archivo SQL requerido: {sql_path}")
            print(f"[bootstrap] aplicando {file_name}")
            sql_text = _load_sql_file(sql_path)
            await conn.execute(sql_text)

        await _store_marker(conn, marker_value)
        print(f"[bootstrap] perfil aplicado: {marker_value}")
    finally:
        await conn.close()


async def main() -> None:
    enabled = _env_bool("TMONE_DB_BOOTSTRAP_ENABLED", True)
    profile = (os.getenv("TMONE_DB_BOOTSTRAP_PROFILE") or "").strip().lower()
    profile_version = (os.getenv("TMONE_DB_BOOTSTRAP_VERSION") or "v1").strip()
    force = _env_bool("TMONE_DB_BOOTSTRAP_FORCE", False)
    bootstrap_dir = Path(os.getenv("TMONE_DB_BOOTSTRAP_DIR", "/app/db_seed")).resolve()

    if not enabled:
        print("[bootstrap] deshabilitado por TMONE_DB_BOOTSTRAP_ENABLED=false")
        return

    if not profile:
        print("[bootstrap] sin perfil configurado; se omite bootstrap")
        return

    await _apply_sql_profile(profile, profile_version, bootstrap_dir, force)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:  # pragma: no cover - fail fast on startup
        print(f"[bootstrap][error] {exc}", file=sys.stderr)
        raise
