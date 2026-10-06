from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.screen_tracking_service import register_screen

router = APIRouter(prefix="/api/screen", tags=["screen"])

@router.get("/register")
def register(request: Request, pantalla: int, plano: str, db: Session = Depends(get_db)):
    ip = request.client.host
    return register_screen(db, pantalla, ip, plano)
