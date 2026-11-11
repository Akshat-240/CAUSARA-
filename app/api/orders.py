"""REST API endpoints for order entity creation, queries, and stage progression."""

from typing import Any, Optional
from flask import Blueprint, request

from app.api.errors import APIError, format_success_response
from app.services.order_service import OrderService
from app.services.timeline_service import parse_to_utc_datetime

orders_bp = Blueprint("orders", __name__)
_order_service = OrderService()


def _format_datetime(dt_val: Any) -> Optional[str]:
    """Convert datetime to ISO 8601 string."""
    if dt_val is None:
        return None
    if hasattr(dt_val, "isoformat"):
        return dt_val.isoformat()
    return str(dt_val)


def _serialize_order(order: dict) -> dict:
    """Format order dictionary for JSON serialization."""
    res = dict(order)
    for col in ("placed_at", "expected_delivery_at", "actual_delivery_at", "created_at"):
        if col in res:
            res[col] = _format_datetime(res[col])
    if "stages" in res and isinstance(res["stages"], list):
        res["stages"] = [_serialize_stage(s) for s in res["stages"]]
    return res


def _serialize_stage(stage: dict) -> dict:
    """Format order stage dictionary for JSON serialization."""
    res = dict(stage)
    for col in ("planned_start_at", "planned_end_at", "actual_start_at", "actual_end_at"):
        if col in res:
            res[col] = _format_datetime(res[col])
    return res


@orders_bp.route("/orders", methods=["POST"])
def create_order():
    """Create a new order entity with planned operational stages."""
    payload = request.get_json(silent=True) or {}
    seller_id = payload.get("seller_id")
    customer_user_id = payload.get("customer_user_id")
    external_order_ref = payload.get("external_order_ref")
    placed_at_str = payload.get("placed_at")
    expected_delivery_at_str = payload.get("expected_delivery_at")
    custom_stages = payload.get("stages")

    if not seller_id:
        raise APIError(code="BAD_REQUEST", message="Missing 'seller_id'.", status_code=400)
    if not customer_user_id:
        raise APIError(code="BAD_REQUEST", message="Missing 'customer_user_id'.", status_code=400)
    if not external_order_ref:
        raise APIError(code="BAD_REQUEST", message="Missing 'external_order_ref'.", status_code=400)
    if not expected_delivery_at_str:
        raise APIError(code="BAD_REQUEST", message="Missing 'expected_delivery_at'.", status_code=400)

    placed_dt = parse_to_utc_datetime(placed_at_str) if placed_at_str else None
    expected_dt = parse_to_utc_datetime(expected_delivery_at_str)
    if not expected_dt:
        raise APIError(code="BAD_REQUEST", message="Invalid 'expected_delivery_at' timestamp format.", status_code=400)

    order = _order_service.create_order(
        seller_id=int(seller_id),
        customer_user_id=int(customer_user_id),
        external_order_ref=str(external_order_ref),
        placed_at=placed_dt,
        expected_delivery_at=expected_dt,
        custom_stages=custom_stages,
    )
    return format_success_response(_serialize_order(order), status_code=201)


@orders_bp.route("/orders", methods=["GET"])
def list_orders():
    """List orders with optional status or seller filtering and pagination."""
    status = request.args.get("status")
    seller_id_str = request.args.get("seller_id")
    seller_id = int(seller_id_str) if seller_id_str and seller_id_str.isdigit() else None
    limit = int(request.args.get("limit", 50))
    offset = int(request.args.get("offset", 0))

    orders, total = _order_service.list_orders(
        status=status,
        seller_id=seller_id,
        limit=limit,
        offset=offset,
    )
    return format_success_response(
        {
            "total": total,
            "limit": limit,
            "offset": offset,
            "orders": [_serialize_order(o) for o in orders],
        },
        status_code=200,
    )


@orders_bp.route("/orders/<int:order_id>", methods=["GET"])
def get_order(order_id: int):
    """Retrieve full details for an order."""
    order = _order_service.get_order(order_id)
    return format_success_response(_serialize_order(order), status_code=200)


@orders_bp.route("/orders/<int:order_id>/stages", methods=["GET"])
def get_order_stages(order_id: int):
    """Retrieve operational stages for an order."""
    stages = _order_service.get_order_stages(order_id)
    return format_success_response(
        {
            "order_id": order_id,
            "stage_count": len(stages),
            "stages": [_serialize_stage(s) for s in stages],
        },
        status_code=200,
    )


@orders_bp.route("/orders/stats", methods=["GET"])
def get_order_stats():
    """Retrieve operational fulfillment metrics aggregated directly from database."""
    stats = _order_service.get_order_stats()
    return format_success_response(stats, status_code=200)


@orders_bp.route("/sellers", methods=["GET"])
def list_sellers():
    """Retrieve list of registered sellers."""
    sellers = _order_service.list_sellers()
    return format_success_response(
        {
            "sellers": sellers,
            "count": len(sellers),
        },
        status_code=200,
    )
