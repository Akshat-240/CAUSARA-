"""Health check endpoint for container probes and platform monitoring."""

from flask import Blueprint, current_app
from app.api.errors import format_success_response
from app.database.connection import check_db_connectivity

health_bp = Blueprint("health", __name__)


@health_bp.route("/health", methods=["GET"])
def health_check():
    """Liveness, configuration, and database connectivity health probe."""
    db_connected, _ = check_db_connectivity()
    is_healthy = db_connected or current_app.config.get("TESTING", False)

    health_data = {
        "status": "healthy" if is_healthy else "degraded",
        "service": current_app.config.get("SERVICE_NAME", "causara-api"),
        "version": current_app.config.get("API_VERSION", "1.0.0"),
        "environment": current_app.config.get("ENV", "development"),
        "database": "connected" if db_connected else "disconnected",
    }
    status_code = 200 if is_healthy else 503
    return format_success_response(data=health_data, status_code=status_code)
