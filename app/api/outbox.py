"""Internal observability endpoints for transactional outbox monitoring."""

import hmac
from flask import Blueprint, current_app, request
from app.api.errors import APIError, format_success_response
from app.repositories.outbox_repository import OutboxRepository

internal_outbox_bp = Blueprint("internal_outbox", __name__, url_prefix="/internal/outbox")
_outbox_repo = OutboxRepository()


def _verify_internal_api_key() -> None:
    """Validate internal API key for operational endpoints.

    This authentication mechanism provides interim security for internal/operational
    endpoints ahead of the full Milestone M3 authentication & authorization architecture.
    """
    expected_key = current_app.config.get("INTERNAL_API_KEY", "")
    if not expected_key:
        raise APIError(
            code="UNAUTHORIZED",
            message="Internal API key is not configured on server.",
            status_code=401,
        )

    # Extract provided key from headers (support X-Internal-API-Key or Bearer token)
    provided_key = request.headers.get("X-Internal-API-Key")
    if not provided_key:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            provided_key = auth_header[7:].strip()

    if not provided_key or not hmac.compare_digest(provided_key, expected_key):
        raise APIError(
            code="UNAUTHORIZED",
            message="Valid internal API key is required to access outbox metrics.",
            status_code=401,
        )


@internal_outbox_bp.route("/stats", methods=["GET"])
def get_outbox_statistics():
    """Retrieve high-level processing statistics for the transactional outbox engine.

    Requires valid internal API key provided via X-Internal-API-Key or Authorization header.

    Returns:
        JSON envelope containing message counts by status, aggregate retry count,
        and the age (in seconds) of the oldest pending message.
    """
    _verify_internal_api_key()
    stats = _outbox_repo.get_statistics()
    return format_success_response(
        {
            "pending_count": stats.get("pending_count", 0),
            "processing_count": stats.get("processing_count", 0),
            "published_count": stats.get("published_count", 0),
            "failed_count": stats.get("failed_count", 0),
            "total_retries": stats.get("total_retries", 0),
            "oldest_pending_age_seconds": stats.get("oldest_pending_age_seconds"),
        },
        status_code=200,
    )
