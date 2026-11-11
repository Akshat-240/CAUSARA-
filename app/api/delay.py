"""API endpoints for delay-chain reconstruction and case delay analysis."""

from flask import Blueprint, request

from app.api.errors import APIError, format_success_response
from app.services.delay_service import DelayAnalysisService
from app.repositories.delay_repository import DelayRepository

delay_bp = Blueprint("delay", __name__)
_delay_service = DelayAnalysisService()
_delay_repo = DelayRepository()


@delay_bp.route("/orders/<int:order_id>/delay-analysis", methods=["POST"])
def analyze_order_delay(order_id: int):
    """Run deterministic delay analysis for an order and persist delay graph edges."""
    payload = request.get_json(silent=True) or {}
    creator_user_id = payload.get("creator_user_id")
    persist_edges = bool(payload.get("persist_edges", True))

    report = _delay_service.analyze_order_delay(
        order_id=order_id,
        creator_user_id=creator_user_id,
        persist_edges=persist_edges,
    )
    return format_success_response(report.to_dict(), status_code=200)


@delay_bp.route("/orders/<int:order_id>/delay-analysis", methods=["GET"])
def get_order_delay_analysis(order_id: int):
    """Retrieve on-demand delay analysis report for an order without forcing new edges."""
    report = _delay_service.analyze_order_delay(
        order_id=order_id,
        persist_edges=False,
    )
    return format_success_response(report.to_dict(), status_code=200)


@delay_bp.route("/cases/<int:case_id>/delay-report", methods=["GET"])
def get_case_delay_report(case_id: int):
    """Retrieve delay analysis report associated with a decision case."""
    case = _delay_repo.get_case_by_id(case_id)
    if not case:
        raise APIError(
            code="RESOURCE_NOT_FOUND",
            message=f"Decision case {case_id} does not exist.",
            status_code=404,
        )

    order_id = int(case["order_id"])
    report = _delay_service.analyze_order_delay(
        order_id=order_id,
        persist_edges=False,
    )
    return format_success_response(report.to_dict(), status_code=200)


@delay_bp.route("/cases/<int:case_id>/delay-graph", methods=["GET"])
def get_case_delay_graph(case_id: int):
    """Retrieve persisted delay edges and causal hypotheses for a decision case."""
    graph_edges = _delay_service.get_case_delay_graph(case_id)
    return format_success_response(
        {
            "case_id": case_id,
            "edge_count": len(graph_edges),
            "edges": graph_edges,
        },
        status_code=200,
    )
