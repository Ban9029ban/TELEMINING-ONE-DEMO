from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.legacy.telemining.database import Base
from app.legacy.users.utils import verify_password, hash_password  # Importar desde utils.py

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    first_name = Column(String(100))
    last_name = Column(String(100))
    phone_number = Column(String(20))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), server_default=func.now())
    deleted_at = Column(DateTime(timezone=True))

    roles = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")

    def verify_password(self, password: str) -> bool:
        """
        Verifica si la contraseña proporcionada coincide con la almacenada.
        """
        return verify_password(password, self.hashed_password)

    def hash_password(self, password: str):
        """
        Genera un hash para la contraseña y lo almacena en el modelo.
        """
        self.hashed_password = hash_password(password)


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)
    description = Column(String, nullable=True)

    users = relationship("UserRole", back_populates="role", cascade="all, delete-orphan")


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="roles")
    role = relationship("Role", back_populates="users")