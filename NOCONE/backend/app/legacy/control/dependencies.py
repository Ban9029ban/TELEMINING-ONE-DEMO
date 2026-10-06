from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.legacy.users.auth import oauth2_scheme
from app.legacy.users.auth_jwt import decode_access_token
from app.legacy.users.crud import get_user_roles
from app.legacy.control.models import Controlador
from app.legacy.telemining.database import get_db

def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido o expirado")
    return payload

def admin_required(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user.get("user_id")
    roles = get_user_roles(db, user_id=user_id)
    role_names = [role.name for role in roles]
    if "Admin" not in role_names:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requiere rol de administrador")
    return current_user

def get_topbar_user_data(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    user_id = current_user.get("user_id")
    controlador = db.query(Controlador).filter(Controlador.user_id == user_id).first()
    if not controlador:
        raise HTTPException(status_code=404, detail="Usuario no encontrado en Controlador")
    return {
        "first_name": "Usuario",
        "last_name": "",
        "role": controlador.role
    }
