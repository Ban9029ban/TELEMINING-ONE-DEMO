from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.deps import get_db
from app.models.site import Site
from app.models.site_map import SiteMap
from app.models.map_object import MapObject

router = APIRouter()

@router.get("/")
def list_sites(db: Session = Depends(get_db)):
    rows = db.query(Site).order_by(Site.id).all()
    return [{"id": r.id, "code": r.code, "name": r.name} for r in rows]

@router.get("/{site_code}")
def get_site(site_code: str, db: Session = Depends(get_db)):
    site = db.query(Site).filter(Site.code == site_code).first()
    if not site:
        return {"site": None, "maps": [], "objects": []}
    maps = db.query(SiteMap).filter(SiteMap.site_id == site.id).all()
    objects = db.query(MapObject).join(SiteMap, SiteMap.id == MapObject.site_map_id).filter(SiteMap.site_id == site.id).all()
    return {
        "site": {"id": site.id, "code": site.code, "name": site.name},
        "maps": [{"id": m.id, "code": m.code, "name": m.name, "image_url": m.image_url} for m in maps],
        "objects": [{"id": o.id, "code": o.code, "name": o.name, "state_code": o.state_code, "geometry_json": o.geometry_json} for o in objects]
    }
