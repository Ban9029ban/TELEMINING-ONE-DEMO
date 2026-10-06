from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.legacy.users.crud import create_user, get_user, get_users, update_user, delete_user, get_user_by_username, create_role, get_role_by_name, assign_role_to_user
from app.legacy.users.schemas import UserCreate, UserResponse, RoleCreate, RoleResponse, UserRoleCreate
from app.legacy.telemining.database import get_db
from app.legacy.control.dependencies import admin_required

router = APIRouter()

@router.post("/", response_model=UserResponse)
def create_new_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = get_user_by_username(db, username=user.username)
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    return create_user(db, user.dict())

@router.get("/", response_model=list[UserResponse])
def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: dict = Depends(admin_required)):
    users = get_users(db, skip=skip, limit=limit)
    return users

@router.get("/user/{user_id}", response_model=UserResponse)
def read_user(user_id: int, db: Session = Depends(get_db)):
    db_user = get_user(db, user_id=user_id)
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user

@router.put("/user/{user_id}", response_model=UserResponse)
def update_existing_user(user_id: int, user_data: UserCreate, db: Session = Depends(get_db)):
    updated_user = update_user(db, user_id=user_id, update_data=user_data.dict())
    if updated_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return updated_user

@router.delete("/user/{user_id}")
def delete_existing_user(user_id: int, db: Session = Depends(get_db)):
    success = delete_user(db, user_id=user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")
    return {"detail": "User deleted"}

@router.post("/rol", response_model=RoleResponse)
def create_new_role(role: RoleCreate, db: Session = Depends(get_db)):
    """
    Crea un nuevo rol en la base de datos.
    """
    db_role = get_role_by_name(db, name=role.name)
    if db_role:
        raise HTTPException(status_code=400, detail="Role already exists")
    return create_role(db, role.dict())

@router.post("/add/rol", response_model=dict)
def assign_role(role_data: UserRoleCreate, db: Session = Depends(get_db)):
    """
    Asigna un rol a un usuario.
    """
    try:
        result = assign_role_to_user(
            db,
            user_id=role_data.user_id,
            username=role_data.username,
            role_id=role_data.role_id,
            role_name=role_data.role_name
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))