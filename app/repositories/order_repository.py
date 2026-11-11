"""Data access repository for order entity management and stage baseline tracking."""

from datetime import datetime
import logging
from typing import Any, Dict, List, Optional, Tuple
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


class OrderRepository:
    """Data access repository for dbo.orders and dbo.order_stages."""

    def create_order(
        self,
        seller_id: int,
        customer_user_id: int,
        external_order_ref: str,
        placed_at: datetime,
        expected_delivery_at: datetime,
        status: str = "PLACED",
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Create a new order record."""
        query = """
            SET NOCOUNT ON;
            DECLARE @inserted_ids TABLE (order_id BIGINT);
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref,
                placed_at, expected_delivery_at, status, created_at
            )
            OUTPUT INSERTED.order_id INTO @inserted_ids
            VALUES (?, ?, ?, ?, ?, ?, SYSUTCDATETIME());
            SELECT o.order_id, o.seller_id, o.customer_user_id, o.external_order_ref,
                   o.placed_at, o.expected_delivery_at, o.actual_delivery_at,
                   o.status, o.created_at
            FROM dbo.orders o
            JOIN @inserted_ids ids ON o.order_id = ids.order_id;
        """
        params = (seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status)

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

    def create_stage(
        self,
        order_id: int,
        stage_code: str,
        sequence_no: int,
        planned_start_at: Optional[datetime] = None,
        planned_end_at: Optional[datetime] = None,
        status: str = "PENDING",
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Create an operational stage record for an order."""
        query = """
            SET NOCOUNT ON;
            DECLARE @inserted_ids TABLE (stage_id BIGINT);
            INSERT INTO dbo.order_stages (
                order_id, stage_code, sequence_no,
                planned_start_at, planned_end_at, status
            )
            OUTPUT INSERTED.stage_id INTO @inserted_ids
            VALUES (?, ?, ?, ?, ?, ?);
            SELECT s.stage_id, s.order_id, s.stage_code, s.sequence_no,
                   s.planned_start_at, s.planned_end_at, s.actual_start_at,
                   s.actual_end_at, s.status
            FROM dbo.order_stages s
            JOIN @inserted_ids ids ON s.stage_id = ids.stage_id;
        """
        params = (order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status)

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

    def get_order_by_id(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve order details with joined seller and customer metadata."""
        query = """
            SELECT o.order_id, o.seller_id, o.customer_user_id, o.external_order_ref,
                   o.placed_at, o.expected_delivery_at, o.actual_delivery_at,
                   o.status, o.created_at,
                   s.business_name AS seller_business_name,
                   u.full_name AS customer_name,
                   u.email AS customer_email,
                   (
                       SELECT TOP 1 dc.case_id
                       FROM dbo.decision_cases dc
                       WHERE dc.order_id = o.order_id
                       ORDER BY (CASE WHEN dc.status IN ('OPEN', 'ANALYZING', 'PENDING_APPROVAL') THEN 0 ELSE 1 END),
                                dc.case_id DESC
                   ) AS active_case_id
            FROM dbo.orders o
            JOIN dbo.sellers s ON o.seller_id = s.seller_id
            JOIN dbo.users u ON o.customer_user_id = u.user_id
            WHERE o.order_id = ?;
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

    def get_order_by_seller_ref(
        self,
        seller_id: int,
        external_order_ref: str,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve order by unique seller ID and external order reference."""
        query = """
            SELECT order_id, seller_id, customer_user_id, external_order_ref,
                   placed_at, expected_delivery_at, actual_delivery_at, status, created_at
            FROM dbo.orders
            WHERE seller_id = ? AND external_order_ref = ?;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query, (seller_id, external_order_ref))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query, (seller_id, external_order_ref))
                return _row_to_dict(cur, cur.fetchone())
            finally:
                cur.close()

    def list_orders(
        self,
        status: Optional[str] = None,
        seller_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List orders with optional filtering and total count."""
        where_clauses = []
        params: List[Any] = []

        if status:
            where_clauses.append("o.status = ?")
            params.append(status)
        if seller_id is not None:
            where_clauses.append("o.seller_id = ?")
            params.append(seller_id)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        count_query = f"SELECT COUNT(*) FROM dbo.orders o {where_sql};"
        data_query = f"""
            SELECT o.order_id, o.seller_id, o.customer_user_id, o.external_order_ref,
                   o.placed_at, o.expected_delivery_at, o.actual_delivery_at,
                   o.status, o.created_at,
                   s.business_name AS seller_business_name,
                   u.full_name AS customer_name,
                   (
                       SELECT TOP 1 dc.case_id
                       FROM dbo.decision_cases dc
                       WHERE dc.order_id = o.order_id
                       ORDER BY (CASE WHEN dc.status IN ('OPEN', 'ANALYZING', 'PENDING_APPROVAL') THEN 0 ELSE 1 END),
                                dc.case_id DESC
                   ) AS active_case_id
            FROM dbo.orders o
            JOIN dbo.sellers s ON o.seller_id = s.seller_id
            JOIN dbo.users u ON o.customer_user_id = u.user_id
            {where_sql}
            ORDER BY o.order_id DESC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        """

        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(count_query, params)
                total = cur.fetchone()[0]
                cur.execute(data_query, params + [offset, limit])
                rows = _rows_to_dicts(cur, cur.fetchall())
                return rows, total
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(count_query, params)
                total = cur.fetchone()[0]
                cur.execute(data_query, params + [offset, limit])
                rows = _rows_to_dicts(cur, cur.fetchall())
                return rows, total
            finally:
                cur.close()

    def get_order_stages(
        self,
        order_id: int,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve planned and actual operational stages for an order."""
        query = """
            SELECT stage_id, order_id, stage_code, sequence_no,
                   planned_start_at, planned_end_at, actual_start_at,
                   actual_end_at, status
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

    def get_order_stats(self, conn: Optional[pyodbc.Connection] = None) -> Dict[str, Any]:
        """Aggregate operational fulfillment metrics from orders and decision cases."""
        query = """
            SELECT
                COUNT(*) AS total_orders,
                ISNULL(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered_orders,
                ISNULL(SUM(CASE WHEN status IN (
                    'PLACED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT'
                ) THEN 1 ELSE 0 END), 0) AS active_orders,
                ISNULL(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_orders,
                ISNULL(SUM(CASE WHEN status = 'DELAYED' THEN 1 ELSE 0 END), 0) AS delayed_orders,
                (SELECT COUNT(*) FROM dbo.decision_cases WHERE status = 'OPEN') AS open_cases_count
            FROM dbo.orders;
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

    def list_sellers(self, conn: Optional[pyodbc.Connection] = None) -> List[Dict[str, Any]]:
        """List registered sellers with owner information."""
        query = """
            SELECT s.seller_id, s.owner_user_id, s.business_name,
                   u.full_name AS owner_name, u.email AS owner_email
            FROM dbo.sellers s
            JOIN dbo.users u ON s.owner_user_id = u.user_id
            ORDER BY s.business_name ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                cur.execute(query)
                return _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()
