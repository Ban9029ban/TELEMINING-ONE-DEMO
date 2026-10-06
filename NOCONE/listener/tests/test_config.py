from app.config import Settings

def test_listener_default_settings():
    settings = Settings()
    assert settings.http_port == 8090
    assert settings.tcp_port == 7070
    assert settings.backend_base_url

def test_listener_custom_settings_via_dataclass():
    settings = Settings(http_port=18080, tcp_port=17070, backend_base_url="http://backend:9999")
    assert settings.http_port == 18080
    assert settings.tcp_port == 17070
    assert settings.backend_base_url == "http://backend:9999"
