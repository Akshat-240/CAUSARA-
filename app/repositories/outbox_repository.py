"""Outbox repository layer for transactional outbox persistence, atomic claiming, and status lifecycle."""

from datetime import datetime
import logging
from typing import Any, Dict, List, Optional
import pyodbc
from app.database.connection import get_db_connection

logger = logging.getLogger(__name__)


def _rows_to_dicts(cursor: pyodbc.Cursor, rows: List[pyodbc.Row]) -> List[Dict[str, Any]]:
    """Convert pyodbc rows into a list of column-keyed dictionaries."""
    if not rows or not cursor.description:
        return []
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


def _row_to_dict(cursor: pyodbc.Cursor, row: Optional[pyodbc.Row]) -> Optional[Dict[str, Any]]:
    """Convert a single pyodbc row into a column-keyed dictionary."""
    if row is None or not cursor.description:
        return None
    columns = [col[0] for col in cursor.description]
    return dict(zip(columns, row))


class OutboxRepository:
    """Data access repository for transactional outbox operations on dbo.outbox_events."""

    def insert_outbox_event(
        self,
        cursor: pyodbc.Cursor,
        event_type: str,
        aggregate_type: str,
        aggregate_id: int,
        payload_json: str,
    ) -> int:
        """Atomically insert a new pending outbox message within an existing transaction.

        Args:
            cursor: Active database cursor operating within caller's transaction.
            event_type: Domain event identifier (e.g. 'ORDER_EVENT_INGESTED').
            aggregate_type: Target domain boundary (e.g. 'ORDER_EVENT').
            aggregate_id: Primary key of originating aggregate (e.g. event_id).
            payload_json: Serialized JSON payload containing dispatch details.

        Returns:
            The generated outbox_id.
        """
        query = """
            INSERT INTO dbo.outbox_events (
                event_type, aggregate_type, aggregate_id, payload_json, status, retry_count
            )
            OUTPUT INSERTED.outbox_id
            VALUES (?, ?, ?, ?, 'PENDING', 0);
        """
        cursor.execute(query, (event_type, aggregate_type, aggregate_id, payload_json))
        row = cursor.fetchone()
        if not row:
            raise RuntimeError("Failed to retrieve generated outbox_id after insert.")
        return int(row[0])

    def claim_pending_messages(
        self,
        cursor: pyodbc.Cursor,
        batch_size: int = 10,
        lease_seconds: int = 300,
        max_retries: int = 3,
    ) -> List[Dict[str, Any]]:
        """Atomically claim a batch of claimable messages using SQL Server locking.

        Claims both 'PENDING' messages (whose next_retry_at has elapsed or is NULL)
        and expired 'PROCESSING' messages whose lease has lapsed (worker crash recovery).
        Uses UPDLOCK, READPAST, and ROWLOCK to ensure multiple concurrent workers never block
        or claim the identical message.

        For expired 'PROCESSING' messages:
        - retry_count is atomically incremented.
        - If retry_count + 1 >= max_retries, transitions to 'FAILED' (dead-letter) without lock.
        - Otherwise, re-claimed with a fresh lease and sanitized recovery diagnostic.

        Args:
            cursor: Active database cursor.
            batch_size: Maximum messages to claim in this batch.
            lease_seconds: Lease validity duration in seconds (default 300s = 5m).
            max_retries: Maximum permitted retries before marking FAILED on lease expiry.

        Returns:
            List of claimed outbox message dictionaries with newly stamped locked_at.
        """
        query = """
            WITH Claimable AS (
                SELECT TOP (?) outbox_id, event_type, aggregate_type, aggregate_id,
                               payload_json, status, retry_count, created_at, locked_at,
                               error_message, next_retry_at
                FROM dbo.outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
                WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= SYSUTCDATETIME()))
                   OR (status = 'PROCESSING' AND locked_at < DATEADD(second, -?, SYSUTCDATETIME()))
                ORDER BY outbox_id ASC
            )
            UPDATE Claimable
            SET status = CASE
                    WHEN status = 'PROCESSING' AND retry_count + 1 >= ? THEN 'FAILED'
                    ELSE 'PROCESSING'
                END,
                retry_count = CASE
                    WHEN status = 'PROCESSING' THEN retry_count + 1
                    ELSE retry_count
                END,
                locked_at = CASE
                    WHEN status = 'PROCESSING' AND retry_count + 1 >= ? THEN NULL
                    ELSE CAST(SYSUTCDATETIME() AS DATETIME2(6))
                END,
                next_retry_at = NULL,
                error_message = CASE
                    WHEN status = 'PROCESSING' AND retry_count + 1 >= ?
                        THEN 'Maximum retries exhausted (worker lease expired)'
                    WHEN status = 'PROCESSING'
                        THEN 'Worker lease expired; reclaimed by recovery worker'
                    ELSE error_message
                END
            OUTPUT INSERTED.outbox_id, INSERTED.event_type, INSERTED.aggregate_type,
                   INSERTED.aggregate_id, INSERTED.payload_json, INSERTED.status,
                   INSERTED.retry_count, INSERTED.created_at, INSERTED.locked_at,
                   INSERTED.error_message, INSERTED.next_retry_at;
        """
        cursor.execute(query, (batch_size, lease_seconds, max_retries, max_retries, max_retries))
        return _rows_to_dicts(cursor, cursor.fetchall())

    def mark_published(
        self,
        cursor: pyodbc.Cursor,
        outbox_id: int,
        expected_locked_at: datetime,
    ) -> bool:
        """Mark a claimed outbox message as PUBLISHED with optimistic lease ownership verification.

        Args:
            cursor: Active database cursor.
            outbox_id: ID of the outbox message to complete.
            expected_locked_at: Timestamp captured when this worker claimed the message.

        Returns:
            True if updated successfully; False if worker ownership was lost (lease expired).
        """
        query = """
            UPDATE dbo.outbox_events
            SET status = 'PUBLISHED',
                published_at = SYSUTCDATETIME(),
                next_retry_at = NULL,
                error_message = NULL
            WHERE outbox_id = ?
              AND status = 'PROCESSING'
              AND locked_at = ?;
        """
        cursor.execute(query, (outbox_id, expected_locked_at))
        return cursor.rowcount == 1

    def mark_failed_or_retry(
        self,
        cursor: pyodbc.Cursor,
        outbox_id: int,
        expected_locked_at: datetime,
        error_message: str,
        is_transient: bool = True,
        max_retries: int = 3,
        retry_delay_seconds: Optional[int] = None,
    ) -> bool:
        """Record processing failure and transition message to PENDING (retry) or FAILED (dead-letter).

        Verifies that caller still holds ownership via expected_locked_at before updating.
        When is_transient is True and retries remain, schedules next_retry_at with backoff delay.

        Args:
            cursor: Active database cursor.
            outbox_id: Outbox record ID.
            expected_locked_at: Worker's lease claim timestamp.
            error_message: Sanitized error description.
            is_transient: True if error may resolve on retry; False for permanent/validation errors.
            max_retries: Maximum permitted retries before marking FAILED.
            retry_delay_seconds: Delay before message becomes claimable again (exponential backoff).

        Returns:
            True if record was updated; False if ownership was lost.
        """
        sanitized_error = error_message[:1000] if error_message else "Unknown processing failure"

        if is_transient:
            if retry_delay_seconds is not None and retry_delay_seconds > 0:
                query = """
                    UPDATE dbo.outbox_events
                    SET status = CASE WHEN retry_count + 1 < ? THEN 'PENDING' ELSE 'FAILED' END,
                        retry_count = retry_count + 1,
                        locked_at = NULL,
                        next_retry_at = CASE
                            WHEN retry_count + 1 < ? THEN DATEADD(second, ?, SYSUTCDATETIME())
                            ELSE NULL
                        END,
                        error_message = ?
                    WHERE outbox_id = ?
                      AND status = 'PROCESSING'
                      AND locked_at = ?;
                """
                cursor.execute(
                    query,
                    (max_retries, max_retries, retry_delay_seconds, sanitized_error, outbox_id, expected_locked_at),
                )
            else:
                query = """
                    UPDATE dbo.outbox_events
                    SET status = CASE WHEN retry_count + 1 < ? THEN 'PENDING' ELSE 'FAILED' END,
                        retry_count = retry_count + 1,
                        locked_at = NULL,
                        next_retry_at = NULL,
                        error_message = ?
                    WHERE outbox_id = ?
                      AND status = 'PROCESSING'
                      AND locked_at = ?;
                """
                cursor.execute(query, (max_retries, sanitized_error, outbox_id, expected_locked_at))
        else:
            # Permanent error: immediately transition to FAILED without re-queueing
            query = """
                UPDATE dbo.outbox_events
                SET status = 'FAILED',
                    retry_count = retry_count + 1,
                    locked_at = NULL,
                    next_retry_at = NULL,
                    error_message = ?
                WHERE outbox_id = ?
                  AND status = 'PROCESSING'
                  AND locked_at = ?;
            """
            cursor.execute(query, (sanitized_error, outbox_id, expected_locked_at))

        return cursor.rowcount == 1

    def get_outbox_event_by_id(
        self,
        outbox_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a single outbox record by its primary key outbox_id."""
        query = """
            SELECT outbox_id, event_type, aggregate_type, aggregate_id,
                   payload_json, status, retry_count, created_at,
                   published_at, locked_at, error_message, next_retry_at
            FROM dbo.outbox_events
            WHERE outbox_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (outbox_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (outbox_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_statistics(
        self,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Aggregate high-level outbox processing metrics for observability."""
        query = """
            SELECT
                ISNULL(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
                ISNULL(SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END), 0) AS processing_count,
                ISNULL(SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END), 0) AS published_count,
                ISNULL(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed_count,
                ISNULL(SUM(retry_count), 0) AS total_retries,
                MAX(CASE
                    WHEN status = 'PENDING' THEN DATEDIFF(second, created_at, SYSUTCDATETIME())
                    ELSE NULL
                END) AS oldest_pending_age_seconds
            FROM dbo.outbox_events;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query)
                row = cur.fetchone()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query)
                row = cur.fetchone()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()
