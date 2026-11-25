"""Shared pytest test fixtures."""

import uuid
import pytest
from flask import Flask
from flask.testing import FlaskClient
from app import create_app
from app.database.connection import get_db_connection
from app.security import create_access_token


@pytest.fixture
def app() -> Flask:
    """Fixture providing a test-configured Flask application instance."""
    app = create_app("testing")
    yield app


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    """Fixture providing a test client for simulating HTTP requests."""
    return app.test_client()


class _AuthenticatedClient:
    """Wrapper around FlaskClient that injects an authenticated Bearer token."""

    def __init__(self, inner: FlaskClient, token: str) -> None:
        self._inner = inner
        self._auth_header = {"Authorization": f"Bearer {token}"}

    def _merge_headers(self, kwargs: dict) -> dict:
        headers = dict(kwargs.get("headers") or {})
        headers.setdefault("Authorization", self._auth_header["Authorization"])
        kwargs["headers"] = headers
        return kwargs

    def get(self, *args, **kwargs):
        return self._inner.get(*args, **self._merge_headers(kwargs))

    def post(self, *args, **kwargs):
        return self._inner.post(*args, **self._merge_headers(kwargs))

    def put(self, *args, **kwargs):
        return self._inner.put(*args, **self._merge_headers(kwargs))

    def delete(self, *args, **kwargs):
        return self._inner.delete(*args, **self._merge_headers(kwargs))


@pytest.fixture
def auth_client(app: Flask) -> _AuthenticatedClient:
    """Fixture providing a test client authenticated as a temporary MANAGER user."""
    uid = uuid.uuid4().hex[:8]
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Test Manager {uid}",
            f"test_mgr_{uid}@causara.test",
            "hash_pw",
        )
        user_id = int(cur.fetchone()[0])
        cur.execute("SELECT role_id FROM dbo.roles WHERE role_name = 'MANAGER';")
        role_id = int(cur.fetchone()[0])
        cur.execute("INSERT INTO dbo.user_roles (user_id, role_id) VALUES (?, ?);", (user_id, role_id))
        conn.commit()

    with app.app_context():
        token = create_access_token(
            user_id=user_id,
            role="MANAGER",
            email=f"test_mgr_{uid}@causara.test",
            full_name=f"Test Manager {uid}",
        )

    yield _AuthenticatedClient(app.test_client(), token)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.audit_log WHERE actor_user_id = ?;", (user_id,))
        cur.execute("DELETE FROM dbo.user_roles WHERE user_id = ?;", (user_id,))
        cur.execute("DELETE FROM dbo.users WHERE user_id = ?;", (user_id,))
        conn.commit()


@pytest.fixture
def runner(app: Flask):
    """Fixture providing a CLI runner."""
    return app.test_cli_runner()
