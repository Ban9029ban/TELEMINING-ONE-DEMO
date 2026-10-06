import jwt
from app.core.config import settings
from app.core.security import create_access_token, decode_token, get_password_hash, verify_password

def test_password_hash_roundtrip():
    hashed = get_password_hash("secret-demo")
    assert hashed != "secret-demo"
    assert verify_password("secret-demo", hashed) is True
    assert verify_password("wrong", hashed) is False

def test_token_roundtrip_contains_subject():
    token = create_access_token("qa-user", minutes=5)
    payload = decode_token(token)
    assert payload["sub"] == "qa-user"

def test_token_uses_configured_algorithm():
    token = create_access_token("qa-user", minutes=5)
    header = jwt.get_unverified_header(token)
    assert header["alg"] == settings.algorithm
