"""User repository for identity, roles, and operational actors."""

import logging
from typing import Any, Dict, List, Optional
import pyodbc

from app.database.connection import get_db_connection

logger = logging.getLogger(__name__)


def _rows_to_dicts(cursor: pyodbc.Cursor, rows: List[pyodbc.Row]) -> List[Dict[str, Any]]:
    """Convert pyodbc rows into a list of dictionaries."""
    if not rows or not cursor.description:
        return []
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in rows]


class UserRepository:
    """Repository accessing dbo.users, dbo.roles, and dbo.user_roles."""

    def list_users(
        self,
        role: Optional[str] = None,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
        conn: Optional[pyodbc.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieve users with optional role filtering."""
        where_clauses = []
        params: List[Any] = []

        if role:
            where_clauses.append("r.role_name = ?")
            params.append(role.upper())
        if is_active is not None:
            where_clauses.append("u.is_active = ?")
            params.append(1 if is_active else 0)

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        query = f"""
            SELECT u.user_id, u.full_name, u.email, u.is_active, u.created_at,
                   r.role_name AS role
            FROM dbo.users u
            LEFT JOIN dbo.user_roles ur ON u.user_id = ur.user_id
            LEFT JOIN dbo.roles r ON ur.role_id = r.role_id
            {where_sql}
            ORDER BY u.user_id ASC
            OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        """
        params.extend([offset, limit])

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

    def list_actors(self, conn: Optional[pyodbc.Connection] = None) -> List[Dict[str, Any]]:
        """Retrieve active operational actors with assigned roles for attribution."""
        query = """
            SELECT u.user_id, u.full_name, u.email, r.role_name AS role
            FROM dbo.users u
            JOIN dbo.user_roles ur ON u.user_id = ur.user_id
            JOIN dbo.roles r ON ur.role_id = r.role_id
            WHERE u.is_active = 1
            ORDER BY u.user_id ASC;
        """
        if conn is not None:
            cur = conn.cursor()
            try:
                cur.execute(query)
                rows = _rows_to_dicts(cur, cur.fetchall())
            finally:
                cur.close()
        else:
            with get_db_connection() as managed_conn:
                cur = managed_conn.cursor()
                try:
                    cur.execute(query)
                    rows = _rows_to_dicts(cur, cur.fetchall())
                finally:
                    cur.close()

        actors = []
        for row in rows:
            role_display = row["role"].replace("_", " ").title() if row.get("role") else "User"
            actors.append({
                "id": row["user_id"],
                "name": row["full_name"],
                "email": row["email"],
                "role": row["role"],
                "label": f"{row['full_name']} ({role_display})",
            })
        return actors
