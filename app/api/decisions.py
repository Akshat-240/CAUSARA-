"""API endpoints for decision recording, manager approvals, and outcome verification."""

from typing import Any, Optional
from flask import Blueprint, g, request

from app.api.errors import APIError, format_success_response
from app.security import parse_positive_int, require_auth, require_roles, sanitize_text_input
from app.services.decision_service import DecisionService
from app.services.timeline_service import parse_to_utc_datetime

decisions_bp = Blueprint("decisions", __name__)
_decision_service = DecisionService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to UTC ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        if getattr(dt_val, "tzinfo", None) is None:
            return dt_val.isoformat() + "Z"
        return dt_val.isoformat()
    return str(dt_val)


def _serialize_decision(dec: dict) -> dict:
    """Format decision dictionary for API presentation."""
    res = dict(dec)
    if "selected_at" in res:
        res["selected_at"] = _format_datetime(res["selected_at"])
    if "approved_at" in res:
        res["approved_at"] = _format_datetime(res["approved_at"])
    return res


def _serialize_verification(v: dict) -> dict:
    """Format verification dictionary for API presentation."""
    res = dict(v)
    for dt_col in ("measured_at", "original_expected_delivery_at", "baseline_estimated_delivery_at",
                   "predicted_delivery_at", "actual_delivery_at"):
        if dt_col in res:
            res[dt_col] = _format_datetime(res[dt_col])
    return res


@decisions_bp.route("/cases/<int:case_id>/decisions", methods=["POST"])
@require_roles("ANALYST", "MANAGER", "ADMIN")
def record_case_decision(case_id: int):
    """Record an operational decision for a decision case."""
    payload = request.get_json(silent=True) or {}
    raw_scenario_id = payload.get("scenario_id")
    if raw_scenario_id is None:
        raise APIError(code="BAD_REQUEST", message="Missing 'scenario_id'.", status_code=400)

    scenario_id = parse_positive_int(raw_scenario_id, "scenario_id")
    rationale = sanitize_text_input(payload.get("rationale"), "rationale", required=True, max_length=2000)

    # Always attribute decision authorship to the authenticated principal
    decided_by = int(g.current_user["user_id"])

    decision = _decision_service.record_decision(
        case_id=case_id,
        scenario_id=scenario_id,
        decided_by=decided_by,
        rationale=rationale or "",
    )
    return format_success_response(_serialize_decision(decision), status_code=201)


@decisions_bp.route("/cases/<int:case_id>/decisions", methods=["GET"])
@require_auth()
def list_case_decisions(case_id: int):
    """List all decisions recorded for a decision case."""
    decisions = _decision_service.list_case_decisions(case_id)
    return format_success_response(
        {
            "case_id": case_id,
            "decision_count": len(decisions),
            "decisions": [_serialize_decision(d) for d in decisions],
        },
        status_code=200,
    )


@decisions_bp.route("/decisions/<int:decision_id>", methods=["GET"])
@require_auth()
def get_decision(decision_id: int):
    """Retrieve details for a decision."""
    decision = _decision_service.get_decision(decision_id)
    return format_success_response(_serialize_decision(decision), status_code=200)


@decisions_bp.route("/decisions/<int:decision_id>/approve", methods=["POST"])
@require_roles("MANAGER", "ADMIN")
def approve_decision(decision_id: int):
    """Approve a pending operational decision."""
    # Always attribute manager approval to the authenticated manager/admin principal
    manager_user_id = int(g.current_user["user_id"])

    decision = _decision_service.approve_decision(
        decision_id=decision_id,
        manager_user_id=manager_user_id,
    )
    return format_success_response(_serialize_decision(decision), status_code=200)


@decisions_bp.route("/decisions/<int:decision_id>/reject", methods=["POST"])
@require_roles("MANAGER", "ADMIN")
def reject_decision(decision_id: int):
    """Reject a pending operational decision."""
    payload = request.get_json(silent=True) or {}
    rejection_reason = (
        sanitize_text_input(payload.get("rejection_reason"), "rejection_reason", required=False, max_length=1000)
        or "Decision rejected by manager."
    )

    # Always attribute manager rejection to the authenticated manager/admin principal
    manager_user_id = int(g.current_user["user_id"])

    decision = _decision_service.reject_decision(
        decision_id=decision_id,
        manager_user_id=manager_user_id,
        rejection_reason=rejection_reason,
    )
    return format_success_response(_serialize_decision(decision), status_code=200)


@decisions_bp.route("/decisions/<int:decision_id>/verify", methods=["POST"])
@require_roles("ANALYST", "MANAGER", "AUDITOR", "ADMIN")
def verify_decision(decision_id: int):
    """Reconcile and verify predicted outcome against observed actual delivery."""
    payload = request.get_json(silent=True) or {}
    actual_str = payload.get("actual_delivery_at")
    outcome_notes = sanitize_text_input(
        payload.get("outcome_notes"), "outcome_notes", required=False, max_length=2000
    )

    actual_dt = parse_to_utc_datetime(actual_str) if actual_str else None

    verification = _decision_service.verify_prediction(
        decision_id=decision_id,
        actual_delivery_at=actual_dt,
        outcome_notes=outcome_notes,
    )
    return format_success_response(_serialize_verification(verification), status_code=200)


@decisions_bp.route("/decisions/<int:decision_id>/verification", methods=["GET"])
@require_auth()
def get_decision_verification(decision_id: int):
    """Retrieve verified prediction outcome and variance metrics."""
    verification = _decision_service.get_decision_verification(decision_id)
    return format_success_response(_serialize_verification(verification), status_code=200)
