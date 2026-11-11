"""Repository layer for timeline reconstruction, stage actuals persistence, and analysis jobs."""

from datetime import datetime
import logging
from typing import Any, Dict, List, Optional
import pyodbc

from app.database.connection import get_db_connection

logger = logging.getLogger(__name__)


def _row_to_dict(cursor: pyodbc.Cursor, row: Optional[pyodbc.Row]) -> Optional[Dict[str, Any]]:
    """Convert a pyodbc Row into a dictionary using cursor description."""
    if row is None or not cursor.description:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def _rows_to_dicts(cursor: pyodbc.Cursor, rows: List[pyodbc.Row]) -> List[Dict[str, Any]]:
    """Convert a list of pyodbc Rows into a list of dictionaries."""
    if not rows or not cursor.description:
        return []
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


class TimelineRepository:
    """Data access repository for timeline queries, stage tracking, and analysis jobs."""

    def get_order(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve order metadata by order_id."""
        query = """
            SELECT order_id, seller_id, customer_user_id, external_order_ref,
                   placed_at, expected_delivery_at, actual_delivery_at, status, created_at
            FROM dbo.orders
            WHERE order_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_order_stages(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all defined stages for an order, sorted by sequence number ascending."""
        query = """
            SELECT stage_id, order_id, stage_code, sequence_no,
                   planned_start_at, planned_end_at, actual_start_at, actual_end_at, status
            FROM dbo.order_stages
            WHERE order_id = ?
            ORDER BY sequence_no ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def get_order_events(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all raw order events with stage metadata in deterministic chronological sequence.

        Deterministic sort order:
        1. occurred_at ASC
        2. received_at ASC
        3. event_id ASC
        """
        query = """
            SELECT e.event_id, e.order_id, e.stage_id, s.stage_code, s.sequence_no,
                   e.event_type, e.occurred_at, e.received_at, e.source_type,
                   e.source_provider, e.source_event_id, e.idempotency_key,
                   e.location, e.description, e.raw_payload
            FROM dbo.order_events e
            LEFT JOIN dbo.order_stages s ON e.stage_id = s.stage_id
            WHERE e.order_id = ?
            ORDER BY e.occurred_at ASC, e.received_at ASC, e.event_id ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def update_stage_actuals(
        self,
        stage_id: int,
        actual_start_at: Optional[datetime],
        actual_end_at: Optional[datetime],
        status: str,
        conn: pyodbc.Connection,
    ) -> None:
        """Update actual execution timestamps and status on an order stage within caller's transaction."""
        query = """
            UPDATE dbo.order_stages
            SET actual_start_at = ?,
                actual_end_at = ?,
                status = ?
            WHERE stage_id = ?;
        """
        cur = conn.cursor()
        try:
            cur.execute(query, (actual_start_at, actual_end_at, status, stage_id))
        finally:
            cur.close()

    def update_order_actual_delivery(
        self,
        order_id: int,
        actual_delivery_at: datetime,
        status: Optional[str],
        conn: pyodbc.Connection,
    ) -> None:
        """Update order actual_delivery_at and optionally status upon delivery confirmation."""
        if status:
            query = """
                UPDATE dbo.orders
                SET actual_delivery_at = ?,
                    status = ?
                WHERE order_id = ?;
            """
            params = (actual_delivery_at, status, order_id)
        else:
            query = """
                UPDATE dbo.orders
                SET actual_delivery_at = ?
                WHERE order_id = ?;
            """
            params = (actual_delivery_at, order_id)

        cur = conn.cursor()
        try:
            cur.execute(query, params)
        finally:
            cur.close()

    def update_order_status(
        self,
        order_id: int,
        status: str,
        conn: pyodbc.Connection,
    ) -> None:
        """Update order status upon terminal event (e.g. CANCELLED, RETURNED)."""
        query = """
            UPDATE dbo.orders
            SET status = ?
            WHERE order_id = ?;
        """
        cur = conn.cursor()
        try:
            cur.execute(query, (status, order_id))
        finally:
            cur.close()

    def create_analysis_job(
        self,
        order_id: int,
        idempotency_key: str,
        job_type: str = "TIMELINE_RECONSTRUCTION",
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Create a new queued analysis job or retrieve the existing job if idempotency key matches.

        Returns:
            Dictionary representation of the newly created or existing job.
        """
        select_query = """
            SELECT job_id, order_id, case_id, decision_id, job_type, status,
                   idempotency_key, retry_count, created_at, started_at, completed_at, error_message
            FROM dbo.analysis_jobs
            WHERE idempotency_key = ?;
        """

        insert_query = """
            INSERT INTO dbo.analysis_jobs (
                order_id, case_id, decision_id, job_type, status,
                idempotency_key, retry_count, created_at
            )
            OUTPUT INSERTED.job_id, INSERTED.order_id, INSERTED.case_id, INSERTED.decision_id,
                   INSERTED.job_type, INSERTED.status, INSERTED.idempotency_key,
                   INSERTED.retry_count, INSERTED.created_at, INSERTED.started_at,
                   INSERTED.completed_at, INSERTED.error_message
            VALUES (?, NULL, NULL, ?, 'QUEUED', ?, 0, SYSUTCDATETIME());
        """

        if conn is not None:
            cur = conn.cursor()
            try:
                # Check for existing job to guarantee idempotency
                cur.execute(select_query, (idempotency_key,))
                existing = _row_to_dict(cur, cur.fetchone())
                if existing:
                    return existing

                cur.execute(insert_query, (order_id, job_type, idempotency_key))
                row = cur.fetchone()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(select_query, (idempotency_key,))
                existing = _row_to_dict(cur, cur.fetchone())
                if existing:
                    return existing

                cur.execute(insert_query, (order_id, job_type, idempotency_key))
                row = cur.fetchone()
                managed_conn.commit()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

    def get_analysis_job_by_id(
        self,
        job_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a specific analysis job by job_id."""
        query = """
            SELECT job_id, order_id, case_id, decision_id, job_type, status,
                   idempotency_key, retry_count, created_at, started_at, completed_at, error_message
            FROM dbo.analysis_jobs
            WHERE job_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (job_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (job_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_analysis_jobs_by_order(
        self,
        order_id: int,
        job_type: Optional[str] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve analysis jobs associated with an order."""
        if job_type:
            query = """
                SELECT job_id, order_id, case_id, decision_id, job_type, status,
                       idempotency_key, retry_count, created_at, started_at, completed_at, error_message
                FROM dbo.analysis_jobs
                WHERE order_id = ? AND job_type = ?
                ORDER BY created_at DESC;
            """
            params: tuple = (order_id, job_type)
        else:
            query = """
                SELECT job_id, order_id, case_id, decision_id, job_type, status,
                       idempotency_key, retry_count, created_at, started_at, completed_at, error_message
                FROM dbo.analysis_jobs
                WHERE order_id = ?
                ORDER BY created_at DESC;
            """
            params = (order_id,)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def update_analysis_job_status(
        self,
        job_id: int,
        status: str,
        error_message: Optional[str] = None,
        started_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        expected_statuses: Optional[List[str]] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Update lifecycle state and timestamps of an analysis job."""
        sanitized_error = error_message[:1000] if error_message else None

        where_clause = "WHERE job_id = ?"
        param_list: list = [status, started_at, completed_at, sanitized_error, job_id]

        if expected_statuses:
            placeholders = ", ".join(["?"] * len(expected_statuses))
            where_clause += f" AND status IN ({placeholders})"
            param_list.extend(expected_statuses)

        query = f"""
            UPDATE dbo.analysis_jobs
            SET status = ?,
                started_at = ISNULL(?, started_at),
                completed_at = ?,
                error_message = ?
            {where_clause};
        """
        params = tuple(param_list)

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                return cur.rowcount == 1
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                managed_conn.commit()
                return cur.rowcount == 1
            finally:
                cur.close()

    def insert_audit_log(
        self,
        actor_user_id: Optional[int],
        action: str,
        entity_type: str,
        entity_id: int,
        metadata_json: Optional[str],
        conn: Optional[pyodbc.Connection] = None,
    ) -> None:
        """Record an immutable audit log entry."""
        query = """
            INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at, metadata_json)
            VALUES (?, ?, ?, ?, SYSUTCDATETIME(), ?);
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (actor_user_id, action, entity_type, entity_id, metadata_json))
            finally:
                cur.close()
            return

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (actor_user_id, action, entity_type, entity_id, metadata_json))
                managed_conn.commit()
            finally:
                cur.close()
