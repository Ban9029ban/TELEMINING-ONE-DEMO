import time

from app.db.base import Base
from app.db.session import SessionLocal, engine

from app.models.organization import Organization
from app.models.site import Site
from app.models.site_map import SiteMap
from app.models.map_object import MapObject
from app.models.module_tmone_real import ModuleAIConsultLog, ModuleAIFaq, ModuleProductivityEvent, ModuleZoneDet
from app.models.screen import Screen
from app.models.alert import AlertEvent
from app.models.remote_source import RemoteSource
from app.models.remote_endpoint import RemoteEndpoint
from app.models.polling_run import PollingRun
from app.models.screen_heartbeat import ScreenHeartbeat
from app.models.user import AppUser
from app.models.visual_layout import VisualSession, VisualLayout
from app.models.sismico_runtime import (
    ControlAuditLog,
    ControlAuditLogDetail,
    ControlEmergencyMatrix,
    ControlPolygon,
    ControlPolygonPlc,
    ControlResetMatrix,
    ControlStateMatrix,
    ObjectCurrentState,
    ObjectStateEvent,
    SemaforoActionLog,
    SemaforoDevice,
    SemaforoRule,
    SismicoSyncRun,
)
from app.db.schema_fixes import apply_runtime_schema_fixes


def init_models():
    last_error = None
    for attempt in range(1, 21):
        try:
            Base.metadata.create_all(bind=engine)
            apply_runtime_schema_fixes(engine)
            try:
                from app.services.sismico_service import SismicoService
                from app.services.semaforo_service import SemaforoService
                db = SessionLocal()
                try:
                    SismicoService(db).ensure_seeded_sites()
                    SemaforoService(db).ensure_default_devices()
                    try:
                        from app.services.control_matrix_service import ControlMatrixService
                        ControlMatrixService(db).ensure_default_configuration()
                    except Exception as control_seed_exc:
                        print(f"[init_models] control matrix seed warning -> {control_seed_exc}")
                    db.commit()
                finally:
                    db.close()
            except Exception as seed_exc:
                print(f"[init_models] semaforo default seed warning -> {seed_exc}")
            print(f"[init_models] DB ready on attempt {attempt}")
            return
        except Exception as e:
            last_error = e
            print(f"[init_models] waiting for DB... {attempt}/20 -> {e}")
            time.sleep(3)
    raise last_error
