from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from .core import settings

# Ensure UTF-8 encoding for database connections
database_url = settings.SQLALCHEMY_DATABASE_URI
if database_url:
    parsed = urlparse(database_url)
    query = dict(parse_qsl(parsed.query or ""))

    if parsed.scheme.startswith(("postgresql", "postgres", "cockroach")):
        query.setdefault("client_encoding", "utf8")
    elif parsed.scheme.startswith(("mysql", "mariadb")):
        query.setdefault("charset", "utf8")

    if query:
        database_url = urlunparse(parsed._replace(query=urlencode(query)))

engine = create_async_engine(database_url, pool_pre_ping=True)
AsyncSessionLocal = sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

async def get_session():
    async with AsyncSessionLocal() as s:
        yield s
