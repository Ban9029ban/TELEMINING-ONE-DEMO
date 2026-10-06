from sqlalchemy.orm import Session
from app.legacy.users.models import User, Role, UserRole
from app.legacy.users.auth_jwt import hash_password  # Importa la función hash_password

def get_user(db: Session, user_id: int):
    return db.query(User).filter(User.id == user_id).first()

def get_user_by_username(db: Session, username: str):
    return db.query(User).filter(User.username == username).first()

def get_users(db: Session, skip: int = 0, limit: int = 100):
    return db.query(User).offset(skip).limit(limit).all()

def create_user(db: Session, user_data: dict):
    hashed_password = hash_password(user_data["password"])
    db_user = User(
        email=user_data["email"],
        username=user_data["username"],
        hashed_password=hashed_password,
        first_name=user_data.get("first_name"),
        last_name=user_data.get("last_name"),
        phone_number=user_data.get("phone_number")
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

def update_user(db: Session, user_id: int, update_data: dict):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    for key, value in update_data.items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user

def delete_user(db: Session, user_id: int):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    db.delete(user)
    db.commit()
    return True

def create_role(db: Session, role_data: dict):
    """
    Crea un nuevo rol en la base de datos.
    """
    db_role = Role(**role_data)
    db.add(db_role)
    db.commit()
    db.refresh(db_role)
    return db_role


def assign_role_to_user(db: Session, user_id: int = None, username: str = None, role_id: int = None, role_name: str = None):
    """
    Asigna un rol a un usuario.
    """
    # Buscar el usuario
    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
    elif username:
        user = db.query(User).filter(User.username == username).first()
    else:
        raise ValueError("Debe proporcionar user_id o username")

    if not user:
        raise ValueError("Usuario no encontrado")

    # Buscar el rol
    if role_id:
        role = db.query(Role).filter(Role.id == role_id).first()
    elif role_name:
        role = db.query(Role).filter(Role.name == role_name).first()
    else:
        raise ValueError("Debe proporcionar role_id o role_name")

    if not role:
        raise ValueError("Rol no encontrado")

    # Verificar si la relación ya existe
    existing_relation = db.query(UserRole).filter(
        UserRole.user_id == user.id,
        UserRole.role_id == role.id
    ).first()

    if existing_relation:
        raise ValueError("El usuario ya tiene este rol asignado")

    # Crear la relación
    user_role = UserRole(user_id=user.id, role_id=role.id)
    db.add(user_role)
    db.commit()
    db.refresh(user_role)

    return {"detail": f"Rol '{role.name}' asignado al usuario '{user.username}'"}


def get_user_roles(db: Session, user_id: int):
    """
    Obtiene los roles asignados a un usuario.
    """
    roles = (
        db.query(Role)
        .join(UserRole, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user_id)
        .all()
    )
    return roles


def get_role_by_name(db: Session, name: str):
    """
    Busca un rol por su nombre en la base de datos.
    """
    return db.query(Role).filter(Role.name == name).first()