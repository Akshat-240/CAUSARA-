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

    def get_user_by_email(self, email: str, conn: Optional[pyodbc.Connection] = None) -> Optional[Dict[str, Any]]:
        """Retrieve user by email address including password hash and assigned role."""
        query = """
            SELECT u.user_id, u.full_name, u.email, u.password_hash, u.is_active, u.created_at,
                   r.role_name AS role, s.seller_id, s.business_name
            FROM dbo.users u
            LEFT JOIN dbo.user_roles ur ON u.user_id = ur.user_id
            LEFT JOIN dbo.roles r ON ur.role_id = r.role_id
            LEFT JOIN dbo.sellers s ON u.user_id = s.owner_user_id
            WHERE LOWER(u.email) = LOWER(?);
        """

        def _exec(cursor: pyodbc.Cursor):
            cursor.execute(query, (email.strip(),))
            rows = _rows_to_dicts(cursor, cursor.fetchall())
            return rows[0] if rows else None

        if conn is not None:
            cur = conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()

    def get_user_by_id(self, user_id: int, conn: Optional[pyodbc.Connection] = None) -> Optional[Dict[str, Any]]:
        """Retrieve user by ID with assigned role and seller entity if applicable."""
        query = """
            SELECT u.user_id, u.full_name, u.email, u.is_active, u.created_at,
                   r.role_name AS role, s.seller_id, s.business_name
            FROM dbo.users u
            LEFT JOIN dbo.user_roles ur ON u.user_id = ur.user_id
            LEFT JOIN dbo.roles r ON ur.role_id = r.role_id
            LEFT JOIN dbo.sellers s ON u.user_id = s.owner_user_id
            WHERE u.user_id = ?;
        """

        def _exec(cursor: pyodbc.Cursor):
            cursor.execute(query, (user_id,))
            rows = _rows_to_dicts(cursor, cursor.fetchall())
            return rows[0] if rows else None

        if conn is not None:
            cur = conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()

    def list_roles(self, conn: Optional[pyodbc.Connection] = None) -> List[Dict[str, Any]]:
        """Retrieve list of all system roles with descriptions."""
        query = "SELECT role_id, role_name, description FROM dbo.roles ORDER BY role_id ASC;"
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

    def create_user(
        self,
        full_name: str,
        email: str,
        password_hash: str,
        role_name: str,
        business_name: Optional[str] = None,
        conn: Optional[pyodbc.Connection] = None,
    ) -> Dict[str, Any]:
        """Create a new user, assign their role, and optionally create a seller record."""
        def _exec(cursor: pyodbc.Cursor) -> Dict[str, Any]:
            # 1. Insert user
            user_insert_sql = """
                INSERT INTO dbo.users (full_name, email, password_hash)
                OUTPUT INSERTED.user_id, INSERTED.full_name, INSERTED.email, INSERTED.is_active, INSERTED.created_at
                VALUES (?, ?, ?);
            """
            cursor.execute(user_insert_sql, (full_name.strip(), email.strip().lower(), password_hash))
            user_row = _rows_to_dicts(cursor, [cursor.fetchone()])[0]
            new_user_id = user_row["user_id"]

            # 2. Assign role
            cursor.execute("SELECT role_id FROM dbo.roles WHERE role_name = ?;", (role_name.upper(),))
            role_row = cursor.fetchone()
            if not role_row:
                raise ValueError(f"Invalid role: {role_name}")
            role_id = role_row[0]

            cursor.execute(
                "INSERT INTO dbo.user_roles (user_id, role_id) VALUES (?, ?);",
                (new_user_id, role_id),
            )

            # 3. Create seller profile if role is SELLER
            seller_id = None
            effective_business_name = None
            if role_name.upper() == "SELLER":
                effective_business_name = (business_name or f"{full_name.strip()} Logistics").strip()
                seller_insert_sql = """
                    INSERT INTO dbo.sellers (owner_user_id, business_name)
                    OUTPUT INSERTED.seller_id
                    VALUES (?, ?);
                """
                cursor.execute(seller_insert_sql, (new_user_id, effective_business_name))
                seller_id = cursor.fetchone()[0]

            user_row["role"] = role_name.upper()
            user_row["seller_id"] = seller_id
            user_row["business_name"] = effective_business_name
            return user_row

        if conn is not None:
            cur = conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()

        with get_db_connection() as managed_conn:
            cur = managed_conn.cursor()
            try:
                return _exec(cur)
            finally:
                cur.close()
