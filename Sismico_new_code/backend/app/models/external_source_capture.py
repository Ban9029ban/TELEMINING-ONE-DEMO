from sqlalchemy import Column, BigInteger, String, DateTime, Integer, Text, Boolean, JSON, ForeignKey, func
from app.db.base import Base


class ExternalSourceCapture(Base):
    __tablename__ = "external_source_capture"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    batch_id = Column(String(64), nullable=False, index=True)
    site_id = Column(BigInteger, ForeignKey("site.id"), nullable=True)
    remote_source_id = Column(BigInteger, ForeignKey("remote_source.id"), nullable=True)
    remote_endpoint_id = Column(BigInteger, ForeignKey("remote_endpoint.id"), nullable=True)
    site_code = Column(String(80), nullable=True, index=True)
    source_code = Column(String(120), nullable=True, index=True)
    endpoint_code = Column(String(120), nullable=True, index=True)
    endpoint_name = Column(String(180), nullable=True)
    endpoint_url = Column(Text, nullable=False)
    parser_type = Column(String(80), nullable=True)
    endpoint_kind = Column(String(80), nullable=True)
    content_type = Column(String(200), nullable=True)
    http_status = Column(Integer, nullable=True)
    ok = Column(Boolean, nullable=False, default=False)
    is_binary = Column(Boolean, nullable=False, default=False)
    body_text = Column(Text, nullable=True)
    body_base64 = Column(Text, nullable=True)
    body_sha256 = Column(String(64), nullable=True, index=True)
    body_size = Column(Integer, nullable=True)
    request_duration_ms = Column(Integer, nullable=True)
    source_origin = Column(String(40), nullable=False, default="external")
    derived_from_url = Column(Text, nullable=True)
    extra_json = Column(JSON, nullable=False, default={})
    observed_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
