"""Standardized API response formatting and centralized error handlers."""

from datetime import datetime, timezone
import logging
import uuid
from typing import Any, Dict, Optional, Tuple
from flask import Blueprint, Flask, current_app, g, jsonify, request
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)


def get_current_request_id() -> str:
    """Retrieve or generate the request ID for tracing."""
    if hasattr(g, "request_id") and g.request_id:
        return g.request_id
    req_id = request.headers.get("X-Request-ID") or f"req_{uuid.uuid4().hex[:12]}"
    g.request_id = req_id
    return req_id


def build_meta(custom_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Construct standard metadata envelope according to Causara API specification."""
    meta: Dict[str, Any] = {
        "request_id": get_current_request_id(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if custom_meta:
        meta.update(custom_meta)
    return meta


def format_success_response(
    data: Any,
    status_code: int = 200,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """Construct standard success JSON envelope."""
    payload = {
        "success": True,
        "data": data,
        "meta": build_meta(meta),
    }
    return jsonify(payload), status_code


def format_error_response(
    code: str,
    message: str,
    details: Any = None,
    status_code: int = 400,
    meta: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, int]:
    """Construct standard error JSON envelope."""
    payload = {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details,
        },
        "meta": build_meta(meta),
    }
    return jsonify(payload), status_code


class APIError(Exception):
    """Custom application exception with structured error envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details


def register_error_handlers(app: Flask | Blueprint) -> None:
    """Register centralized JSON error handlers on application or blueprint."""

    @app.errorhandler(APIError)
    def handle_api_error(error: APIError):
        return format_error_response(
            code=error.code,
            message=error.message,
            details=error.details,
            status_code=error.status_code,
        )

    @app.errorhandler(HTTPException)
    def handle_http_exception(error: HTTPException):
        code_map = {
            400: "BAD_REQUEST",
            401: "UNAUTHORIZED",
            403: "FORBIDDEN",
            404: "RESOURCE_NOT_FOUND",
            405: "METHOD_NOT_ALLOWED",
            415: "UNSUPPORTED_MEDIA_TYPE",
            422: "UNPROCESSABLE_ENTITY",
            429: "TOO_MANY_REQUESTS",
            500: "INTERNAL_SERVER_ERROR",
        }
        error_code = code_map.get(error.code or 500, "HTTP_ERROR")
        return format_error_response(
            code=error_code,
            message=error.description or "An HTTP error occurred.",
            status_code=error.code or 500,
        )

    @app.errorhandler(Exception)
    def handle_generic_exception(error: Exception):
        logger.exception("Unhandled server exception: %s", error)
        # Never leak internal stack traces to clients in production
        message = str(error) if current_app.config.get("DEBUG") else "An unexpected internal server error occurred."
        return format_error_response(
            code="INTERNAL_SERVER_ERROR",
            message=message,
            status_code=500,
        )
