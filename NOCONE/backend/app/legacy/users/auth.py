from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.legacy.users.auth_jwt import authenticate_user, create_access_token, decode_access_token
from app.legacy.telemining.database import get_db  # Importar la dependencia de la base de datos desde telemining
from app.legacy.users.models import User  # Importar el modelo User desde users.models
from app.legacy.users.schemas import UserResponseMe
from app.legacy.users.crud import get_user_roles  # Importar la función para obtener roles de usuario

router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

@router.post("/token/")
async def login_api(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Endpoint para autenticar un usuario y generar un token JWT.
    """
    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Crear un token JWT con los datos del usuario
    token = create_access_token({"sub": user.username, "user_id": user.id})
    return {"access_token": token, "token_type": "bearer"}

@router.get("/me/", response_model=UserResponseMe)
async def read_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """
    Endpoint para obtener los datos del usuario actual basado en el token JWT.
    """
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    # Obtener el ID del usuario desde el payload del token
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    
    # Consultar el usuario en la base de datos
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Obtener los roles asignados al usuario
    roles = get_user_roles(db, user_id=user.id)
    
    # Devolver los datos del usuario y sus roles
    return {
        "user": user.username,
        "user_id": user.id,
        "roles": roles
    }