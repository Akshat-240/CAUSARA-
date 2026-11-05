"""Shared pytest test fixtures."""

import pytest
from flask import Flask
from flask.testing import FlaskClient
from app import create_app


@pytest.fixture
def app() -> Flask:
    """Fixture providing a test-configured Flask application instance."""
    app = create_app("testing")
    yield app


@pytest.fixture
def client(app: Flask) -> FlaskClient:
    """Fixture providing a test client for simulating HTTP requests."""
    return app.test_client()


@pytest.fixture
def runner(app: Flask):
    """Fixture providing a CLI runner."""
    return app.test_cli_runner()
