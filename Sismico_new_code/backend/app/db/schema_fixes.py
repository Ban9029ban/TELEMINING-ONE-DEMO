from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


SEQUENCE_TABLES = [
    "organization",
    "site",
    "site_map",
    "map_object",
    "remote_source",
    "remote_endpoint",
    "screen",
    "alert_event",
    "polling_run",
    "screen_heartbeat",
    "app_user",
    "sismico_sync_run",
    "object_current_state",
    "object_state_event",
    "semaforo_device",
    "semaforo_rule",
    "semaforo_action_log",
]


SAFE_IDENTIFIER_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")


def _safe_identifier(value: str) -> str:
    lowered = (value or "").strip().lower()
    if not lowered or any(ch not in SAFE_IDENTIFIER_CHARS for ch in lowered):
        raise ValueError(f"Unsafe identifier: {value}")
    return lowered


def _table_exists(conn, table_name: str) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = :table_name
                )
                """
            ),
            {"table_name": table_name},
        ).scalar()
    )


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    return bool(
        conn.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = :table_name
                      AND column_name = :column_name
                )
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        ).scalar()
    )


def _coerce_table_id_to_sequence(conn, table_name: str) -> None:
    table_name = _safe_identifier(table_name)
    if not _table_exists(conn, table_name) or not _column_exists(conn, table_name, "id"):
        return

    seq_name = _safe_identifier(f"{table_name}_id_seq")

    conn.execute(text(f'CREATE SEQUENCE IF NOT EXISTS public."{seq_name}"'))
    conn.execute(
        text(
            f"ALTER TABLE public.\"{table_name}\" "
            f"ALTER COLUMN id SET DEFAULT nextval('public.\"{seq_name}\"'::regclass)"
        )
    )

    max_id = conn.execute(text(f'SELECT MAX(id) FROM public."{table_name}"')).scalar()
    if max_id is None:
        conn.execute(text(f"SELECT setval('public.\"{seq_name}\"'::regclass, 1, false)"))
    else:
        conn.execute(text(f"SELECT setval('public.\"{seq_name}\"'::regclass, {int(max_id)}, true)"))


def _apply_object_current_state_fixes(conn) -> None:
    table_name = "object_current_state"
    if not _table_exists(conn, table_name):
        return

    if not _column_exists(conn, table_name, "site_id"):
        conn.execute(text("ALTER TABLE object_current_state ADD COLUMN site_id BIGINT NULL"))
        if _table_exists(conn, "map_object") and _table_exists(conn, "site_map"):
            conn.execute(
                text(
                    """
                    UPDATE object_current_state ocs
                    SET site_id = sm.site_id
                    FROM map_object mo
                    JOIN site_map sm ON sm.id = mo.site_map_id
                    WHERE mo.id = ocs.map_object_id
                      AND ocs.site_id IS NULL
                    """
                )
            )

    if not _column_exists(conn, table_name, "source_status"):
        conn.execute(
            text(
                "ALTER TABLE object_current_state "
                "ADD COLUMN source_status VARCHAR(20) NOT NULL DEFAULT 'unknown'"
            )
        )

    conn.execute(
        text(
            "UPDATE object_current_state "
            "SET source_status = COALESCE(NULLIF(source_status, ''), 'unknown')"
        )
    )


def _apply_object_state_event_fixes(conn) -> None:
    table_name = "object_state_event"
    if not _table_exists(conn, table_name):
        return

    if not _column_exists(conn, table_name, "site_id"):
        conn.execute(text("ALTER TABLE object_state_event ADD COLUMN site_id BIGINT NULL"))
        if _table_exists(conn, "map_object") and _table_exists(conn, "site_map"):
            conn.execute(
                text(
                    """
                    UPDATE object_state_event ose
                    SET site_id = sm.site_id
                    FROM map_object mo
                    JOIN site_map sm ON sm.id = mo.site_map_id
                    WHERE mo.id = ose.map_object_id
                      AND ose.site_id IS NULL
                    """
                )
            )

    if not _column_exists(conn, table_name, "sync_run_id"):
        conn.execute(text("ALTER TABLE object_state_event ADD COLUMN sync_run_id BIGINT NULL"))

    if not _column_exists(conn, table_name, "created_at"):
        conn.execute(
            text(
                "ALTER TABLE object_state_event "
                "ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            )
        )




def _apply_polygon_ui_fixes(conn) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS polygon_ui_config (
            id BIGSERIAL PRIMARY KEY,
            map_object_id BIGINT NOT NULL UNIQUE REFERENCES map_object(id) ON DELETE CASCADE,
            control_mode VARCHAR(40) NOT NULL DEFAULT 'manual',
            manual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            automatic_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            state_set_code VARCHAR(40) NOT NULL DEFAULT 'binary_alert',
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS polygon_ui_state_option (
            id BIGSERIAL PRIMARY KEY,
            config_id BIGINT NULL REFERENCES polygon_ui_config(id) ON DELETE CASCADE,
            map_object_id BIGINT NULL REFERENCES map_object(id) ON DELETE CASCADE,
            state_code VARCHAR(20) NOT NULL,
            button_label VARCHAR(40) NOT NULL,
            color_hex VARCHAR(20) NULL,
            sort_order INTEGER NOT NULL DEFAULT 1,
            is_visible BOOLEAN NOT NULL DEFAULT TRUE,
            is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    if _column_exists(conn, "polygon_ui_config", "control_mode"):
        conn.execute(text("ALTER TABLE polygon_ui_config ALTER COLUMN control_mode TYPE VARCHAR(40)"))
    if _column_exists(conn, "polygon_ui_config", "state_set_code"):
        conn.execute(text("ALTER TABLE polygon_ui_config ALTER COLUMN state_set_code TYPE VARCHAR(40)"))
    if not _column_exists(conn, "polygon_ui_config", "updated_at"):
        conn.execute(text("ALTER TABLE polygon_ui_config ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"))

    if not _column_exists(conn, "polygon_ui_state_option", "map_object_id"):
        conn.execute(text("ALTER TABLE polygon_ui_state_option ADD COLUMN map_object_id BIGINT NULL"))
    if not _column_exists(conn, "polygon_ui_state_option", "config_id"):
        conn.execute(text("ALTER TABLE polygon_ui_state_option ADD COLUMN config_id BIGINT NULL"))
    if _column_exists(conn, "polygon_ui_state_option", "button_label"):
        conn.execute(text("ALTER TABLE polygon_ui_state_option ALTER COLUMN button_label TYPE VARCHAR(40)"))
    if _column_exists(conn, "polygon_ui_state_option", "color_hex"):
        conn.execute(text("ALTER TABLE polygon_ui_state_option ALTER COLUMN color_hex TYPE VARCHAR(20)"))

    conn.execute(text("""
        UPDATE polygon_ui_state_option pso
        SET map_object_id = cfg.map_object_id
        FROM polygon_ui_config cfg
        WHERE pso.map_object_id IS NULL
          AND pso.config_id IS NOT NULL
          AND cfg.id = pso.config_id
    """))

    conn.execute(text("""
        UPDATE polygon_ui_state_option pso
        SET config_id = cfg.id
        FROM polygon_ui_config cfg
        WHERE pso.config_id IS NULL
          AND pso.map_object_id IS NOT NULL
          AND cfg.map_object_id = pso.map_object_id
    """))




def _apply_screen_fixes(conn) -> None:
    if not _table_exists(conn, "screen"):
        return

    additions = [
        ("client_ip", "VARCHAR(80) NULL"),
        ("mac_address", "VARCHAR(80) NULL"),
        ("authorized_mac", "VARCHAR(80) NULL"),
        ("device_label", "VARCHAR(150) NULL"),
        ("device_name", "VARCHAR(150) NULL"),
        ("device_fingerprint", "TEXT NULL"),
        ("user_agent", "TEXT NULL"),
        ("notes", "TEXT NULL"),
        ("enforce_mac_lock", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("license_plan", "VARCHAR(30) NOT NULL DEFAULT 'unlimited'"),
        ("license_status", "VARCHAR(30) NOT NULL DEFAULT 'licensed'"),
        ("license_expires_at", "TIMESTAMPTZ NULL"),
        ("license_days", "INTEGER NULL"),
    ]
    for col, ddl in additions:
        if not _column_exists(conn, "screen", col):
            conn.execute(text(f"ALTER TABLE screen ADD COLUMN {col} {ddl}"))

    conn.execute(text("UPDATE screen SET license_plan = COALESCE(NULLIF(license_plan, ''), 'unlimited')"))
    conn.execute(text("UPDATE screen SET license_status = COALESCE(NULLIF(license_status, ''), 'licensed')"))
    conn.execute(text("UPDATE screen SET license_days = 0 WHERE license_plan = 'daily' AND license_days IS NULL"))
    conn.execute(text("UPDATE screen SET enforce_mac_lock = FALSE WHERE enforce_mac_lock IS NULL"))



def _apply_semaforo_action_log_fixes(conn) -> None:
    if not _table_exists(conn, "semaforo_action_log"):
        return

    if not _column_exists(conn, "semaforo_action_log", "site_code"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN site_code VARCHAR(100) NULL"))
    if not _column_exists(conn, "semaforo_action_log", "map_code"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN map_code VARCHAR(100) NULL"))
    if not _column_exists(conn, "semaforo_action_log", "polygon_code"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN polygon_code VARCHAR(100) NULL"))
    if not _column_exists(conn, "semaforo_action_log", "dry_run"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN dry_run BOOLEAN NOT NULL DEFAULT FALSE"))
    if not _column_exists(conn, "semaforo_action_log", "reason"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN reason VARCHAR(120) NULL"))
    if not _column_exists(conn, "semaforo_action_log", "payload_json"):
        conn.execute(text("ALTER TABLE semaforo_action_log ADD COLUMN payload_json JSONB NULL DEFAULT '{}'::jsonb"))

    if _column_exists(conn, "semaforo_action_log", "site_id") and _column_exists(conn, "semaforo_action_log", "site_code") and _table_exists(conn, "site"):
        conn.execute(text("""
            UPDATE semaforo_action_log sal
            SET site_code = s.code
            FROM site s
            WHERE sal.site_id = s.id
              AND (sal.site_code IS NULL OR sal.site_code = '')
        """))


def _apply_system_config_fixes(conn) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS system_config (
            id BIGSERIAL PRIMARY KEY,
            key VARCHAR(120) NOT NULL UNIQUE,
            value_text TEXT NULL,
            scope VARCHAR(40) NOT NULL DEFAULT 'global',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))


def apply_runtime_schema_fixes(engine: Engine) -> None:
    with engine.begin() as conn:
        _apply_object_current_state_fixes(conn)
        from app.services.polygon_control_mode import SCHEMA
        conn.execute(text(SCHEMA))
        conn.execute(text("INSERT INTO polygon_control_mode(map_object_id,mode) SELECT map_object_id,'manual' FROM object_current_state WHERE source_status='manual' ON CONFLICT DO NOTHING"))
        _apply_object_state_event_fixes(conn)
        _apply_polygon_ui_fixes(conn)
        _apply_screen_fixes(conn)
        _apply_semaforo_action_log_fixes(conn)
        _apply_system_config_fixes(conn)

        for table_name in SEQUENCE_TABLES:
            _coerce_table_id_to_sequence(conn, table_name)
