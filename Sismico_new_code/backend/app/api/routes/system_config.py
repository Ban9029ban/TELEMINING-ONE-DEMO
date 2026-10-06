from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.services.system_config_service import SystemConfigService

router = APIRouter()


@router.get('/public')
def public_legacy_alias(db: Session = Depends(get_db)):
    return SystemConfigService(db).get_public_runtime_config()


@router.get('/runtime-config/public')
def public_runtime_config(db: Session = Depends(get_db)):
    return SystemConfigService(db).get_public_runtime_config()


@router.get('/runtime')
def runtime_config(db: Session = Depends(get_db)):
    return SystemConfigService(db).get_public_runtime_config()
