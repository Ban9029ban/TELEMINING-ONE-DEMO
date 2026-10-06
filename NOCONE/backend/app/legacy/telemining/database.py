from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import find_dotenv, get_key, load_dotenv

from app.legacy.telemining.config import settings

load_dotenv()
DATABASE_URL = get_key(find_dotenv(), "DATABASE_URL")

engine = create_engine(DATABASE_URL,pool_size=30,
    max_overflow=15, pool_recycle = 300,pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()