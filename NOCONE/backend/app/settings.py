
from pydantic_settings import BaseSettings
from pydantic import Field
class Settings(BaseSettings):
    app_host: str = Field(default='0.0.0.0', alias='APP_HOST')
    app_port: int = Field(default=8000, alias='APP_PORT')
    pg_host: str = Field(default='db', alias='PGHOST')
    pg_port: int = Field(default=5432, alias='PGPORT')
    pg_db: str = Field(default='zenit', alias='PGDATABASE')
    pg_user: str = Field(default='zenit', alias='PGUSER')
    pg_password: str = Field(default='zenitpass', alias='PGPASSWORD')
    @property
    def dsn(self): return f'postgresql+asyncpg://{self.pg_user}:{self.pg_password}@{self.pg_host}:{self.pg_port}/{self.pg_db}'
settings = Settings(_env_file='.env', _env_file_encoding='utf-8')
