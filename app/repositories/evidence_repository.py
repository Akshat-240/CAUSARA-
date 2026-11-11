"""Repository for evidence metadata and operational attachments."""

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


class EvidenceRepository:
    """Data access repository for dbo.evidence."""

    def insert_evidence(
        self,
        order_id: int,
        uploaded_by: int,
        blob_uri: str,
        file_name: str,
        content_type: str,
        sha256_hash: str,
        status: str = "ACTIVE",
        event_id: Optional[int] = None,
        case_id: Optional[int] = None,
        upload_expires_at: Optional[datetime] = None,
        completed_at: Optional[datetime] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Insert a new evidence record and return the inserted row."""
        query = """
            INSERT INTO dbo.evidence (
                order_id, event_id, case_id, uploaded_by, blob_uri, file_name,
                content_type, sha256_hash, status, upload_expires_at, completed_at, uploaded_at
            )
            OUTPUT INSERTED.evidence_id, INSERTED.order_id, INSERTED.event_id, INSERTED.case_id,
                   INSERTED.uploaded_by, INSERTED.blob_uri, INSERTED.file_name, INSERTED.content_type,
                   INSERTED.sha256_hash, INSERTED.status, INSERTED.upload_expires_at,
                   INSERTED.completed_at, INSERTED.uploaded_at
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ISNULL(?, DATEADD(HOUR, 24, SYSUTCDATETIME())), ?, SYSUTCDATETIME());
        """
        params = (
            order_id, event_id, case_id, uploaded_by, blob_uri, file_name,
            content_type, sha256_hash, status, upload_expires_at, completed_at,
        )

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, params)
                row = cur.fetchone()
                managed_conn.commit()
                return _row_to_dict(cur, row) or {}
            finally:
                cur.close()

    def get_evidence_by_id(
        self,
        evidence_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve evidence record by primary key."""
        query = """
            SELECT evidence_id, order_id, event_id, case_id, uploaded_by,
                   blob_uri, file_name, content_type, sha256_hash, status,
                   upload_expires_at, completed_at, uploaded_at
            FROM dbo.evidence
            WHERE evidence_id = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (evidence_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (evidence_id,))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def list_evidence(
        self,
        order_id: int,
        event_id: Optional[int] = None,
        case_id: Optional[int] = None,
        status: Optional[str] = "ACTIVE",
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """List evidence records for an order with optional filters."""
        clauses = ["order_id = ?"]
        params: list = [order_id]

        if event_id is not None:
            clauses.append("event_id = ?")
            params.append(event_id)

        if case_id is not None:
            clauses.append("case_id = ?")
            params.append(case_id)

        if status:
            clauses.append("status = ?")
            params.append(status)

        query = f"""
            SELECT evidence_id, order_id, event_id, case_id, uploaded_by,
                   blob_uri, file_name, content_type, sha256_hash, status,
                   upload_expires_at, completed_at, uploaded_at
            FROM dbo.evidence
            WHERE {" AND ".join(clauses)}
            ORDER BY uploaded_at DESC, evidence_id DESC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, tuple(params))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, tuple(params))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def list_evidence_by_stage(
        self,
        order_id: int,
        stage_id: int,
        status: Optional[str] = "ACTIVE",
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """List evidence records linked to any event in a specific order stage."""
        query = """
            SELECT ev.evidence_id, ev.order_id, ev.event_id, ev.case_id, ev.uploaded_by,
                   ev.blob_uri, ev.file_name, ev.content_type, ev.sha256_hash, ev.status,
                   ev.upload_expires_at, ev.completed_at, ev.uploaded_at
            FROM dbo.evidence ev
            JOIN dbo.order_events oe ON ev.event_id = oe.event_id AND ev.order_id = oe.order_id
            WHERE ev.order_id = ? AND oe.stage_id = ?
        """
        params: list = [order_id, stage_id]
        if status:
            query += " AND ev.status = ?"
            params.append(status)
        query += " ORDER BY ev.uploaded_at DESC, ev.evidence_id DESC;"

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, tuple(params))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, tuple(params))
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

    def validate_order_event_relationship(
        self,
        order_id: int,
        event_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Verify that an event belongs to the specified order."""
        query = "SELECT 1 FROM dbo.order_events WHERE order_id = ? AND event_id = ?;"
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id, event_id))
                return cur.fetchone() is not None
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id, event_id))
                return cur.fetchone() is not None
            finally:
                cur.close()

    def validate_order_case_relationship(
        self,
        order_id: int,
        case_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Verify that a decision case belongs to the specified order."""
        query = "SELECT 1 FROM dbo.decision_cases WHERE order_id = ? AND case_id = ?;"
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (order_id, case_id))
                return cur.fetchone() is not None
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (order_id, case_id))
                return cur.fetchone() is not None
            finally:
                cur.close()

    def validate_user_exists(
        self,
        user_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> bool:
        """Verify that a user exists."""
        query = "SELECT 1 FROM dbo.users WHERE user_id = ?;"
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (user_id,))
                return cur.fetchone() is not None
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (user_id,))
                return cur.fetchone() is not None
            finally:
                cur.close()
