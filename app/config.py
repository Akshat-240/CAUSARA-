"""Causara centralized application configuration."""

import os
from typing import Dict, List, Type


class BaseConfig:
    """Base configuration with shared defaults."""

    SERVICE_NAME: str = "causara-api"
    API_VERSION: str = "1.0.0"
    API_PREFIX: str = "/api/v1"

    SECRET_KEY: str = os.getenv("SECRET_KEY", "causara-dev-secret-key-insecure")
    DEBUG: bool = False
    TESTING: bool = False

    # CORS origins list parsed from comma-separated environment variable
    _cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    CORS_ORIGINS: List[str] = [origin.strip() for origin in _cors_raw.split(",") if origin.strip()]

    JSON_SORT_KEYS: bool = False


class DevelopmentConfig(BaseConfig):
    """Configuration for local development."""

    DEBUG: bool = True
    ENV: str = "development"


class TestingConfig(BaseConfig):
    """Configuration for automated test execution."""

    TESTING: bool = True
    DEBUG: bool = False
    ENV: str = "testing"
    CORS_ORIGINS: List[str] = ["*"]
    SECRET_KEY: str = "test-secret-key-for-automated-suites"


class ProductionConfig(BaseConfig):
    """Configuration for production deployment on Azure App Service."""

    DEBUG: bool = False
    ENV: str = "production"

    def __init__(self) -> None:
        secret = os.getenv("SECRET_KEY")
        if not secret or secret == "causara-dev-secret-key-insecure":
            raise ValueError("SECRET_KEY must be set to a secure value in production environment.")


config_by_name: Dict[str, Type[BaseConfig]] = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}


def get_config(config_name: str | None = None) -> Type[BaseConfig]:
    """Retrieve configuration class by name, falling back to FLASK_ENV or development."""
    if not config_name:
        config_name = os.getenv("FLASK_ENV", "development").lower()
    return config_by_name.get(config_name, DevelopmentConfig)
