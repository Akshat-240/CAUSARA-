"""Data access layer for orders, stages, and append-only order events."""

from typing import Any, Dict, List, Optional
import pyodbc
from app.database.connection import get_db_connection


def _row_to_dict(cursor: pyodbc.Cursor, row: Optional[pyodbc.Row]) -> Optional[Dict[str, Any]]:
    """Convert a pyodbc Row into a dictionary using cursor description."""
    if row is None:
        return None
    columns = [column[0] for column in cursor.description]
    return dict(zip(columns, row))


def _rows_to_dicts(cursor: pyodbc.Cursor, rows: List[pyodbc.Row]) -> List[Dict[str, Any]]:
    """Convert a list of pyodbc Rows into a list of dictionaries."""
    if not rows:
        return []
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


class EventRepository:
    """Repository handling SQL operations for orders, stages, and order events."""

    def get_order(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve order summary by order_id."""
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

    def get_stage_by_code(
        self,
        order_id: int,
        stage_code: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a specific order stage by stage_code within an order."""
        query = """
            SELECT stage_id, order_id, stage_code, sequence_no,
                   planned_start_at, planned_end_at, actual_start_at, actual_end_at, status
            FROM dbo.order_stages
            WHERE order_id = ? AND stage_code = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id, stage_code))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id, stage_code))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_stage_by_id(
        self,
        stage_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve an order stage by stage_id."""
        query = """
            SELECT stage_id, order_id, stage_code, sequence_no,
                   planned_start_at, planned_end_at, actual_start_at, actual_end_at, status
            FROM dbo.order_stages
            WHERE stage_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (stage_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (stage_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_event_by_idempotency_key(
        self,
        idempotency_key: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve an existing order event by unique idempotency_key."""
        query = """
            SELECT event_id, order_id, stage_id, event_type, occurred_at,
                   received_at, source_type, source_provider, source_event_id,
                   idempotency_key, location, description, raw_payload
            FROM dbo.order_events
            WHERE idempotency_key = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (idempotency_key,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (idempotency_key,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def get_event_by_id(
        self,
        event_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve an event record by its primary key event_id."""
        query = """
            SELECT event_id, order_id, stage_id, event_type, occurred_at,
                   received_at, source_type, source_provider, source_event_id,
                   idempotency_key, location, description, raw_payload
            FROM dbo.order_events
            WHERE event_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (event_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (event_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def insert_order_event(
        self,
        event: Dict[str, Any],
        conn: Optional[pyodbc.Connection] = None,
    ) -> int:
        """Insert a new immutable order event and return the generated event_id."""
        insert_query = """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, occurred_at, source_type,
                source_provider, source_event_id, idempotency_key, location,
                description, raw_payload
            )
            OUTPUT INSERTED.event_id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """
        params = (
            event["order_id"],
            event.get("stage_id"),
            event["event_type"],
            event["occurred_at"],
            event["source_type"],
            event.get("source_provider"),
            event.get("source_event_id"),
            event["idempotency_key"],
            event.get("location"),
            event.get("description"),
            event.get("raw_payload"),
        )
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(insert_query, params)
                row = cur.fetchone()
                if not row:
                    raise RuntimeError("Failed to retrieve generated event_id after insert.")
                return int(row[0])
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(insert_query, params)
                row = cur.fetchone()
                if not row:
                    raise RuntimeError("Failed to retrieve generated event_id after insert.")
                return int(row[0])
            finally:
                cur.close()

    def get_events_for_order(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all historical events for an order in chronological sequence."""
        query = """
            SELECT e.event_id, e.order_id, e.stage_id, s.stage_code,
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
