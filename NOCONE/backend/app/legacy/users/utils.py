from passlib.context import CryptContext

# Configuración básica para hashing de contraseñas
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifica si una contraseña en texto plano coincide con una contraseña hash.
    """
    return pwd_context.verify(plain_password, hashed_password)

def hash_password(password: str) -> str:
    """
    Genera un hash seguro para una contraseña en texto plano.
    """
    return pwd_context.hash(password)