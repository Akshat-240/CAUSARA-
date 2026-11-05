"""Tests verifying application factory behavior and environment configuration."""

from app import create_app


def test_app_creation_testing_mode(app):
    """Verify application factory creates an app in testing mode."""
    assert app is not None
    assert app.config["TESTING"] is True
    assert app.config["DEBUG"] is False
    assert app.config["ENV"] == "testing"


def test_app_creation_development_mode():
    """Verify application factory creates an app in development mode."""
    dev_app = create_app("development")
    assert dev_app.config["TESTING"] is False
    assert dev_app.config["DEBUG"] is True
    assert dev_app.config["ENV"] == "development"


def test_root_index_endpoint(client):
    """Verify service root endpoint provides service discovery metadata."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.get_json()
    assert data["service"] == "causara-api"
    assert data["status"] == "running"
    assert "health_check" in data
