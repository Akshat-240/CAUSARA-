"""API endpoints for order lifecycle event ingestion and timeline retrieval."""

from flask import Blueprint, request
from app.api.errors import APIError, format_success_response
from app.services.event_service import EventService

events_bp = Blueprint("events", __name__)
_event_service = EventService()


@events_bp.route("/orders/<int:order_id>/events", methods=["POST"])
def ingest_order_event(order_id: int):
    """Ingest a new order lifecycle event or return an idempotent duplicate response.

    Headers:
        Idempotency-Key: Unique client-supplied idempotency token (optional if provided in body).

    Body:
        event_type: Operational event code (e.g. 'DISPATCHED', 'PACKED').
        occurred_at: ISO 8601 timestamp string.
        stage_code: Optional stage code (e.g. 'LINEHAUL_TRANSPORT').
        stage_id: Optional stage primary key.
        location: Optional location description.
        description: Optional event narrative.
        source_type: Optional source enum ('MANUAL_DASHBOARD', 'COURIER_API', 'OMS_WEBHOOK', 'SYSTEM').
        source_provider: Optional courier/system name.
        source_event_id: Optional third-party identifier.
        raw_payload: Optional raw input payload.
    """
    payload = request.get_json(silent=True)
    if payload is None:
        raise APIError(
            code="BAD_REQUEST",
            message="Request body must be a valid JSON object.",
            status_code=400,
        )

    # Read idempotency key from header or body
    idempotency_key = request.headers.get("Idempotency-Key") or payload.get("idempotency_key")

    result = _event_service.ingest_event(
        order_id=order_id,
        payload=payload,
        idempotency_key=idempotency_key,
    )

    # 200 OK for idempotent duplicate replay, 201 Created for new event
    status_code = 200 if result.is_duplicate else 201
    return format_success_response(result.to_dict(), status_code=status_code)


@events_bp.route("/orders/<int:order_id>/events", methods=["GET"])
def get_order_events(order_id: int):
    """Retrieve the chronological immutable timeline of events for an order."""
    events = _event_service.list_order_events(order_id=order_id)
    return format_success_response(
        {
            "order_id": order_id,
            "events": events,
            "count": len(events),
        },
        status_code=200,
    )
