"""Timeline Reconstruction and Normalization Service.

Transforms raw, ingested order events into a normalized, chronological,
and explainable order journey. Enforces strict domain rules:
- Preserves original event IDs and timestamps.
- Normalizes all timestamps to UTC.
- Enforces deterministic ordering: (occurred_at ASC, received_at ASC, event_id ASC).
- Identifies exact duplicate events without dropping raw source records.
- Flags contradictory and conflicting events with explicit diagnostics.
- Reconstructs stage progression, transitions, and variances against planned baselines.
- Never fabricates missing events or presents inferences as confirmed facts.
- Integrates with dbo.analysis_jobs (TIMELINE_RECONSTRUCTION).
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import uuid
import pyodbc

from app.api.errors import APIError
from app.database.connection import get_db_connection
from app.repositories.timeline_repository import TimelineRepository

logger = logging.getLogger(__name__)

# Standard stage codes in sequential lifecycle order
STANDARD_STAGE_SEQUENCE = [
    "SELLER_PROCESSING",
    "DISPATCH",
    "LINEHAUL_TRANSPORT",
    "LAST_MILE",
    "DELIVERED",
]

# Mapping heuristic for events without explicit stage_id/stage_code
EVENT_TYPE_STAGE_HINTS: Dict[str, str] = {
    "ORDER_PLACED": "SELLER_PROCESSING",
    "ORDER_CONFIRMED": "SELLER_PROCESSING",
    "PAYMENT_CONFIRMED": "SELLER_PROCESSING",
    "PACKING_STARTED": "SELLER_PROCESSING",
    "PACKED": "SELLER_PROCESSING",
    "PROCESSING": "SELLER_PROCESSING",
    "READY_FOR_PICKUP": "DISPATCH",
    "HANDOFF_SCHEDULED": "DISPATCH",
    "HANDOFF": "DISPATCH",
    "PICKED_UP": "DISPATCH",
    "DISPATCHED": "DISPATCH",
    "IN_TRANSIT": "LINEHAUL_TRANSPORT",
    "HUB_ARRIVAL": "LINEHAUL_TRANSPORT",
    "HUB_DEPARTURE": "LINEHAUL_TRANSPORT",
    "ARRIVED_AT_HUB": "LINEHAUL_TRANSPORT",
    "DEPARTED_FROM_HUB": "LINEHAUL_TRANSPORT",
    "LINEHAUL_TRANSIT": "LINEHAUL_TRANSPORT",
    "ARRIVED_DESTINATION_HUB": "LAST_MILE",
    "OUT_FOR_DELIVERY": "LAST_MILE",
    "DELIVERY_ATTEMPTED": "LAST_MILE",
    "RESCHEDULED": "LAST_MILE",
    "DELIVERED": "DELIVERED",
    "DELIVERY_CONFIRMED": "DELIVERED",
}

DELIVERY_CONFIRMATION_EVENT_TYPES = {"DELIVERED", "DELIVERY_CONFIRMED"}
TERMINAL_EVENT_TYPES = {"DELIVERED", "DELIVERY_CONFIRMED", "CANCELLED", "RETURNED"}


def parse_to_utc_datetime(ts_value: Any) -> datetime:
    """Normalize timestamp input to aware UTC datetime without inventing data.

    Supports datetime objects and ISO 8601 string representations.
    """
    if ts_value is None:
        raise ValueError("Timestamp value cannot be None.")

    if isinstance(ts_value, datetime):
        if ts_value.tzinfo is None:
            return ts_value.replace(tzinfo=timezone.utc)
        return ts_value.astimezone(timezone.utc)

    if isinstance(ts_value, str):
        cleaned = ts_value.strip()
        if not cleaned:
            raise ValueError("Timestamp string cannot be empty.")
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    raise TypeError(f"Unsupported timestamp type: {type(ts_value)}")


def format_iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Format aware datetime into ISO 8601 UTC string."""
    if dt is None:
        return None
    utc_dt = dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    # Format with Z suffix
    formatted = utc_dt.strftime("%Y-%m-%dT%H:%M:%S")
    if utc_dt.microsecond > 0:
        formatted += f".{utc_dt.microsecond:06d}"
    return formatted + "Z"


@dataclass
class TimelineEvent:
    """Represents a normalized, explainable order event within the reconstructed timeline."""

    event_id: int
    order_id: int
    stage_id: Optional[int]
    stage_code: Optional[str]
    sequence_no: Optional[int]
    event_type: str
    occurred_at: str
    received_at: str
    source_type: str
    sequence_position: int
    validation_status: str  # VALID, DUPLICATE, CONFLICTING, OUT_OF_ORDER, ANOMALOUS
    evidence_classification: str  # FACT, DATA_QUALITY_ISSUE, INFERRED
    is_duplicate: bool = False
    duplicate_of: Optional[int] = None
    is_conflict: bool = False
    is_inferred: bool = False
    source_provider: Optional[str] = None
    source_event_id: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    raw_payload: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    related_event_ids: List[int] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize timeline event to dictionary."""
        return asdict(self)


@dataclass
class ReconstructedStage:
    """Represents the reconstructed progression and timing of an operational stage."""

    stage_id: Optional[int]
    stage_code: str
    sequence_no: int
    status: str  # PENDING, IN_PROGRESS, COMPLETED, SKIPPED
    planned_start_at: Optional[str] = None
    planned_end_at: Optional[str] = None
    actual_start_at: Optional[str] = None
    actual_end_at: Optional[str] = None
    event_count: int = 0
    event_ids: List[int] = field(default_factory=list)
    planned_duration_minutes: Optional[int] = None
    actual_duration_minutes: Optional[int] = None
    variance_minutes: Optional[int] = None
    time_lost_minutes: int = 0
    time_recovered_minutes: int = 0
    anomalies: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize reconstructed stage to dictionary."""
        return asdict(self)


@dataclass
class TimelineSummary:
    """High-level epistemological and operational summary of the reconstructed timeline."""

    is_complete: bool
    has_anomalies: bool
    total_events: int
    valid_event_count: int
    duplicate_count: int
    conflict_count: int
    out_of_order_count: int
    customer_summary: str
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize summary to dictionary."""
        return asdict(self)


@dataclass
class ReconstructedTimeline:
    """Root entity containing the end-to-end reconstructed order timeline."""

    order_id: int
    order_status: str
    external_order_ref: str
    placed_at: str
    expected_delivery_at: str
    reconstructed_at: str
    timeline: List[TimelineEvent]
    stage_progression: List[ReconstructedStage]
    summary: TimelineSummary
    actual_delivery_at: Optional[str] = None
    job_id: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serialize full reconstructed timeline to dictionary."""
        return {
            "order_id": self.order_id,
            "order_status": self.order_status,
            "external_order_ref": self.external_order_ref,
            "placed_at": self.placed_at,
            "expected_delivery_at": self.expected_delivery_at,
            "actual_delivery_at": self.actual_delivery_at,
            "reconstructed_at": self.reconstructed_at,
            "job_id": self.job_id,
            "summary": self.summary.to_dict(),
            "stage_progression": [s.to_dict() for s in self.stage_progression],
            "timeline": [e.to_dict() for e in self.timeline],
        }


class TimelineService:
    """Core domain service for timeline normalization, validation, and reconstruction."""

    def __init__(self, repo: Optional[TimelineRepository] = None) -> None:
        self.repo = repo or TimelineRepository()

    def reconstruct_order_timeline(
        self,
        order_id: int,
        persist_stage_actuals: bool = True,
        record_audit: bool = True,
        job_id: Optional[int] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> ReconstructedTimeline:
        """Reconstruct the factual chronological timeline for an order.

        Args:
            order_id: Primary key of target order.
            persist_stage_actuals: If True, updates order_stages actual timestamps in DB.
            record_audit: If True, writes an audit_log record.
            job_id: Optional analysis_jobs primary key to associate.
            conn: Optional caller-managed database connection.

        Returns:
            ReconstructedTimeline data structure.
        """
        # 1. Fetch order details (enforce order existence)
        order = self.repo.get_order(order_id, conn=conn)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist or access is unauthorized.",
                status_code=404,
            )

        # 2. Fetch planned stages and raw events
        stages_data = self.repo.get_order_stages(order_id, conn=conn)
        raw_events = self.repo.get_order_events(order_id, conn=conn)

        # 3. Execute pure reconstruction logic
        reconstructed = self.build_timeline_from_data(
            order=order,
            planned_stages=stages_data,
            raw_events=raw_events,
            job_id=job_id,
        )

        # 4. Optional database persistence of verified stage actuals and delivery time
        if persist_stage_actuals:
            self._persist_reconstruction_effects(order_id, reconstructed, record_audit, conn=conn)

        return reconstructed

    def build_timeline_from_data(
        self,
        order: Dict[str, Any],
        planned_stages: List[Dict[str, Any]],
        raw_events: List[Dict[str, Any]],
        job_id: Optional[int] = None,
    ) -> ReconstructedTimeline:
        """Pure algorithmic reconstruction of timeline and stage progression from raw data.

        Independent of database connections; fully deterministic and unit-testable.
        """
        order_id = int(order["order_id"])
        now_utc = datetime.now(timezone.utc)
        reconstructed_at_str = format_iso_utc(now_utc) or ""

        placed_at_str = format_iso_utc(parse_to_utc_datetime(order["placed_at"])) or ""
        expected_delivery_at_str = format_iso_utc(parse_to_utc_datetime(order["expected_delivery_at"])) or ""
        actual_delivery_at_str = (
            format_iso_utc(parse_to_utc_datetime(order["actual_delivery_at"]))
            if order.get("actual_delivery_at")
            else None
        )

        # Handle orders with 0 events
        if not raw_events:
            empty_stages = self._build_empty_stages(planned_stages)
            summary = TimelineSummary(
                is_complete=False,
                has_anomalies=False,
                total_events=0,
                valid_event_count=0,
                duplicate_count=0,
                conflict_count=0,
                out_of_order_count=0,
                customer_summary="No operational events have been recorded for this order yet.",
                warnings=[],
            )
            return ReconstructedTimeline(
                order_id=order_id,
                order_status=str(order.get("status", "PLACED")),
                external_order_ref=str(order.get("external_order_ref", "")),
                placed_at=placed_at_str,
                expected_delivery_at=expected_delivery_at_str,
                actual_delivery_at=actual_delivery_at_str,
                reconstructed_at=reconstructed_at_str,
                job_id=job_id,
                timeline=[],
                stage_progression=empty_stages,
                summary=summary,
            )

        # 1. Normalize timestamps and sort deterministically
        # Sort key: (occurred_at_dt ASC, received_at_dt ASC, event_id ASC)
        prepared_events = []
        for e in raw_events:
            occ_dt = parse_to_utc_datetime(e["occurred_at"])
            rec_dt = parse_to_utc_datetime(e["received_at"])
            prepared_events.append({
                **e,
                "_occurred_dt": occ_dt,
                "_received_dt": rec_dt,
            })

        sorted_events = sorted(
            prepared_events,
            key=lambda item: (item["_occurred_dt"], item["_received_dt"], int(item["event_id"])),
        )

        # 2. Stage lookup dictionaries
        stage_by_id = {s["stage_id"]: s for s in planned_stages}
        stage_by_code = {s["stage_code"]: s for s in planned_stages}

        # 3. Process events: Detect duplicates, conflicts, out-of-order ingestion
        timeline_events, anomalies_summary = self._classify_and_validate_events(
            order_id=order_id,
            sorted_events=sorted_events,
            stage_by_id=stage_by_id,
            stage_by_code=stage_by_code,
        )

        # 4. Reconstruct stage progression from valid events
        stage_progression, stage_warnings, verified_delivered_at = self._reconstruct_stages(
            planned_stages=planned_stages,
            timeline_events=timeline_events,
        )

        # Determine updated order status based on valid operational events
        current_order_status = str(order.get("status", "PLACED"))
        valid_non_conflicts = [e for e in timeline_events if not e.is_duplicate and not e.is_conflict]

        has_cancelled = any(e.event_type == "CANCELLED" for e in valid_non_conflicts)
        has_returned = any(e.event_type == "RETURNED" for e in valid_non_conflicts)
        has_delivered = any(e.event_type in DELIVERY_CONFIRMATION_EVENT_TYPES for e in valid_non_conflicts)

        if has_cancelled:
            current_order_status = "CANCELLED"
            # Cancelled orders must never have actual_delivery_at set
            actual_delivery_at_str = None
        elif has_returned:
            current_order_status = "RETURNED"
            # If delivery occurred prior to return, preserve actual_delivery_at_str
        elif has_delivered or verified_delivered_at:
            current_order_status = "DELIVERED"
            if verified_delivered_at:
                actual_delivery_at_str = format_iso_utc(verified_delivered_at)

        # 5. Build customer summary narrative
        all_warnings = anomalies_summary["warnings"] + stage_warnings
        customer_summary = self._generate_customer_summary(
            order_status=current_order_status,
            stages=stage_progression,
            timeline_events=timeline_events,
            actual_delivery_at_str=actual_delivery_at_str,
        )

        summary = TimelineSummary(
            is_complete=self._check_timeline_completion(stage_progression, timeline_events),
            has_anomalies=len(all_warnings) > 0 or anomalies_summary["has_anomalies"],
            total_events=len(timeline_events),
            valid_event_count=anomalies_summary["valid_count"],
            duplicate_count=anomalies_summary["duplicate_count"],
            conflict_count=anomalies_summary["conflict_count"],
            out_of_order_count=anomalies_summary["out_of_order_count"],
            customer_summary=customer_summary,
            warnings=all_warnings,
        )

        return ReconstructedTimeline(
            order_id=order_id,
            order_status=current_order_status,
            external_order_ref=str(order.get("external_order_ref", "")),
            placed_at=placed_at_str,
            expected_delivery_at=expected_delivery_at_str,
            actual_delivery_at=actual_delivery_at_str,
            reconstructed_at=reconstructed_at_str,
            job_id=job_id,
            timeline=timeline_events,
            stage_progression=stage_progression,
            summary=summary,
        )

    def _classify_and_validate_events(
        self,
        order_id: int,
        sorted_events: List[Dict[str, Any]],
        stage_by_id: Dict[int, Dict[str, Any]],
        stage_by_code: Dict[str, Dict[str, Any]],
    ) -> Tuple[List[TimelineEvent], Dict[str, Any]]:
        """Validate events, classify evidence, and identify duplicates and conflicts."""
        timeline_events: List[TimelineEvent] = []
        seen_event_signatures: Dict[Tuple[str, datetime, Optional[str]], int] = {}

        # Precompute out-of-order receipt arrivals:
        # Sort events by receipt order (received_at ASC, event_id ASC).
        # An event arrived out-of-order if its occurred_at timestamp is earlier
        # than the maximum occurred_at timestamp of all events received prior to it.
        events_by_receipt = sorted(
            sorted_events,
            key=lambda item: (item["_received_dt"], int(item["event_id"])),
        )
        out_of_order_info: Dict[int, Tuple[int, datetime]] = {}
        max_seen_occ_dt: Optional[datetime] = None
        max_seen_occ_id: Optional[int] = None

        for item in events_by_receipt:
            item_id = int(item["event_id"])
            item_occ = item["_occurred_dt"]
            if max_seen_occ_dt is not None and item_occ < max_seen_occ_dt:
                out_of_order_info[item_id] = (max_seen_occ_id, max_seen_occ_dt)
            elif max_seen_occ_dt is None or item_occ > max_seen_occ_dt:
                max_seen_occ_dt = item_occ
                max_seen_occ_id = item_id

        valid_count = 0
        duplicate_count = 0
        conflict_count = 0
        out_of_order_count = 0
        warnings: List[str] = []

        confirmed_terminal_event: Optional[Dict[str, Any]] = None
        max_seen_sequence_no: int = -1

        for idx, raw_e in enumerate(sorted_events, start=1):
            e_id = int(raw_e["event_id"])
            e_type = str(raw_e.get("event_type", "")).upper()
            occ_dt = raw_e["_occurred_dt"]
            rec_dt = raw_e["_received_dt"]
            src_type = str(raw_e.get("source_type", "UNKNOWN"))

            # Resolve stage info
            raw_stage_id = raw_e.get("stage_id")
            raw_stage_code = raw_e.get("stage_code")
            sequence_no = raw_e.get("sequence_no")
            is_inferred = False

            if raw_stage_id and raw_stage_id in stage_by_id:
                stage_info = stage_by_id[raw_stage_id]
                stage_code = stage_info["stage_code"]
                sequence_no = stage_info["sequence_no"]
                stage_id = raw_stage_id
            elif raw_stage_code and raw_stage_code in stage_by_code:
                stage_info = stage_by_code[raw_stage_code]
                stage_id = stage_info["stage_id"]
                stage_code = raw_stage_code
                sequence_no = stage_info["sequence_no"]
            else:
                # Infer stage from event type convention if unmapped
                inferred_code = EVENT_TYPE_STAGE_HINTS.get(e_type)
                if inferred_code and inferred_code in stage_by_code:
                    stage_info = stage_by_code[inferred_code]
                    stage_id = stage_info["stage_id"]
                    stage_code = inferred_code
                    sequence_no = stage_info["sequence_no"]
                    is_inferred = True
                else:
                    stage_id = None
                    stage_code = None
                    sequence_no = None

            event_warnings: List[str] = []
            related_ids: List[int] = []
            is_duplicate = False
            duplicate_of = None
            is_conflict = False
            validation_status = "VALID"
            evidence_classification = "INFERRED" if is_inferred else "FACT"

            # 1. Exact Duplicate Detection: same (event_type, occurred_at, stage_code)
            sig = (e_type, occ_dt, stage_code)
            if sig in seen_event_signatures:
                is_duplicate = True
                duplicate_of = seen_event_signatures[sig]
                duplicate_count += 1
                validation_status = "DUPLICATE"
                evidence_classification = "DATA_QUALITY_ISSUE"
                msg = f"Duplicate event: matches event {duplicate_of} on type '{e_type}' and timestamp."
                event_warnings.append(msg)
                warnings.append(f"Event {e_id}: {msg}")
                related_ids.append(duplicate_of)
            else:
                seen_event_signatures[sig] = e_id

            # 2. Out-of-Order Ingestion Detection (received later, occurred earlier)
            if not is_duplicate and e_id in out_of_order_info:
                out_of_order_count += 1
                prior_id, prior_occ = out_of_order_info[e_id]
                msg = (
                    f"Out-of-order ingestion: received after event {prior_id} "
                    f"but occurred earlier ({format_iso_utc(occ_dt)} < {format_iso_utc(prior_occ)})."
                )
                event_warnings.append(msg)
                warnings.append(f"Event {e_id}: {msg}")
                related_ids.append(prior_id)
                if validation_status == "VALID":
                    validation_status = "OUT_OF_ORDER"

            # 3. Conflicting Event Detection
            if not is_duplicate:
                # Conflict A: Event arrives after terminal state has already been reached
                if confirmed_terminal_event and occ_dt > confirmed_terminal_event["occ_dt"]:
                    is_conflict = True
                    conflict_count += 1
                    validation_status = "CONFLICTING"
                    evidence_classification = "DATA_QUALITY_ISSUE"
                    term_id = confirmed_terminal_event["event_id"]
                    term_type = confirmed_terminal_event["event_type"]
                    msg = (
                        f"Post-terminal conflict: event occurs after order was already confirmed "
                        f"as '{term_type}' by event {term_id}."
                    )
                    event_warnings.append(msg)
                    warnings.append(f"Event {e_id}: {msg}")
                    related_ids.append(term_id)

                # Conflict B: Inverted stage sequence (e.g. stage sequence drops backwards chronologically)
                if sequence_no is not None:
                    if sequence_no < max_seen_sequence_no:
                        # Prior events occurred at later stages
                        is_conflict = True
                        conflict_count += 1
                        validation_status = "CONFLICTING"
                        evidence_classification = "DATA_QUALITY_ISSUE"
                        msg = (
                            f"Stage sequence inversion: stage sequence {sequence_no} ('{stage_code}') "
                            f"occurred after later stage sequence {max_seen_sequence_no}."
                        )
                        event_warnings.append(msg)
                        warnings.append(f"Event {e_id}: {msg}")
                    else:
                        max_seen_sequence_no = sequence_no

                # Check if this event confirms a terminal state
                if e_type in TERMINAL_EVENT_TYPES and not is_conflict:
                    confirmed_terminal_event = {
                        "event_id": e_id,
                        "event_type": e_type,
                        "occ_dt": occ_dt,
                    }

            if validation_status == "VALID":
                valid_count += 1

            if is_inferred:
                event_warnings.append(f"Stage '{stage_code}' inferred from event type '{e_type}'.")

            timeline_event = TimelineEvent(
                event_id=e_id,
                order_id=order_id,
                stage_id=stage_id,
                stage_code=stage_code,
                sequence_no=sequence_no,
                event_type=e_type,
                occurred_at=format_iso_utc(occ_dt) or "",
                received_at=format_iso_utc(rec_dt) or "",
                source_type=src_type,
                source_provider=raw_e.get("source_provider"),
                source_event_id=raw_e.get("source_event_id"),
                location=raw_e.get("location"),
                description=raw_e.get("description"),
                raw_payload=raw_e.get("raw_payload"),
                sequence_position=idx,
                validation_status=validation_status,
                evidence_classification=evidence_classification,
                is_duplicate=is_duplicate,
                duplicate_of=duplicate_of,
                is_conflict=is_conflict,
                is_inferred=is_inferred,
                warnings=event_warnings,
                related_event_ids=list(set(related_ids)),
            )

            timeline_events.append(timeline_event)

        summary_data = {
            "valid_count": valid_count,
            "duplicate_count": duplicate_count,
            "conflict_count": conflict_count,
            "out_of_order_count": out_of_order_count,
            "has_anomalies": bool(duplicate_count or conflict_count or out_of_order_count),
            "warnings": warnings,
        }
        return timeline_events, summary_data

    def _reconstruct_stages(
        self,
        planned_stages: List[Dict[str, Any]],
        timeline_events: List[TimelineEvent],
    ) -> Tuple[List[ReconstructedStage], List[str], Optional[datetime]]:
        """Reconstruct operational stage timings, progress, and stage transition anomalies."""
        reconstructed_stages: List[ReconstructedStage] = []
        stage_warnings: List[str] = []
        verified_delivery_dt: Optional[datetime] = None

        # Filter events eligible for progression (exclude exact duplicates and severe conflicts)
        valid_events = [e for e in timeline_events if not e.is_duplicate and not e.is_conflict]

        # Group valid events by stage_code
        events_by_stage_code: Dict[str, List[TimelineEvent]] = {}
        for e in valid_events:
            if e.stage_code:
                events_by_stage_code.setdefault(e.stage_code, []).append(e)

        # Iterate through planned stages in sequence order
        latest_active_seq: int = -1

        # Pre-identify active stages to detect gaps
        active_stage_codes = set(events_by_stage_code.keys())
        stages_with_events = [s for s in planned_stages if s["stage_code"] in active_stage_codes]
        if stages_with_events:
            latest_active_seq = max(s["sequence_no"] for s in stages_with_events)

        for i, stage_def in enumerate(planned_stages):
            s_code = stage_def["stage_code"]
            s_seq = int(stage_def["sequence_no"])
            s_id = stage_def.get("stage_id")

            p_start_dt = (
                parse_to_utc_datetime(stage_def["planned_start_at"])
                if stage_def.get("planned_start_at")
                else None
            )
            p_end_dt = (
                parse_to_utc_datetime(stage_def["planned_end_at"])
                if stage_def.get("planned_end_at")
                else None
            )

            matched_events = events_by_stage_code.get(s_code, [])
            matched_event_ids = [e.event_id for e in matched_events]
            stage_anomalies: List[str] = []

            actual_start_dt: Optional[datetime] = None
            actual_end_dt: Optional[datetime] = None
            status = "PENDING"

            if matched_events:
                # Earliest event in stage establishes actual start
                start_event = matched_events[0]
                actual_start_dt = parse_to_utc_datetime(start_event.occurred_at)

                # Check if multiple start/entry events exist (repeated stage events)
                if len(matched_events) > 1:
                    # Check if repeated distinct occurrences happened
                    unique_types = {e.event_type for e in matched_events}
                    if len(unique_types) < len(matched_events):
                        msg = f"Repeated event occurrences in stage '{s_code}'."
                        stage_anomalies.append(msg)

                # Determine completion:
                # 1. Delivery confirmed vs other terminal events
                has_delivery_event = any(e.event_type in DELIVERY_CONFIRMATION_EVENT_TYPES for e in matched_events)
                has_terminal_event = any(e.event_type in TERMINAL_EVENT_TYPES for e in matched_events)

                if (s_code == "DELIVERED" and matched_events) or has_delivery_event:
                    status = "COMPLETED"
                    last_event = matched_events[-1]
                    actual_end_dt = parse_to_utc_datetime(last_event.occurred_at)
                    verified_delivery_dt = actual_end_dt
                elif has_terminal_event:
                    # Non-delivery terminal events (CANCELLED, RETURNED) complete the stage without verifying delivery
                    status = "COMPLETED"
                    last_event = matched_events[-1]
                    actual_end_dt = parse_to_utc_datetime(last_event.occurred_at)
                # 2. Subsequent planned stage has already started
                elif i + 1 < len(planned_stages):
                    subsequent_stages = planned_stages[i + 1:]
                    next_active_events: List[TimelineEvent] = []
                    for next_s in subsequent_stages:
                        next_active_events.extend(events_by_stage_code.get(next_s["stage_code"], []))

                    if next_active_events:
                        status = "COMPLETED"
                        # Completion time is handover/start of next stage
                        next_start = min(parse_to_utc_datetime(e.occurred_at) for e in next_active_events)
                        actual_end_dt = next_start
                    else:
                        status = "IN_PROGRESS"
                        actual_end_dt = None
                else:
                    # Final planned stage without explicit delivery event
                    status = "IN_PROGRESS"
                    actual_end_dt = None

            else:
                # No events for this stage
                if latest_active_seq > s_seq:
                    # A subsequent stage has started, so this stage was skipped!
                    status = "SKIPPED"
                    gap_msg = (
                        f"Missing stage transition: Stage '{s_code}' (sequence {s_seq}) "
                        "was skipped with no recorded events."
                    )
                    stage_anomalies.append(gap_msg)
                    stage_warnings.append(gap_msg)
                else:
                    status = "PENDING"

            # Compute stage duration and variance
            planned_duration_min: Optional[int] = None
            actual_duration_min: Optional[int] = None
            variance_min: Optional[int] = None
            time_lost_min = 0
            time_recovered_min = 0

            if p_start_dt and p_end_dt:
                planned_duration_min = max(0, int((p_end_dt - p_start_dt).total_seconds() / 60))

            if actual_start_dt and actual_end_dt:
                actual_duration_min = max(0, int((actual_end_dt - actual_start_dt).total_seconds() / 60))
                if planned_duration_min is not None:
                    variance_min = actual_duration_min - planned_duration_min
                    time_lost_min = max(0, variance_min)
                    time_recovered_min = max(0, -variance_min)

            reconstructed_stage = ReconstructedStage(
                stage_id=s_id,
                stage_code=s_code,
                sequence_no=s_seq,
                status=status,
                planned_start_at=format_iso_utc(p_start_dt),
                planned_end_at=format_iso_utc(p_end_dt),
                actual_start_at=format_iso_utc(actual_start_dt),
                actual_end_at=format_iso_utc(actual_end_dt),
                event_count=len(matched_events),
                event_ids=matched_event_ids,
                planned_duration_minutes=planned_duration_min,
                actual_duration_minutes=actual_duration_min,
                variance_minutes=variance_min,
                time_lost_minutes=time_lost_min,
                time_recovered_minutes=time_recovered_min,
                anomalies=stage_anomalies,
            )
            reconstructed_stages.append(reconstructed_stage)

        return reconstructed_stages, stage_warnings, verified_delivery_dt

    def _build_empty_stages(self, planned_stages: List[Dict[str, Any]]) -> List[ReconstructedStage]:
        """Construct pending stage progression for orders without events."""
        stages: List[ReconstructedStage] = []
        for s in planned_stages:
            p_start = parse_to_utc_datetime(s["planned_start_at"]) if s.get("planned_start_at") else None
            p_end = parse_to_utc_datetime(s["planned_end_at"]) if s.get("planned_end_at") else None
            p_dur = int((p_end - p_start).total_seconds() / 60) if p_start and p_end else None

            stages.append(
                ReconstructedStage(
                    stage_id=s.get("stage_id"),
                    stage_code=s["stage_code"],
                    sequence_no=int(s["sequence_no"]),
                    status="PENDING",
                    planned_start_at=format_iso_utc(p_start),
                    planned_end_at=format_iso_utc(p_end),
                    actual_start_at=None,
                    actual_end_at=None,
                    event_count=0,
                    event_ids=[],
                    planned_duration_minutes=p_dur,
                    actual_duration_minutes=None,
                    variance_minutes=None,
                    time_lost_minutes=0,
                    time_recovered_minutes=0,
                    anomalies=[],
                )
            )
        return stages

    def _check_timeline_completion(
        self,
        stages: List[ReconstructedStage],
        events: List[TimelineEvent],
    ) -> bool:
        """Evaluate whether order timeline reached full lifecycle completion without fatal gaps."""
        if not events:
            return False

        # Terminal event confirmed
        has_delivery_event = any(
            e.event_type in TERMINAL_EVENT_TYPES and not e.is_duplicate and not e.is_conflict
            for e in events
        )

        # Check if terminal stage is completed
        delivered_stage = next((s for s in stages if s.stage_code == "DELIVERED"), None)
        if delivered_stage and delivered_stage.status == "COMPLETED":
            return True

        return has_delivery_event

    def _generate_customer_summary(
        self,
        order_status: str,
        stages: List[ReconstructedStage],
        timeline_events: List[TimelineEvent],
        actual_delivery_at_str: Optional[str],
    ) -> str:
        """Generate a jargon-free, customer-friendly progress narrative.

        Strictly omits internal supplier fault attribution, cost data, and internal carrier disputes.
        """
        if not timeline_events:
            return "No status updates have been received for this order yet."

        if order_status == "CANCELLED":
            return "Your order has been cancelled."

        if order_status == "RETURNED":
            return "Your order has been returned."

        # Check if delivered
        delivered_stage = next((s for s in stages if s.stage_code == "DELIVERED"), None)
        has_delivery = any(
            e.event_type in DELIVERY_CONFIRMATION_EVENT_TYPES
            for e in timeline_events
            if not e.is_duplicate and not e.is_conflict
        )
        if (delivered_stage and delivered_stage.status == "COMPLETED") or has_delivery or actual_delivery_at_str:
            time_str = actual_delivery_at_str or "recently"
            return f"Your package was successfully delivered on {time_str}."

        # Identify current active stage
        active_stage = next((s for s in stages if s.status == "IN_PROGRESS"), None)
        if active_stage:
            code = active_stage.stage_code
            if code == "SELLER_PROCESSING":
                return "Your order is currently being prepared and packaged by the seller."
            elif code == "DISPATCH":
                return "Your package is ready and awaiting courier dispatch."
            elif code == "LINEHAUL_TRANSPORT":
                return "Your package is in transit between fulfillment hubs."
            elif code == "LAST_MILE":
                return "Your package has arrived at the local facility and is out for delivery."

        # Fallback to last recorded event description
        last_event = timeline_events[-1]
        desc = last_event.description or last_event.event_type.replace("_", " ").title()
        return f"Current update: {desc}."

    def _persist_reconstruction_effects(
        self,
        order_id: int,
        reconstructed: ReconstructedTimeline,
        record_audit: bool,
        conn: Optional[pyodbc.Connection] = None,
    ) -> None:
        """Persist verified stage actuals and audit trail entry within a database transaction."""
        def execute_persists(active_conn: pyodbc.Connection) -> None:
            # 1. Update order_stages with actual start, actual end, and status
            for s in reconstructed.stage_progression:
                if s.stage_id:
                    act_start = parse_to_utc_datetime(s.actual_start_at) if s.actual_start_at else None
                    act_end = parse_to_utc_datetime(s.actual_end_at) if s.actual_end_at else None
                    self.repo.update_stage_actuals(
                        stage_id=s.stage_id,
                        actual_start_at=act_start,
                        actual_end_at=act_end,
                        status=s.status,
                        conn=active_conn,
                    )

            # 2. Update order status and actual_delivery_at
            if reconstructed.order_status == "CANCELLED":
                self.repo.update_order_status(
                    order_id=order_id,
                    status="CANCELLED",
                    conn=active_conn,
                )
            elif reconstructed.order_status == "RETURNED":
                if reconstructed.actual_delivery_at:
                    del_dt = parse_to_utc_datetime(reconstructed.actual_delivery_at)
                    self.repo.update_order_actual_delivery(
                        order_id=order_id,
                        actual_delivery_at=del_dt,
                        status="RETURNED",
                        conn=active_conn,
                    )
                else:
                    self.repo.update_order_status(
                        order_id=order_id,
                        status="RETURNED",
                        conn=active_conn,
                    )
            elif reconstructed.actual_delivery_at:
                del_dt = parse_to_utc_datetime(reconstructed.actual_delivery_at)
                self.repo.update_order_actual_delivery(
                    order_id=order_id,
                    actual_delivery_at=del_dt,
                    status="DELIVERED",
                    conn=active_conn,
                )

            # 3. Insert audit log record
            if record_audit:
                meta = {
                    "total_events": reconstructed.summary.total_events,
                    "valid_event_count": reconstructed.summary.valid_event_count,
                    "duplicate_count": reconstructed.summary.duplicate_count,
                    "conflict_count": reconstructed.summary.conflict_count,
                    "is_complete": reconstructed.summary.is_complete,
                }
                self.repo.insert_audit_log(
                    actor_user_id=None,
                    action="TIMELINE_RECONSTRUCTED",
                    entity_type="ORDER",
                    entity_id=order_id,
                    metadata_json=json.dumps(meta),
                    conn=active_conn,
                )

        if conn is not None:
            execute_persists(conn)
        else:
            with get_db_connection() as managed_conn:
                execute_persists(managed_conn)
                managed_conn.commit()

    # =========================================================================
    # Analysis Job Management & Background Integration
    # =========================================================================
    def create_reconstruction_job(
        self,
        order_id: int,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create or retrieve a TIMELINE_RECONSTRUCTION analysis job for an order.

        Args:
            order_id: Target order identifier.
            idempotency_key: Optional unique key; defaults to deterministic order reconstruction key.

        Returns:
            Dictionary representing the analysis job.
        """
        # Validate order exists
        order = self.repo.get_order(order_id)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )

        effective_key = idempotency_key or f"job-timeline-recon-order-{order_id}-{uuid.uuid4().hex[:8]}"
        return self.repo.create_analysis_job(
            order_id=order_id,
            idempotency_key=effective_key,
            job_type="TIMELINE_RECONSTRUCTION",
        )

    def execute_reconstruction_job(
        self,
        job_id: int,
        persist_stage_actuals: bool = True,
    ) -> ReconstructedTimeline:
        """Execute a queued or running TIMELINE_RECONSTRUCTION analysis job.

        Transitions job status: QUEUED -> RUNNING -> COMPLETED (or FAILED on error).
        """
        job = self.repo.get_analysis_job_by_id(job_id)
        if not job:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Analysis job {job_id} does not exist.",
                status_code=404,
            )

        if job["job_type"] != "TIMELINE_RECONSTRUCTION":
            raise APIError(
                code="INVALID_JOB_TYPE",
                message=f"Job {job_id} is of type '{job['job_type']}', expected 'TIMELINE_RECONSTRUCTION'.",
                status_code=400,
            )

        order_id = int(job["order_id"])

        # Completed-job fencing: do not reset already COMPLETED job to RUNNING
        if job["status"] == "COMPLETED":
            return self.reconstruct_order_timeline(
                order_id=order_id,
                persist_stage_actuals=False,
                record_audit=False,
                job_id=job_id,
            )

        # Mark job RUNNING with atomic state transition guard
        now_dt = datetime.now(timezone.utc)
        claimed = self.repo.update_analysis_job_status(
            job_id=job_id,
            status="RUNNING",
            started_at=now_dt,
            expected_statuses=["QUEUED", "FAILED"],
        )
        if not claimed:
            # Check if another worker just completed it
            current = self.repo.get_analysis_job_by_id(job_id)
            if current and current["status"] == "COMPLETED":
                return self.reconstruct_order_timeline(
                    order_id=order_id,
                    persist_stage_actuals=False,
                    record_audit=False,
                    job_id=job_id,
                )
            raise APIError(
                code="CONCURRENT_JOB_EXECUTION",
                message=f"Job {job_id} is currently being processed by another worker.",
                status_code=409,
            )

        try:
            reconstructed = self.reconstruct_order_timeline(
                order_id=order_id,
                persist_stage_actuals=persist_stage_actuals,
                record_audit=True,
                job_id=job_id,
            )

            # Mark job COMPLETED
            completed_dt = datetime.now(timezone.utc)
            self.repo.update_analysis_job_status(
                job_id=job_id,
                status="COMPLETED",
                completed_at=completed_dt,
            )
            return reconstructed

        except Exception as ex:
            logger.exception("Failed executing timeline reconstruction job %d: %s", job_id, ex)
            self.repo.update_analysis_job_status(
                job_id=job_id,
                status="FAILED",
                error_message=str(ex),
                completed_at=datetime.now(timezone.utc),
            )
            raise

    def get_analysis_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        """Retrieve details of an analysis job."""
        return self.repo.get_analysis_job_by_id(job_id)

    def list_order_analysis_jobs(self, order_id: int) -> List[Dict[str, Any]]:
        """Retrieve all analysis jobs for an order."""
        # Validate order exists
        order = self.repo.get_order(order_id)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )
        return self.repo.get_analysis_jobs_by_order(order_id)
