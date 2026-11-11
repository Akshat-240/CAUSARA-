"""Domain business logic and application orchestration for order event ingestion."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import logging
import re
from typing import Any, Dict, List, Optional
import pyodbc

from app.api.errors import APIError
from app.database.connection import get_db_connection
from app.repositories.event_repository import EventRepository
from app.repositories.outbox_repository import OutboxRepository

logger = logging.getLogger(__name__)

# Valid event types pattern: 2 to 50 uppercase alphanumeric chars with underscores
EVENT_TYPE_REGEX = re.compile(r"^[A-Z0-9_]{2,50}$")

# Recognized source types matching database CHECK constraint CK_order_events_source
VALID_SOURCE_TYPES = {"MANUAL_DASHBOARD", "COURIER_API", "OMS_WEBHOOK", "SYSTEM"}


@dataclass
class IngestionResult:
    """Structured result returned upon successful event ingestion or duplicate replay."""

    event_id: int
    order_id: int
    stage_id: Optional[int]
    event_type: str
    occurred_at: str
    status: str
    is_duplicate: bool

    def to_dict(self) -> Dict[str, Any]:
        """Convert result to dictionary for API response envelope."""
        return {
            "event_id": self.event_id,
            "order_id": self.order_id,
            "stage_id": self.stage_id,
            "event_type": self.event_type,
            "occurred_at": self.occurred_at,
            "status": self.status,
            "is_duplicate": self.is_duplicate,
        }


def parse_iso_timestamp(ts_str: Any) -> datetime:
    """Parse an ISO 8601 timestamp string into a normalized UTC datetime."""
    if not isinstance(ts_str, str) or not ts_str.strip():
        raise APIError(
            code="INVALID_EVENT_TIMESTAMP",
            message="occurred_at must be a non-empty ISO 8601 formatted timestamp string.",
            status_code=400,
        )

    clean_str = ts_str.strip()
    if clean_str.endswith("Z"):
        clean_str = clean_str[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(clean_str)
    except (ValueError, TypeError) as ex:
        raise APIError(
            code="INVALID_EVENT_TIMESTAMP",
            message=f"Invalid ISO 8601 timestamp format: '{ts_str}'.",
            status_code=400,
        ) from ex

    # Convert to UTC
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)

    # Sanity check: prevent timestamps far into the future (allow max 5 min clock skew)
    now_utc = datetime.now(timezone.utc)
    if dt > now_utc + timedelta(minutes=5):
        raise APIError(
            code="INVALID_EVENT_TIMESTAMP",
            message=f"Event occurred_at timestamp cannot be in the future: '{ts_str}'.",
            status_code=400,
        )

    return dt


class EventService:
    """Application service orchestrating event ingestion, validation, and idempotency."""

    def __init__(
        self,
        repository: Optional[EventRepository] = None,
        outbox_repository: Optional[OutboxRepository] = None,
    ):
        self.repo = repository or EventRepository()
        self.outbox_repo = outbox_repository or OutboxRepository()

    def ingest_event(
        self,
        order_id: int,
        payload: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> IngestionResult:
        """Validate, normalize, and atomically ingest an order lifecycle event.

        Preserves historical events in an append-only fashion. Enforces idempotency
        via database unique constraints and rejects conflicting reuse of keys.
        """
        if not isinstance(order_id, int) or order_id <= 0:
            raise APIError(
                code="INVALID_ORDER_ID",
                message=f"Order ID must be a positive integer, received: '{order_id}'.",
                status_code=400,
            )

        if not isinstance(payload, dict):
            raise APIError(
                code="BAD_REQUEST",
                message="Event payload must be a JSON object.",
                status_code=400,
            )

        # 1. Resolve idempotency key from header or body
        effective_key = idempotency_key or payload.get("idempotency_key")
        if not effective_key or not isinstance(effective_key, str) or not effective_key.strip():
            raise APIError(
                code="MISSING_IDEMPOTENCY_KEY",
                message="An Idempotency-Key header or idempotency_key field is required.",
                status_code=400,
            )
        effective_key = effective_key.strip()
        if len(effective_key) > 200:
            raise APIError(
                code="INVALID_IDEMPOTENCY_KEY",
                message="idempotency_key cannot exceed 200 characters.",
                status_code=400,
            )

        # 2. Validate event_type
        raw_event_type = payload.get("event_type")
        if not raw_event_type or not isinstance(raw_event_type, str) or not raw_event_type.strip():
            raise APIError(
                code="MISSING_REQUIRED_FIELD",
                message="event_type is required.",
                status_code=400,
            )
        norm_event_type = raw_event_type.strip().upper()
        if not EVENT_TYPE_REGEX.match(norm_event_type):
            raise APIError(
                code="INVALID_EVENT_TYPE",
                message=(
                    f"event_type '{raw_event_type}' is invalid. "
                    "Must be 2-50 uppercase alphanumeric characters or underscores."
                ),
                status_code=400,
            )

        # 3. Validate occurred_at timestamp
        raw_occurred_at = payload.get("occurred_at")
        if raw_occurred_at is None:
            raise APIError(
                code="MISSING_REQUIRED_FIELD",
                message="occurred_at is required.",
                status_code=400,
            )
        norm_occurred_dt = parse_iso_timestamp(raw_occurred_at)

        # Naive UTC datetime for SQL Server DATETIME2 storage
        sql_occurred_dt = norm_occurred_dt.replace(tzinfo=None)

        # 4. Validate source_type
        raw_source_type = payload.get("source_type", "MANUAL_DASHBOARD")
        if not isinstance(raw_source_type, str) or raw_source_type.strip().upper() not in VALID_SOURCE_TYPES:
            raise APIError(
                code="INVALID_SOURCE_TYPE",
                message=(
                    f"source_type '{raw_source_type}' is invalid. "
                    f"Must be one of: {', '.join(sorted(VALID_SOURCE_TYPES))}."
                ),
                status_code=400,
            )
        norm_source_type = raw_source_type.strip().upper()

        # 5. String length validations
        location = payload.get("location")
        if location is not None:
            if not isinstance(location, str) or len(location.strip()) > 200:
                raise APIError(
                    code="VALIDATION_ERROR",
                    message="location must be a string up to 200 characters.",
                    status_code=400,
                )
            location = location.strip()

        description = payload.get("description")
        if description is not None:
            if not isinstance(description, str) or len(description.strip()) > 500:
                raise APIError(
                    code="VALIDATION_ERROR",
                    message="description must be a string up to 500 characters.",
                    status_code=400,
                )
            description = description.strip()

        source_provider = payload.get("source_provider")
        if source_provider is not None:
            if not isinstance(source_provider, str) or len(source_provider.strip()) > 100:
                raise APIError(
                    code="VALIDATION_ERROR",
                    message="source_provider must be a string up to 100 characters.",
                    status_code=400,
                )
            source_provider = source_provider.strip()

        source_event_id = payload.get("source_event_id")
        if source_event_id is not None:
            if not isinstance(source_event_id, str) or len(source_event_id.strip()) > 150:
                raise APIError(
                    code="VALIDATION_ERROR",
                    message="source_event_id must be a string up to 150 characters.",
                    status_code=400,
                )
            source_event_id = source_event_id.strip()

        # Serialize raw payload
        raw_payload_data = payload.get("raw_payload")
        if raw_payload_data is not None:
            if isinstance(raw_payload_data, (dict, list)):
                raw_payload_str = json.dumps(raw_payload_data)
            else:
                raw_payload_str = str(raw_payload_data)
        else:
            raw_payload_str = json.dumps(payload)

        # 6. Database transaction & verification
        with get_db_connection() as conn:
            # Verify order exists
            order = self.repo.get_order(order_id, conn=conn)
            if not order:
                raise APIError(
                    code="ORDER_NOT_FOUND",
                    message=f"Order {order_id} does not exist.",
                    status_code=404,
                )

            # Resolve and verify stage
            stage_id = payload.get("stage_id")
            stage_code = payload.get("stage_code")

            resolved_stage_id: Optional[int] = None

            if stage_id is not None:
                if not isinstance(stage_id, int) or stage_id <= 0:
                    raise APIError(
                        code="VALIDATION_ERROR",
                        message="stage_id must be a positive integer.",
                        status_code=400,
                    )
                stage_record = self.repo.get_stage_by_id(stage_id, conn=conn)
                if not stage_record or stage_record["order_id"] != order_id:
                    raise APIError(
                        code="STAGE_ORDER_MISMATCH",
                        message=f"Stage {stage_id} does not belong to order {order_id}.",
                        status_code=400,
                    )
                if stage_code and stage_record["stage_code"] != stage_code.strip().upper():
                    raise APIError(
                        code="STAGE_MISMATCH",
                        message=(
                            f"stage_id {stage_id} has code '{stage_record['stage_code']}' "
                            f"which does not match provided stage_code '{stage_code}'."
                        ),
                        status_code=400,
                    )
                resolved_stage_id = stage_id

            elif stage_code is not None:
                if not isinstance(stage_code, str) or not stage_code.strip():
                    raise APIError(
                        code="VALIDATION_ERROR",
                        message="stage_code must be a non-empty string.",
                        status_code=400,
                    )
                clean_stage_code = stage_code.strip().upper()
                stage_record = self.repo.get_stage_by_code(order_id, clean_stage_code, conn=conn)
                if not stage_record:
                    raise APIError(
                        code="STAGE_NOT_FOUND",
                        message=f"Stage '{clean_stage_code}' does not exist for order {order_id}.",
                        status_code=404,
                    )
                resolved_stage_id = stage_record["stage_id"]

            # 7. Check for existing idempotency key
            existing = self.repo.get_event_by_idempotency_key(effective_key, conn=conn)
            if existing:
                return self._evaluate_idempotent_duplicate(
                    existing=existing,
                    order_id=order_id,
                    norm_event_type=norm_event_type,
                    resolved_stage_id=resolved_stage_id,
                    sql_occurred_dt=sql_occurred_dt,
                    effective_key=effective_key,
                )

            # 8. Insert new immutable event record
            event_insert_data = {
                "order_id": order_id,
                "stage_id": resolved_stage_id,
                "event_type": norm_event_type,
                "occurred_at": sql_occurred_dt,
                "source_type": norm_source_type,
                "source_provider": source_provider,
                "source_event_id": source_event_id,
                "idempotency_key": effective_key,
                "location": location,
                "description": description,
                "raw_payload": raw_payload_str,
            }

            try:
                event_id = self.repo.insert_order_event(event_insert_data, conn=conn)

                # Atomically record outbox message within the identical SQL transaction
                outbox_payload = {
                    "event_id": event_id,
                    "order_id": order_id,
                    "stage_id": resolved_stage_id,
                    "event_type": norm_event_type,
                    "occurred_at": sql_occurred_dt.isoformat(),
                    "source_type": norm_source_type,
                }
                outbox_cursor = conn.cursor()
                try:
                    self.outbox_repo.insert_outbox_event(
                        cursor=outbox_cursor,
                        event_type="ORDER_EVENT_INGESTED",
                        aggregate_type="ORDER_EVENT",
                        aggregate_id=event_id,
                        payload_json=json.dumps(outbox_payload),
                    )
                finally:
                    outbox_cursor.close()

            except pyodbc.IntegrityError as ex:
                # Concurrent request race condition on UNIQUE idempotency_key
                conn.rollback()
                existing_race = self.repo.get_event_by_idempotency_key(effective_key, conn=conn)
                if existing_race:
                    return self._evaluate_idempotent_duplicate(
                        existing=existing_race,
                        order_id=order_id,
                        norm_event_type=norm_event_type,
                        resolved_stage_id=resolved_stage_id,
                        sql_occurred_dt=sql_occurred_dt,
                        effective_key=effective_key,
                    )
                logger.error("Database integrity error during event ingestion: %s", ex)
                raise APIError(
                    code="INTEGRITY_VIOLATION",
                    message="Database constraint violation while inserting event.",
                    status_code=400,
                ) from ex

            logger.info(
                "Ingested event %d for order %d [type=%s, key=%s]",
                event_id,
                order_id,
                norm_event_type,
                effective_key,
            )

            return IngestionResult(
                event_id=event_id,
                order_id=order_id,
                stage_id=resolved_stage_id,
                event_type=norm_event_type,
                occurred_at=norm_occurred_dt.isoformat(),
                status="ACCEPTED",
                is_duplicate=False,
            )

    def _evaluate_idempotent_duplicate(
        self,
        existing: Dict[str, Any],
        order_id: int,
        norm_event_type: str,
        resolved_stage_id: Optional[int],
        sql_occurred_dt: datetime,
        effective_key: str,
    ) -> IngestionResult:
        """Evaluate an existing event matching the idempotency key for parity or conflict."""
        # Check matching critical fields
        same_order = existing["order_id"] == order_id
        same_type = existing["event_type"] == norm_event_type
        same_stage = existing["stage_id"] == resolved_stage_id

        # Timestamp comparison within 1 second tolerance for format/db storage precision
        existing_dt = existing["occurred_at"]
        if isinstance(existing_dt, datetime):
            time_diff = abs((existing_dt - sql_occurred_dt).total_seconds())
            same_time = time_diff < 1.0
        else:
            same_time = str(existing_dt) == str(sql_occurred_dt)

        if same_order and same_type and same_stage and same_time:
            # Idempotent replay: return existing event
            logger.info(
                "Idempotent duplicate accepted for event %d [order=%d, key=%s]",
                existing["event_id"],
                order_id,
                effective_key,
            )
            occurred_str = (
                existing["occurred_at"].isoformat()
                if isinstance(existing["occurred_at"], datetime)
                else str(existing["occurred_at"])
            )
            return IngestionResult(
                event_id=existing["event_id"],
                order_id=order_id,
                stage_id=existing["stage_id"],
                event_type=existing["event_type"],
                occurred_at=occurred_str,
                status="ACCEPTED",
                is_duplicate=True,
            )

        # Conflict: identical key reused for different event data
        logger.warning(
            "Idempotency conflict for key '%s': incoming order %d != existing order %d or payload mismatch",
            effective_key,
            order_id,
            existing["order_id"],
        )
        raise APIError(
            code="IDEMPOTENCY_CONFLICT",
            message="Idempotency key was previously used with conflicting event data.",
            status_code=409,
            details={
                "idempotency_key": effective_key,
                "existing_event_id": existing["event_id"],
                "existing_order_id": existing["order_id"],
                "existing_event_type": existing["event_type"],
            },
        )

    def list_order_events(self, order_id: int) -> List[Dict[str, Any]]:
        """Retrieve chronological immutable timeline of events for an order."""
        if not isinstance(order_id, int) or order_id <= 0:
            raise APIError(
                code="INVALID_ORDER_ID",
                message=f"Order ID must be a positive integer, received: '{order_id}'.",
                status_code=400,
            )

        with get_db_connection() as conn:
            order = self.repo.get_order(order_id, conn=conn)
            if not order:
                raise APIError(
                    code="ORDER_NOT_FOUND",
                    message=f"Order {order_id} does not exist.",
                    status_code=404,
                )

            events = self.repo.get_events_for_order(order_id, conn=conn)

            # Format timestamps for JSON serialization
            formatted_events = []
            for e in events:
                e_copy = dict(e)
                if isinstance(e_copy.get("occurred_at"), datetime):
                    e_copy["occurred_at"] = e_copy["occurred_at"].isoformat()
                if isinstance(e_copy.get("received_at"), datetime):
                    e_copy["received_at"] = e_copy["received_at"].isoformat()
                formatted_events.append(e_copy)

            return formatted_events
