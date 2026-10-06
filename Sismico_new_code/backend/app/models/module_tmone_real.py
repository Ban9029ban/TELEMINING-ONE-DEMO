from sqlalchemy import Column, BigInteger, String, Text, Integer, Numeric, Date
from app.db.base import Base

class ModuleAIFaq(Base):
    __tablename__ = "module_ai_faq"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)

class ModuleAIConsultLog(Base):
    __tablename__ = "module_ai_consult_log"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)

class ModuleProductivityEvent(Base):
    __tablename__ = "module_productivity_event"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    sector_name = Column(String(120), nullable=False)
    event_count = Column(Integer, nullable=False)
    energy_value = Column(Numeric(12,2), nullable=False)
    event_date = Column(Date, nullable=False)

class ModuleZoneDet(Base):
    __tablename__ = "module_zones_det"
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    zone_name = Column(String(120), nullable=False)
    zone_key = Column(String(60), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
