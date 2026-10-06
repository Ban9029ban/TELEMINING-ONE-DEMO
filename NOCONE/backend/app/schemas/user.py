# backend/app/schemas/user.py
from datetime import date

from pydantic import BaseModel, Field

class UserBase(BaseModel):
    username: str = Field(..., min_length=1)
    full_name: str | None = ""
    role: str | None = "user"
    is_active: bool | None = True
    license_expires_on: date | None = None
    license_interval_days: int | None = None

class UserCreate(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    full_name: str | None = ""
    role: str | None = "user"
    is_active: bool | None = True
    license_expires_on: date | None = None
    license_interval_days: int | None = None

class UserUpdate(BaseModel):
    # Todos opcionales para PATCH/PUT
    username: str | None = None
    password: str | None = None
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    license_expires_on: date | None = None
    license_interval_days: int | None = None

class UserRead(BaseModel):
    id: int
    username: str
    full_name: str | None = ""
    role: str | None = None
    is_active: bool
    license_expires_on: date | None = None
    license_is_expired: bool = False
    license_days_remaining: int | None = None
    access_enabled: bool = False
    access_status: str = "inactive"

    class Config:
        from_attributes = True
