from app.core.config import Settings

def test_default_dev_db_uri_uses_container_host():
    settings = Settings()
    assert settings.SQLALCHEMY_DATABASE_URI.startswith("postgresql+")
    assert "@zenit-db:5432/" in settings.SQLALCHEMY_DATABASE_URI
    assert "10500" not in settings.SQLALCHEMY_DATABASE_URI

def test_production_db_uri_uses_prod_values():
    settings = Settings(app_env="produccion", prod_db_host="db.prod.local", prod_db_name="zenit_prod")
    assert "db.prod.local" in settings.SQLALCHEMY_DATABASE_URI
    assert "zenit_prod" in settings.SQLALCHEMY_DATABASE_URI
    assert "@host.docker.internal:" not in settings.SQLALCHEMY_DATABASE_URI
