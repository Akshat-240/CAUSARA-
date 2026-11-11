"""REST API endpoints for evidence ingestion and retrieval."""

from typing import Any, Optional
from flask import Blueprint, request
from app.api.errors import APIError, format_success_response
from app.services.evidence_service import EvidenceService

evidence_bp = Blueprint("evidence", __name__)
_evidence_service = EvidenceService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
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
def register_order_evidence(order_id: int):
    """Register evidence for an order via JSON payload or multipart file upload."""
    if request.is_json:
        payload = request.get_json() or {}
        uploaded_by = payload.get("uploaded_by")
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
        uploaded_by = request.form.get("uploaded_by")
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

    if not uploaded_by:
        raise APIError(
            code="MISSING_REQUIRED_FIELD",
            message="'uploaded_by' user ID is required.",
            status_code=400,
        )

    if not file_name:
        raise APIError(
            code="MISSING_REQUIRED_FIELD",
            message="'file_name' is required.",
            status_code=400,
        )

    parsed_event_id = int(event_id) if event_id is not None else None
    parsed_case_id = int(case_id) if case_id is not None else None

    evidence = _evidence_service.register_evidence(
        order_id=order_id,
        uploaded_by=int(uploaded_by),
        file_name=file_name,
        content_type=content_type,
        file_bytes=file_bytes,
        blob_uri=blob_uri,
        sha256_hash=sha256_hash,
        event_id=parsed_event_id,
        case_id=parsed_case_id,
    )
    return format_success_response(_serialize_evidence(evidence), status_code=201)


@evidence_bp.route("/orders/<int:order_id>/evidence", methods=["GET"])
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
def get_evidence_details(evidence_id: int):
    """Retrieve metadata of a specific evidence record."""
    record = _evidence_service.get_evidence(evidence_id=evidence_id)
    return format_success_response(_serialize_evidence(record), status_code=200)
