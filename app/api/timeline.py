"""API endpoints for order timeline retrieval, reconstruction, and analysis jobs."""

from typing import Any, Optional
from flask import Blueprint, request
from app.api.errors import APIError, format_success_response
from app.services.timeline_service import TimelineService

timeline_bp = Blueprint("timeline", __name__)
_timeline_service = TimelineService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime or string to ISO string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        return dt_val.isoformat()
    return str(dt_val)


@timeline_bp.route("/orders/<int:order_id>/timeline", methods=["GET"])
def get_order_timeline(order_id: int):
    """Retrieve the normalized, chronological, and explainable timeline for an order.

    Returns:
        JSON envelope containing the reconstructed timeline events, stage progression,
        validation anomalies, and a plain-language customer summary.
    """
    reconstructed = _timeline_service.reconstruct_order_timeline(
        order_id=order_id,
        persist_stage_actuals=False,
        record_audit=False,
    )
    return format_success_response(reconstructed.to_dict(), status_code=200)


@timeline_bp.route("/orders/<int:order_id>/timeline/reconstruct", methods=["POST"])
def reconstruct_order_timeline(order_id: int):
    """Request and execute factual timeline reconstruction for an order.

    Headers:
        Idempotency-Key: Optional client-supplied idempotency key.

    Body (optional):
        async: Optional boolean (default False). If True, enqueues the job and returns immediately.
    """
    payload = request.get_json(silent=True) or {}
    run_async = bool(payload.get("async", False))
    idempotency_key = request.headers.get("Idempotency-Key") or payload.get("idempotency_key")

    job = _timeline_service.create_reconstruction_job(
        order_id=order_id,
        idempotency_key=idempotency_key,
    )
    job_id = int(job["job_id"])

    if run_async:
        return format_success_response(
            {
                "order_id": order_id,
                "job_id": job_id,
                "job_type": job.get("job_type", "TIMELINE_RECONSTRUCTION"),
                "status": job.get("status", "QUEUED"),
                "message": "Timeline reconstruction job queued successfully.",
            },
            status_code=202,
        )

    # Synchronous execution
    reconstructed = _timeline_service.execute_reconstruction_job(job_id=job_id)
    return format_success_response(reconstructed.to_dict(), status_code=200)


@timeline_bp.route("/analysis-jobs/<int:job_id>", methods=["GET"])
def get_analysis_job_status(job_id: int):
    """Retrieve the lifecycle state, execution timestamps, and error diagnostics of an analysis job."""
    job = _timeline_service.get_analysis_job(job_id=job_id)
    if not job:
        raise APIError(
            code="RESOURCE_NOT_FOUND",
            message=f"Analysis job {job_id} does not exist.",
            status_code=404,
        )

    formatted_job = {
        "job_id": job["job_id"],
        "order_id": job["order_id"],
        "case_id": job["case_id"],
        "decision_id": job["decision_id"],
        "job_type": job["job_type"],
        "status": job["status"],
        "idempotency_key": job["idempotency_key"],
        "retry_count": job["retry_count"],
        "created_at": _format_datetime(job.get("created_at")),
        "started_at": _format_datetime(job.get("started_at")),
        "completed_at": _format_datetime(job.get("completed_at")),
        "error_message": job["error_message"],
    }
    return format_success_response(formatted_job, status_code=200)


@timeline_bp.route("/orders/<int:order_id>/analysis-jobs", methods=["GET"])
def list_order_analysis_jobs(order_id: int):
    """Retrieve all background analysis jobs associated with an order."""
    jobs = _timeline_service.list_order_analysis_jobs(order_id=order_id)
    formatted_jobs = []
    for job in jobs:
        formatted_jobs.append({
            "job_id": job["job_id"],
            "order_id": job["order_id"],
            "case_id": job["case_id"],
            "decision_id": job["decision_id"],
            "job_type": job["job_type"],
            "status": job["status"],
            "idempotency_key": job["idempotency_key"],
            "retry_count": job["retry_count"],
            "created_at": _format_datetime(job.get("created_at")),
            "started_at": _format_datetime(job.get("started_at")),
            "completed_at": _format_datetime(job.get("completed_at")),
            "error_message": job["error_message"],
        })

    return format_success_response(
        {
            "order_id": order_id,
            "jobs": formatted_jobs,
            "count": len(formatted_jobs),
        },
        status_code=200,
    )
