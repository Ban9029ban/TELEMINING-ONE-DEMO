from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.settings import settings


class SystemConfigService:
    def __init__(self, db: Session):
        self.db = db

    def _table_exists(self, table_name: str) -> bool:
        value = self.db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :table_name
            )
        """), {"table_name": table_name}).scalar()
        return bool(value)

    def _column_exists(self, table_name: str, column_name: str) -> bool:
        value = self.db.execute(text("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = :table_name
                  AND column_name = :column_name
            )
        """), {"table_name": table_name, "column_name": column_name}).scalar()
        return bool(value)

    def get_feature_flags(self) -> List[Dict[str, Any]]:
        if not self._table_exists('feature_flag'):
            return [
                {'code': 'external_sources', 'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True))},
                {'code': 'semaforo_control', 'enabled': settings.enable_semaforo_control},
                {'code': 'agent_ia', 'enabled': settings.enable_ai_agent},
                {'code': 'screen_monitor', 'enabled': settings.enable_screen_monitor},
                {'code': 'manual_polling', 'enabled': settings.enable_manual_polling},
            ]
        rows = self.db.execute(text('SELECT code, enabled FROM feature_flag ORDER BY code')).mappings().all()
        return [{'code': row['code'], 'enabled': bool(row['enabled'])} for row in rows]

    def _source_status_from_sismico_sync_run(self) -> Optional[Dict[str, Any]]:
        if not self._table_exists('sismico_sync_run'):
            return None
        sync_time_col = 'finished_at' if self._column_exists('sismico_sync_run', 'finished_at') else 'started_at'
        sql = f"""
            SELECT MAX({sync_time_col}) AS last_sync,
                   MAX(CASE WHEN status = 'completed' THEN {sync_time_col} ELSE NULL END) AS last_success,
                   MAX(CASE WHEN status = 'completed' AND source_status = 'online' THEN {sync_time_col} ELSE NULL END) AS last_online_success
            FROM sismico_sync_run
        """
        row = self.db.execute(text(sql)).mappings().first()
        if not row:
            return {'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)), 'online': False, 'reason': 'no sync history', 'lastSyncAt': None, 'lastSuccessAt': None}
        return {
            'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)),
            'online': bool(row['last_online_success'] or row['last_success']),
            'lastSyncAt': row['last_sync'].isoformat() if row['last_sync'] else None,
            'lastSuccessAt': row['last_success'].isoformat() if row['last_success'] else None,
        }

    def _source_status_from_polling_run(self) -> Optional[Dict[str, Any]]:
        if not self._table_exists('polling_run'):
            return None
        sync_time_col = 'finished_at' if self._column_exists('polling_run', 'finished_at') else 'started_at'
        sql = f"""
            SELECT MAX({sync_time_col}) AS last_sync,
                   MAX(CASE WHEN status IN ('completed', 'success') THEN {sync_time_col} ELSE NULL END) AS last_success
            FROM polling_run
        """
        row = self.db.execute(text(sql)).mappings().first()
        if not row:
            return {'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)), 'online': False, 'reason': 'no polling history', 'lastSyncAt': None, 'lastSuccessAt': None}
        return {
            'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)),
            'online': bool(row['last_success']),
            'lastSyncAt': row['last_sync'].isoformat() if row['last_sync'] else None,
            'lastSuccessAt': row['last_success'].isoformat() if row['last_success'] else None,
        }

    def get_source_status_summary(self) -> Dict[str, Any]:
        summary = self._source_status_from_sismico_sync_run()
        if summary is not None:
            return summary
        summary = self._source_status_from_polling_run()
        if summary is not None:
            return summary
        return {'enabled': getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)), 'online': False, 'reason': 'no runtime source tables found', 'lastSyncAt': None, 'lastSuccessAt': None}

    def get_bool_config(self, key: str, default: bool = False) -> bool:
        if not self._table_exists('system_config'):
            return default
        row = self.db.execute(text('SELECT value_text FROM system_config WHERE key = :key LIMIT 1'), {'key': key}).mappings().first()
        if not row or row['value_text'] is None:
            return default
        return str(row['value_text']).strip().lower() in {'1', 'true', 'yes', 'on', 'si'}

    def get_public_runtime_config(self) -> Dict[str, Any]:
        data = dict(settings.public_runtime_config)
        data['featureFlags'] = self.get_feature_flags()
        source_status_summary = self.get_source_status_summary()
        external_sources_enabled = self.get_bool_config(
            'external_sources_enabled',
            default=getattr(settings, 'enable_external_sources', getattr(settings, 'ENABLE_EXTERNAL_SOURCES', True)),
        )
        source_status_summary['enabled'] = external_sources_enabled
        external_sources_on = bool(external_sources_enabled and source_status_summary.get('online'))
        data['sourceStatusSummary'] = source_status_summary
        data['trafficLightsEnabled'] = self.get_bool_config('traffic_lights_enabled', default=True)
        data['semaforoAutomationEnabled'] = self.get_bool_config('semaforo_automation_enabled', default=self.get_bool_config('semaforo.automation.enabled', default=False))
        data['automaticActivationSeconds'] = self.db.execute(text("SELECT value_text FROM system_config WHERE key = 'automatic_activation_seconds' LIMIT 1")).scalar() if self._table_exists('system_config') else '30'
        data['semaforoDryRun'] = settings.plc_dry_run
        data['externalSourcesEnabled'] = external_sources_enabled
        data['external_sources_enabled'] = external_sources_enabled
        data['externalSourcesOn'] = external_sources_on
        data['external_sources_on'] = external_sources_on
        return data
