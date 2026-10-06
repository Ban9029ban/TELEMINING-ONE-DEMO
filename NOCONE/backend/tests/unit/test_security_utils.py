from app.core.security import create_access_token


def test_create_access_token_returns_string():
    token = create_access_token(subject="qa-user")
    assert isinstance(token, str)
    assert token.count(".") == 2
