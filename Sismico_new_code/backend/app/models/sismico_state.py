from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, JSON, func
from app.db.base import Base


class ObjectCurrentState(Base):
    __tablename__ = "object_current_state"

    id = Column(BigInteger, primary_key=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False, unique=True)
    state_code = Column(String(40), nullable=False, default="unknown")
    raw_value = Column(String(80), nullable=True)
    source_name = Column(String(120), nullable=True)
    observed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ObjectStateEvent(Base):
    __tablename__ = "object_state_event"

    id = Column(BigInteger, primary_key=True)
    map_object_id = Column(BigInteger, ForeignKey("map_object.id"), nullable=False)
    state_code = Column(String(40), nullable=False)
    raw_value = Column(String(80), nullable=True)
    source_name = Column(String(120), nullable=True)
    observed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    metadata_json = Column("metadata", JSON, nullable=False, default={})


class SismicoSyncRun(Base):
    __tablename__ = "sismico_sync_run"

    id = Column(BigInteger, primary_key=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    site_code = Column(String(80), nullable=False)
    status = Column(String(20), nullable=False, default="completed")
    source_status = Column(String(20), nullable=False, default="online")
    trigger_type = Column(String(20), nullable=False, default="manual")
    processed_objects = Column(BigInteger, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
