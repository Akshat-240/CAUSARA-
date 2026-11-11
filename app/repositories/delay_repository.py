"""Repository for delay investigation cases and delay graph edges."""

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


class DelayRepository:
    """Data access repository for dbo.decision_cases and dbo.delay_edges."""

    def get_or_create_case(
        self,
        order_id: int,
        created_by: int,
        case_title: Optional[str] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Retrieve existing active decision case for order or create a new one."""
        select_query = """
            SELECT case_id, order_id, created_by, case_title, status, opened_at, closed_at
            FROM dbo.decision_cases
            WHERE order_id = ? AND status IN ('OPEN', 'ANALYZING', 'PENDING_APPROVAL');
        """
        title = case_title or f"Delay Investigation Order #{order_id}"
        insert_query = """
            INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
            OUTPUT INSERTED.case_id, INSERTED.order_id, INSERTED.created_by,
                   INSERTED.case_title, INSERTED.status, INSERTED.opened_at, INSERTED.closed_at
            VALUES (?, ?, ?, 'ANALYZING', SYSUTCDATETIME());
        """

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(select_query, (order_id,))
                existing = _row_to_dict(cur, cur.fetchone())
                if existing:
                    return existing
                cur.execute(insert_query, (order_id, created_by, title))
                return _row_to_dict(cur, cur.fetchone()) or {}
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(select_query, (order_id,))
                existing = _row_to_dict(cur, cur.fetchone())
                if existing:
                    return existing
                cur.execute(insert_query, (order_id, created_by, title))
                row = cur.fetchone()
                managed_conn.commit()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

    def get_case_by_id(
        self,
        case_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a decision case by case_id."""
        query = """
            SELECT case_id, order_id, created_by, case_title, status, opened_at, closed_at
            FROM dbo.decision_cases
            WHERE case_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def update_case_status(
        self,
        case_id: int,
        status: str,
        closed_at: Optional[datetime] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Update decision case status and closed timestamp."""
        query = """
            UPDATE dbo.decision_cases
            SET status = ?,
                closed_at = ?
            WHERE case_id = ?;
        """
        params = (status, closed_at, case_id)

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

    def delete_delay_edges_for_case(
        self,
        case_id: int,
        conn: pyodbc.Connection,
    ) -> None:
        """Clear existing delay edges for a case prior to re-analysis."""
        query = "DELETE FROM dbo.delay_edges WHERE case_id = ?;"
        cur = conn.cursor()
        try:
            cur.execute(query, (case_id,))
        finally:
            cur.close()

    def insert_delay_edge(
        self,
        case_id: int,
        from_stage_id: int,
        to_stage_id: int,
        edge_type: str,
        evidence_class: str,
        estimated_delay_minutes: Optional[int] = None,
        explanation: Optional[str] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Insert a delay graph edge."""
        query = """
            SET NOCOUNT ON;
            DECLARE @inserted_ids TABLE (edge_id BIGINT);
            INSERT INTO dbo.delay_edges (
                case_id, from_stage_id, to_stage_id, edge_type,
                evidence_class, estimated_delay_minutes, explanation
            )
            OUTPUT INSERTED.edge_id INTO @inserted_ids
            VALUES (?, ?, ?, ?, ?, ?, ?);
            SELECT edge_id FROM @inserted_ids;
        """
        params = (
            case_id, from_stage_id, to_stage_id, edge_type,
            evidence_class, estimated_delay_minutes, explanation,
        )

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                edge_id = row[0] if row else None
                return {
                    "edge_id": edge_id,
                    "case_id": case_id,
                    "from_stage_id": from_stage_id,
                    "to_stage_id": to_stage_id,
                    "edge_type": edge_type,
                    "evidence_class": evidence_class,
                    "estimated_delay_minutes": estimated_delay_minutes,
                    "explanation": explanation,
                }
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                managed_conn.commit()
                edge_id = row[0] if row else None
                return {
                    "edge_id": edge_id,
                    "case_id": case_id,
                    "from_stage_id": from_stage_id,
                    "to_stage_id": to_stage_id,
                    "edge_type": edge_type,
                    "evidence_class": evidence_class,
                    "estimated_delay_minutes": estimated_delay_minutes,
                    "explanation": explanation,
                }
            finally:
                cur.close()

    def list_delay_edges_by_case(
        self,
        case_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve all delay edges for a decision case."""
        query = """
            SELECT de.edge_id, de.case_id, de.from_stage_id, de.to_stage_id,
                   de.edge_type, de.evidence_class, de.estimated_delay_minutes, de.explanation,
                   s1.stage_code AS from_stage_code, s1.sequence_no AS from_sequence_no,
                   s2.stage_code AS to_stage_code, s2.sequence_no AS to_sequence_no
            FROM dbo.delay_edges de
            JOIN dbo.order_stages s1 ON de.from_stage_id = s1.stage_id
            JOIN dbo.order_stages s2 ON de.to_stage_id = s2.stage_id
            WHERE de.case_id = ?
            ORDER BY de.edge_id ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (case_id,))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()
