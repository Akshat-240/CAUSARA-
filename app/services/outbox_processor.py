"""Background processing engine for transactional outbox events with lease-based concurrency."""

from dataclasses import dataclass, field
from datetime import datetime
import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional
import uuid
import pyodbc

from app.database.connection import get_db_connection
from app.repositories.event_repository import EventRepository
from app.repositories.outbox_repository import OutboxRepository

logger = logging.getLogger(__name__)

# Sanitization regex to strip connection strings, passwords, and sensitive keys
SECRET_PATTERN = re.compile(
    r"(password|pwd|secret|token|key|bearer|connection\s*string)\s*[=:]\s*([^\s;,]+)",
    re.IGNORECASE,
)


def sanitize_error_message(error: Any) -> str:
    """Sanitize error messages to eliminate credentials, connection strings, and sensitive payload data."""
    raw_str = str(error) if error is not None else "Unknown error"
    # Redact sensitive key-value pairs
    sanitized = SECRET_PATTERN.sub(r"\1=***REDACTED***", raw_str)
    # Strip newline formatting and normalize whitespace
    sanitized = " ".join(sanitized.split())
    # Truncate to SQL column constraint boundary (1000 chars)
    return sanitized[:1000]


@dataclass
class ProcessingResult:
    """Outcome of processing an individual outbox record."""

    outbox_id: int
    success: bool
    status: str
    retry_count: int
    error_message: Optional[str] = None
    ownership_lost: bool = False


@dataclass
class ProcessingBatchSummary:
    """Aggregated summary of a processed batch."""

    worker_id: str
    claimed_count: int
    published_count: int = 0
    failed_count: int = 0
    retried_count: int = 0
    ownership_lost_count: int = 0
    results: List[ProcessingResult] = field(default_factory=list)


class OutboxProcessor:
    """Independent background processor consuming pending outbox messages.

    Implements:
    - Unique worker instance identification.
    - Concurrency-safe atomic claiming using SQL Server UPDLOCK/READPAST.
    - Lease expiration and crashed-worker recovery.
    - Optimistic lease ownership verification on acknowledgement.
    - Idempotent downstream execution preventing duplicate downstream side-effects.
    - Transient vs permanent error classification with bounded retries.
    """

    def __init__(
        self,
        worker_id: Optional[str] = None,
        batch_size: int = 10,
        lease_seconds: int = 300,
        max_retries: int = 3,
        base_backoff_seconds: float = 1.0,
        backoff_multiplier: float = 2.0,
        max_backoff_seconds: float = 300.0,
        outbox_repo: Optional[OutboxRepository] = None,
        event_repo: Optional[EventRepository] = None,
        downstream_handler: Optional[Callable[[Dict[str, Any], pyodbc.Connection], None]] = None,
    ) -> None:
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        self.batch_size = max(1, batch_size)
        self.lease_seconds = max(1, lease_seconds)
        self.max_retries = max(1, max_retries)
        self.base_backoff_seconds = max(0.0, base_backoff_seconds)
        self.backoff_multiplier = max(1.0, backoff_multiplier)
        self.max_backoff_seconds = max(1.0, max_backoff_seconds)
        self.outbox_repo = outbox_repo or OutboxRepository()
        self.event_repo = event_repo or EventRepository()
        self._downstream_handler = downstream_handler

    def compute_backoff_delay(self, retry_count: int) -> int:
        """Calculate exponential backoff delay in seconds for the given retry count."""
        raw_delay = self.base_backoff_seconds * (self.backoff_multiplier ** retry_count)
        bounded_delay = min(float(self.max_backoff_seconds), raw_delay)
        return int(round(bounded_delay))

    def process_batch(self, limit: Optional[int] = None) -> ProcessingBatchSummary:
        """Claim and process a single batch of claimable outbox messages.

        Can be called by background schedulers, timer functions, or CLI workers.
        """
        effective_limit = limit if (limit and limit > 0) else self.batch_size
        summary = ProcessingBatchSummary(worker_id=self.worker_id, claimed_count=0)

        with get_db_connection() as conn:
            cur = conn.cursor()
            try:
                # 1. Atomically claim batch using concurrency-safe lock
                claimed_messages = self.outbox_repo.claim_pending_messages(
                    cursor=cur,
                    batch_size=effective_limit,
                    lease_seconds=self.lease_seconds,
                    max_retries=self.max_retries,
                )
                conn.commit()
            except Exception as ex:
                logger.error("[%s] Failed to claim outbox messages: %s", self.worker_id, ex)
                conn.rollback()
                return summary
            finally:
                cur.close()

        summary.claimed_count = len(claimed_messages)
        if not claimed_messages:
            return summary

        logger.info("[%s] Claimed %d outbox message(s) for processing", self.worker_id, len(claimed_messages))

        # 2. Process each claimed message independently
        for msg in claimed_messages:
            # If the claimed message was marked FAILED during claim (hard crash retry exhaustion)
            if msg.get("status") == "FAILED":
                res = ProcessingResult(
                    outbox_id=int(msg["outbox_id"]),
                    success=False,
                    status="FAILED",
                    retry_count=int(msg.get("retry_count", 0)),
                    error_message=msg.get("error_message"),
                )
                summary.results.append(res)
                summary.failed_count += 1
                continue

            result = self._process_single_message(msg)
            summary.results.append(result)
            if result.ownership_lost:
                summary.ownership_lost_count += 1
            elif result.success:
                summary.published_count += 1
            elif result.status == "FAILED":
                summary.failed_count += 1
            elif result.status == "PENDING":
                summary.retried_count += 1

        return summary

    def _process_single_message(self, message: Dict[str, Any]) -> ProcessingResult:
        """Process an individual claimed outbox record within an isolated transaction."""
        outbox_id = int(message["outbox_id"])
        expected_locked_at = message["locked_at"]
        event_type = message.get("event_type", "")
        raw_payload = message.get("payload_json", "{}")

        # 1. Validate payload structure (permanent error if malformed JSON)
        try:
            payload = json.loads(raw_payload) if isinstance(raw_payload, str) else raw_payload
            if not isinstance(payload, dict):
                raise ValueError("Outbox payload_json must deserialize to a JSON object.")
        except Exception as ex:
            sanitized = f"Malformed payload JSON: {sanitize_error_message(ex)}"
            logger.warning("[%s] Permanent validation error for outbox %d: %s", self.worker_id, outbox_id, sanitized)
            return self._record_failure(outbox_id, expected_locked_at, sanitized, is_transient=False)

        # 2. Execute downstream effect within an isolated transaction
        try:
            with get_db_connection() as conn:
                cur = conn.cursor()

                # Dispatch downstream processing
                if self._downstream_handler:
                    self._downstream_handler(payload, conn)
                else:
                    self._default_downstream_dispatch(event_type, payload, conn)

                # Atomically mark as PUBLISHED with optimistic ownership check
                published_ok = self.outbox_repo.mark_published(
                    cursor=cur,
                    outbox_id=outbox_id,
                    expected_locked_at=expected_locked_at,
                )
                if not published_ok:
                    conn.rollback()
                    logger.warning(
                        "[%s] Stale worker lease lost for outbox %d; message was reclaimed by another worker",
                        self.worker_id,
                        outbox_id,
                    )
                    return ProcessingResult(
                        outbox_id=outbox_id,
                        success=False,
                        status="PROCESSING",
                        retry_count=message.get("retry_count", 0),
                        error_message="Worker lease lost before acknowledgement",
                        ownership_lost=True,
                    )

                conn.commit()
                logger.info("[%s] Successfully published outbox event %d", self.worker_id, outbox_id)
                return ProcessingResult(
                    outbox_id=outbox_id,
                    success=True,
                    status="PUBLISHED",
                    retry_count=message.get("retry_count", 0),
                )

        except PermanentProcessingError as perm_ex:
            sanitized = sanitize_error_message(perm_ex)
            logger.warning("[%s] Permanent failure processing outbox %d: %s", self.worker_id, outbox_id, sanitized)
            return self._record_failure(outbox_id, expected_locked_at, sanitized, is_transient=False)

        except Exception as trans_ex:
            sanitized = sanitize_error_message(trans_ex)
            logger.warning("[%s] Transient failure processing outbox %d: %s", self.worker_id, outbox_id, sanitized)
            current_retries = int(message.get("retry_count", 0))
            delay = self.compute_backoff_delay(current_retries)
            return self._record_failure(
                outbox_id=outbox_id,
                expected_locked_at=expected_locked_at,
                error_message=sanitized,
                is_transient=True,
                retry_delay_seconds=delay,
            )

    def _default_downstream_dispatch(
        self,
        event_type: str,
        payload: Dict[str, Any],
        conn: pyodbc.Connection,
    ) -> None:
        """Default domain processing for Causara order events.

        Guarantees downstream idempotency via unique constraints on dbo.analysis_jobs.
        """
        if event_type == "ORDER_EVENT_INGESTED":
            event_id = payload.get("event_id")
            order_id = payload.get("order_id")

            if not event_id or not order_id:
                raise PermanentProcessingError(f"Missing required event_id or order_id in payload: {payload}")

            # Verify originating event exists in dbo.order_events
            originating_event = self.event_repo.get_event_by_id(event_id, conn=conn)
            if not originating_event:
                raise PermanentProcessingError(f"Originating order_event {event_id} does not exist in database.")

            # Downstream effect: Ensure timeline reconstruction analysis job exists
            job_idempotency_key = f"job-timeline-recon-event-{event_id}"
            cur = conn.cursor()
            try:
                # Check existing job to avoid tripping unique constraint
                cur.execute(
                    "SELECT job_id, status FROM dbo.analysis_jobs WHERE idempotency_key = ?;",
                    (job_idempotency_key,),
                )
                existing_job = cur.fetchone()

                if not existing_job:
                    cur.execute(
                        """
                        INSERT INTO dbo.analysis_jobs (
                            order_id, case_id, decision_id, job_type, status,
                            idempotency_key, retry_count, created_at
                        )
                        VALUES (?, NULL, NULL, 'TIMELINE_RECONSTRUCTION', 'QUEUED', ?, 0, SYSUTCDATETIME());
                        """,
                        (order_id, job_idempotency_key),
                    )

                # Record internal audit trail entry
                cur.execute(
                    """
                    INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at)
                    VALUES (NULL, 'OUTBOX_EVENT_PROCESSED', 'ORDER_EVENT', ?, SYSUTCDATETIME());
                    """,
                    (event_id,),
                )
            finally:
                cur.close()

    def _record_failure(
        self,
        outbox_id: int,
        expected_locked_at: datetime,
        error_message: str,
        is_transient: bool,
        retry_delay_seconds: Optional[int] = None,
    ) -> ProcessingResult:
        """Record failure status with ownership check in an isolated connection."""
        with get_db_connection() as conn:
            cur = conn.cursor()
            try:
                updated_ok = self.outbox_repo.mark_failed_or_retry(
                    cursor=cur,
                    outbox_id=outbox_id,
                    expected_locked_at=expected_locked_at,
                    error_message=error_message,
                    is_transient=is_transient,
                    max_retries=self.max_retries,
                    retry_delay_seconds=retry_delay_seconds,
                )
                conn.commit()

                if not updated_ok:
                    logger.warning(
                        "[%s] Ownership lost while recording failure for outbox %d",
                        self.worker_id,
                        outbox_id,
                    )
                    return ProcessingResult(
                        outbox_id=outbox_id,
                        success=False,
                        status="PROCESSING",
                        retry_count=0,
                        error_message="Ownership lost during failure update",
                        ownership_lost=True,
                    )

                # Fetch updated status
                cur.execute("SELECT status, retry_count FROM dbo.outbox_events WHERE outbox_id = ?;", (outbox_id,))
                row = cur.fetchone()
                status = row[0] if row else "FAILED"
                retry_count = int(row[1]) if row else 0

                return ProcessingResult(
                    outbox_id=outbox_id,
                    success=False,
                    status=status,
                    retry_count=retry_count,
                    error_message=error_message,
                )
            finally:
                cur.close()


class PermanentProcessingError(Exception):
    """Exception raised for unrecoverable errors (e.g. malformed data, missing entities)."""
    pass
