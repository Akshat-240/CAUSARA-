"""Health check endpoint for container probes and platform monitoring."""

from flask import Blueprint, current_app
from app.api.errors import format_success_response

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Liveness and service configuration health probe."""
    health_data = {
        "status": "healthy",
        "service": current_app.config.get("SERVICE_NAME", "causara-api"),
        "version": current_app.config.get("API_VERSION", "1.0.0"),
        "environment": current_app.config.get("ENV", "development"),
    }
    return format_success_response(data=health_data, status_code=200)
