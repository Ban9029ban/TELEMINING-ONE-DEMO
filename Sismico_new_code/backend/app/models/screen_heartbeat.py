from sqlalchemy import Column, BigInteger, String, DateTime, ForeignKey, Text, func
from app.db.base import Base

class ScreenHeartbeat(Base):
    __tablename__ = "screen_heartbeat"
    id = Column(BigInteger, primary_key=True)
    screen_id = Column(BigInteger, ForeignKey("screen.id"), nullable=False)
    browser_session_id = Column(String(120))
    current_url = Column(Text)
    status_code = Column(String(30), nullable=False, default="online")
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
