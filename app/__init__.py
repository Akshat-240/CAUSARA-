"""Causara application package and Flask factory."""

import logging
import uuid
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from app.config import get_config
from app.api import api_v1
from app.api.errors import register_error_handlers


def configure_logging(app: Flask) -> None:
    """Configure structured console logging for the application."""
    log_level = logging.DEBUG if app.config.get("DEBUG") else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
    )


def create_app(config_name: str | None = None) -> Flask:
    """Application factory for Causara Flask REST API."""
    app = Flask(__name__)

    # Load configuration
    config_class = get_config(config_name)
    app.config.from_object(config_class)

    # Configure logging
    configure_logging(app)
    app.logger.info("Initializing Causara API in %s mode", app.config.get("ENV"))

    # Configure CORS with strict allowed origins
    cors_origins = app.config.get("CORS_ORIGINS", [])
    CORS(
        app,
        resources={r"/api/*": {"origins": cors_origins}},
        supports_credentials=True,
    )

    # Request lifecycle hooks
    @app.before_request
    def set_request_context():
        # Trace incoming request ID or generate a unique tracking identifier
        g.request_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"

    @app.after_request
    def append_response_headers(response):
        if hasattr(g, "request_id"):
            response.headers["X-Request-ID"] = g.request_id
        return response

    # Centralized JSON error handling
    register_error_handlers(app)

    # Register API v1 routes
    prefix = app.config.get("API_PREFIX", "/api/v1")
    app.register_blueprint(api_v1, url_prefix=prefix)

    # Root service probe
    @app.route("/", methods=["GET"])
    def root_index():
        return jsonify({
            "service": app.config.get("SERVICE_NAME"),
            "version": app.config.get("API_VERSION"),
            "status": "running",
            "health_check": f"{prefix}/health",
        }), 200

    return app
