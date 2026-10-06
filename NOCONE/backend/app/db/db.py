# app/db/db.py
from typing import AsyncGenerator
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings
from app.db.models import Base

database_url = settings.SQLALCHEMY_DATABASE_URI
if database_url:
    parsed = urlparse(database_url)
    query = dict(parse_qsl(parsed.query or ""))

    if parsed.scheme.startswith(("postgresql", "postgres", "cockroach")):
        # asyncpg does not accept client_encoding as a keyword argument.
        # Keep UTF-8 settings only for non-async engines or via explicit DSN settings.
        if "+asyncpg" not in parsed.scheme:
            query.setdefault("client_encoding", "utf8")
    elif parsed.scheme.startswith(("mysql", "mariadb")):
        query.setdefault("charset", "utf8")

    if query:
        database_url = urlunparse(parsed._replace(query=urlencode(query)))

engine = create_async_engine(database_url, echo=False, future=True)
async_session = async_sessionmaker(engine, expire_on_commit=False)
SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, class_=AsyncSession)

async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session

async def init_models():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session
