"""API endpoints for candidate intervention discovery and scenario simulation."""

from typing import Any, Optional
from flask import Blueprint, request

from app.api.errors import APIError, format_success_response
from app.services.intervention_service import InterventionService
from app.services.scenario_service import ScenarioService

scenarios_bp = Blueprint("scenarios", __name__)
_intervention_service = InterventionService()
_scenario_service = ScenarioService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        return dt_val.isoformat()
    return str(dt_val)


def _serialize_scenario(sc: dict) -> dict:
    """Format scenario dictionary for API presentation."""
    res = dict(sc)
    if "created_at" in res:
        res["created_at"] = _format_datetime(res["created_at"])
    return res


@scenarios_bp.route("/cases/<int:case_id>/interventions", methods=["GET"])
def get_case_candidate_interventions(case_id: int):
    """Discover candidate operational interventions applicable to an order's delay points."""
    candidates = _intervention_service.discover_candidate_interventions(case_id)
    return format_success_response(
        {
            "case_id": case_id,
            "candidate_count": len(candidates),
            "candidates": [c.to_dict() for c in candidates],
        },
        status_code=200,
    )


@scenarios_bp.route("/cases/<int:case_id>/scenarios", methods=["POST"])
def simulate_case_scenario(case_id: int):
    """Simulate a decision scenario containing selected interventions."""
    payload = request.get_json(silent=True) or {}
    scenario_name = payload.get("scenario_name")
    if not scenario_name:
        raise APIError(
            code="BAD_REQUEST",
            message="Missing required field 'scenario_name'.",
            status_code=400,
        )

    intervention_ids = payload.get("intervention_ids")
    if not intervention_ids or not isinstance(intervention_ids, list):
        raise APIError(
            code="BAD_REQUEST",
            message="'intervention_ids' must be a non-empty list of integers.",
            status_code=400,
        )

    assumptions = payload.get("assumptions")
    cosmos_doc_id = payload.get("cosmos_document_id")

    scenario = _scenario_service.simulate_scenario(
        case_id=case_id,
        scenario_name=scenario_name,
        intervention_ids=[int(i) for i in intervention_ids],
        assumptions=assumptions,
        cosmos_document_id=cosmos_doc_id,
    )
    return format_success_response(_serialize_scenario(scenario), status_code=201)


@scenarios_bp.route("/cases/<int:case_id>/scenarios/auto-generate", methods=["POST"])
def auto_generate_scenarios(case_id: int):
    """Automatically synthesize alternative candidate scenarios for evaluation."""
    scenarios = _scenario_service.auto_generate_scenarios_for_case(case_id)
    return format_success_response(
        {
            "case_id": case_id,
            "scenario_count": len(scenarios),
            "scenarios": [_serialize_scenario(s) for s in scenarios],
        },
        status_code=201,
    )


@scenarios_bp.route("/cases/<int:case_id>/scenarios", methods=["GET"])
def list_case_scenarios(case_id: int):
    """List all simulated scenarios for a decision case."""
    scenarios = _scenario_service.list_case_scenarios(case_id)
    return format_success_response(
        {
            "case_id": case_id,
            "scenario_count": len(scenarios),
            "scenarios": [_serialize_scenario(s) for s in scenarios],
        },
        status_code=200,
    )


@scenarios_bp.route("/scenarios/<int:scenario_id>", methods=["GET"])
def get_scenario(scenario_id: int):
    """Retrieve details for a simulated scenario."""
    scenario = _scenario_service.get_scenario(scenario_id)
    return format_success_response(_serialize_scenario(scenario), status_code=200)
