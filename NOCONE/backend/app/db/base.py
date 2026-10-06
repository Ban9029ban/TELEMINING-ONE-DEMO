# backend/app/db/base.py
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    """Base declarativa única para todos los modelos."""
    pass