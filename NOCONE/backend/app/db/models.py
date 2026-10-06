# app/db/models.py
from datetime import date, datetime

from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Integer, Boolean, Float, Date, DateTime, text

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(50), server_default=text("'user'"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    license_expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=False),
        nullable=False,
        server_default=text("now()"),
    )

class MapPoint(Base):
    __tablename__ = "map_points"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    site_code: Mapped[str] = mapped_column(String(16), index=True)  # NP/UCL/NTI
    name: Mapped[str] = mapped_column(String(120))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    point_type: Mapped[str] = mapped_column(String(32), default="NODE")
    zone: Mapped[str] = mapped_column(String(64), default="")
