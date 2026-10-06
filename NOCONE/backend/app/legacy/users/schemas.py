from pydantic import BaseModel, EmailStr
from typing import Optional, List

class UserBase(BaseModel):
    email: EmailStr
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    email: EmailStr
    username: str
    first_name: Optional[str]
    last_name: Optional[str]

    class Config:
        orm_mode = True

class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None

class RoleResponse(BaseModel):
    id: int
    name: str
    description: Optional[str] = None

    class Config:
        orm_mode = True

class UserRoleCreate(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    role_id: Optional[int] = None
    role_name: Optional[str] = None

    class Config:
        orm_mode = True

class UserResponseMe(BaseModel):
    user: str
    user_id: int
    roles: List[RoleResponse]