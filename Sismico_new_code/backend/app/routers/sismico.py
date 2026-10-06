from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.db import get_db

router = APIRouter(prefix="/sismico", tags=["sismico"])

@router.get("/overview")
async def sismico_overview(db: AsyncSession = Depends(get_db)):
    q = text("""
        select s.code, s.name, s.project_label, s.logo_path, s.status_code,
               coalesce((select count(*) from sismico_alert a where a.site_code=s.code and a.status='open'),0) as open_alerts
        from sismico_site s
        where s.is_active = true
        order by s.display_order, s.name
    """)
    rows = (await db.execute(q)).mappings().all()
    return rows

@router.get("/sites/{site_code}")
async def sismico_site(site_code: str, db: AsyncSession = Depends(get_db)):
    site_q = text("""
        select code, name, project_label, logo_path, map_image_path, status_code,
               emergency_active, last_record_at, shell_variant
        from sismico_site
        where code = :code and is_active = true
    """)
    site = (await db.execute(site_q, {"code": site_code})).mappings().first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    objs_q = text("""
        select id, site_code, group_name, code, label, state_mode, state_code,
               secondary_state, display_order, geometry_json
        from sismico_object
        where site_code = :code and is_active = true
        order by group_name, display_order, label
    """)
    objects = (await db.execute(objs_q, {"code": site_code})).mappings().all()

    alerts_q = text("""
        select id, title, message, severity, status, created_at
        from sismico_alert
        where site_code = :code
        order by id desc
        limit 20
    """)
    alerts = (await db.execute(alerts_q, {"code": site_code})).mappings().all()

    screens_q = text("""
        select id, code, name, status_code, current_url, last_heartbeat_at
        from sismico_screen
        where site_code = :code
        order by id
    """)
    screens = (await db.execute(screens_q, {"code": site_code})).mappings().all()

    return {
        "site": dict(site),
        "objects": [dict(r) for r in objects],
        "alerts": [dict(r) for r in alerts],
        "screens": [dict(r) for r in screens],
    }
