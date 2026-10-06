from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.alerts import router as alerts_router
from app.api.routes.agent import router as agent_router
from app.api.routes.config_admin import router as config_admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.visual_layout import router as visual_layout_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.external_capture import router as external_capture_router
from app.api.routes.legacy_sismico import router as legacy_sismico_router
from app.api.routes.module_agents import router as module_agents_router
from app.api.routes.module_productivity import router as module_productivity_router
from app.api.routes.module_tmone_real import router as module_tmone_real_router
from app.api.routes.module_zones_det import router as module_zones_det_router
from app.api.routes.polling import router as polling_router
from app.api.routes.screens import router as screens_router
from app.api.routes.semaforos import router as semaforos_router
from app.api.routes.sismico import router as sismico_router
from app.api.routes.sismico_operator import router as sismico_operator_router
from app.api.routes.plc_relay import router as plc_relay_router
from app.api.routes.sites import router as sites_router
from app.api.routes.system_config import router as system_config_router
from app.api.routes.ws import router as ws_router
from app.core.config import settings
from app.core.logging_config import configure_logging
from app.db.db import init_models

configure_logging()

app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r'^https?://(localhost|127\.0\.0\.1|devtm\.denial\.cl|stagtm\.denial\.cl|10\.18\.43\.147|10\.18\.43\.171|10\.24\.203\.38)(:\d+)?$',
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

@app.on_event('startup')
def on_startup() -> None:
    init_models()

@app.get('/')
def root():
    return {'app': settings.APP_NAME, 'version': settings.APP_VERSION, 'env': settings.APP_ENV, 'status': 'ok'}

@app.get('/health')
def health():
    return {'status': 'ok', 'env': settings.APP_ENV}


def include_router_with_legacy_alias(router, *, prefix: str, tags: list[str]):
    app.include_router(router, prefix=prefix, tags=tags)
    # Alias defensivo para requests que quedaron como /api/api/... en algunos builds previos.
    app.include_router(router, prefix=f'{settings.API_PREFIX}{prefix}', tags=tags)


include_router_with_legacy_alias(auth_router, prefix=f'{settings.API_PREFIX}/auth', tags=['auth'])
include_router_with_legacy_alias(agent_router, prefix=f'{settings.API_PREFIX}/agent', tags=['agent'])
include_router_with_legacy_alias(alerts_router, prefix=f'{settings.API_PREFIX}/alerts', tags=['alerts'])
include_router_with_legacy_alias(dashboard_router, prefix=f'{settings.API_PREFIX}/dashboard', tags=['dashboard'])
include_router_with_legacy_alias(external_capture_router, prefix=f'{settings.API_PREFIX}/sismico/capture', tags=['external-capture'])
include_router_with_legacy_alias(legacy_sismico_router, prefix=f'{settings.API_PREFIX}/legacy/sismico', tags=['legacy-sismico'])
include_router_with_legacy_alias(module_agents_router, prefix=f'{settings.API_PREFIX}/module-tmone/agents', tags=['module-agents'])
include_router_with_legacy_alias(module_productivity_router, prefix=f'{settings.API_PREFIX}/module-tmone/productivity', tags=['module-productivity'])
include_router_with_legacy_alias(module_tmone_real_router, prefix=f'{settings.API_PREFIX}/module_tmone_real', tags=['module-tmone-real'])
include_router_with_legacy_alias(module_zones_det_router, prefix=f'{settings.API_PREFIX}/module-tmone/zones-det', tags=['module-zones-det'])
include_router_with_legacy_alias(polling_router, prefix=f'{settings.API_PREFIX}/polling', tags=['polling'])
include_router_with_legacy_alias(screens_router, prefix=f'{settings.API_PREFIX}/screens', tags=['screens'])
include_router_with_legacy_alias(semaforos_router, prefix=f'{settings.API_PREFIX}/semaforos', tags=['semaforos'])
include_router_with_legacy_alias(sismico_router, prefix=f'{settings.API_PREFIX}/sismico', tags=['sismico'])
include_router_with_legacy_alias(sismico_operator_router, prefix=f'{settings.API_PREFIX}/sismico/operator', tags=['sismico-operator'])
include_router_with_legacy_alias(plc_relay_router, prefix=f'{settings.API_PREFIX}/sismico/relay', tags=['sismico-relay'])
include_router_with_legacy_alias(sites_router, prefix=f'{settings.API_PREFIX}/sites', tags=['sites'])
include_router_with_legacy_alias(system_config_router, prefix=f'{settings.API_PREFIX}/config', tags=['config-admin'])
include_router_with_legacy_alias(system_config_router, prefix=f'{settings.API_PREFIX}/system-config', tags=['system-config'])
include_router_with_legacy_alias(config_admin_router, prefix=f'{settings.API_PREFIX}/config', tags=['config-admin'])
include_router_with_legacy_alias(ws_router, prefix=f'{settings.API_PREFIX}/ws', tags=['ws'])

include_router_with_legacy_alias(visual_layout_router, prefix=f"{settings.API_PREFIX}/visual-layout", tags=["visual-layout"])
