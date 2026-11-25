"""REST API endpoints for evidence ingestion and retrieval."""

from typing import Any, Optional
from flask import Blueprint, g, request
from app.api.errors import APIError, format_success_response
from app.security import parse_positive_int, require_auth, require_roles, sanitize_filename
from app.services.evidence_service import EvidenceService

evidence_bp = Blueprint("evidence", __name__)
_evidence_service = EvidenceService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to UTC ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        if getattr(dt_val, "tzinfo", None) is None:
            return dt_val.isoformat() + "Z"
        return dt_val.isoformat()
    return str(dt_val)


def _serialize_evidence(row: dict) -> dict:
    """Format evidence row for API response."""
    return {
        "evidence_id": row["evidence_id"],
        "order_id": row["order_id"],
        "event_id": row["event_id"],
        "case_id": row["case_id"],
        "uploaded_by": row["uploaded_by"],
        "blob_uri": row["blob_uri"],
        "file_name": row["file_name"],
        "content_type": row["content_type"],
        "sha256_hash": row["sha256_hash"],
        "status": row["status"],
        "uploaded_at": _format_datetime(row.get("uploaded_at")),
        "completed_at": _format_datetime(row.get("completed_at")),
        "upload_expires_at": _format_datetime(row.get("upload_expires_at")),
    }


@evidence_bp.route("/orders/<int:order_id>/evidence", methods=["POST"])
@require_roles("SELLER", "ANALYST", "MANAGER", "ADMIN")
def register_order_evidence(order_id: int):
    """Register evidence for an order via JSON payload or multipart file upload."""
    if request.is_json:
        payload = request.get_json() or {}
        file_name = payload.get("file_name")
        content_type = payload.get("content_type")
        blob_uri = payload.get("blob_uri")
        sha256_hash = payload.get("sha256_hash")
        event_id = payload.get("event_id")
        case_id = payload.get("case_id")
        file_bytes = None
    elif request.files:
        if "file" not in request.files:
            raise APIError(
                code="BAD_REQUEST",
                message="Multipart request must contain a 'file' field.",
                status_code=400,
            )
        uploaded_file = request.files["file"]
        file_name = uploaded_file.filename
        content_type = uploaded_file.content_type or "application/octet-stream"
        file_bytes = uploaded_file.read()
        event_id = request.form.get("event_id")
        case_id = request.form.get("case_id")
        blob_uri = None
        sha256_hash = None
    else:
        raise APIError(
            code="BAD_REQUEST",
            message="Request must be JSON or multipart/form-data.",
            status_code=400,
        )

    # Always derive acting uploader from the verified authenticated principal
    uploaded_by = int(g.current_user["user_id"])

    if not file_name:
        raise APIError(
            code="MISSING_REQUIRED_FIELD",
            message="'file_name' is required.",
            status_code=400,
        )
    safe_file_name = sanitize_filename(file_name)

    parsed_event_id = parse_positive_int(event_id, "event_id") if event_id is not None else None
    parsed_case_id = parse_positive_int(case_id, "case_id") if case_id is not None else None

    evidence = _evidence_service.register_evidence(
        order_id=order_id,
        uploaded_by=uploaded_by,
        file_name=safe_file_name,
        content_type=content_type,
        file_bytes=file_bytes,
        blob_uri=blob_uri,
        sha256_hash=sha256_hash,
        event_id=parsed_event_id,
        case_id=parsed_case_id,
    )
    return format_success_response(_serialize_evidence(evidence), status_code=201)


@evidence_bp.route("/orders/<int:order_id>/evidence", methods=["GET"])
@require_auth()
def list_order_evidence(order_id: int):
    """Retrieve evidence records associated with an order, optionally filtered."""
    event_id = request.args.get("event_id", type=int)
    case_id = request.args.get("case_id", type=int)
    stage_id = request.args.get("stage_id", type=int)

    records = _evidence_service.list_evidence_for_order(
        order_id=order_id,
        event_id=event_id,
        case_id=case_id,
        stage_id=stage_id,
    )
    serialized = [_serialize_evidence(r) for r in records]
    return format_success_response(
        {
            "order_id": order_id,
            "evidence": serialized,
            "count": len(serialized),
        },
        status_code=200,
    )


@evidence_bp.route("/evidence/<int:evidence_id>", methods=["GET"])
@require_auth()
def get_evidence_details(evidence_id: int):
    """Retrieve metadata of a specific evidence record."""
    record = _evidence_service.get_evidence(evidence_id=evidence_id)
    return format_success_response(_serialize_evidence(record), status_code=200)
