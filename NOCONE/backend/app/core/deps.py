# app/core/deps.py
from fastapi.security import OAuth2PasswordBearer
from app.core.config import settings

# asegúrate de usar el nombre correcto de la variable (API_PREFIX)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_PREFIX}/auth/token")
