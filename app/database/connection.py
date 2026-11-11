"""Causara Database Access Layer and Connection Management."""

from contextlib import contextmanager
import logging
import os
from typing import Any, Generator, List, Optional, Tuple
import pyodbc

logger = logging.getLogger(__name__)


def build_connection_string() -> str:
    """Build connection string from environment variables.

    Supports:
    1. Azure SQL Database via AZURE_SQL_CONNECTION_STRING or DATABASE_URL.
       Automatically prepends the configured DB_DRIVER if the supplied connection string omits it.
    2. SQL Server Authentication with explicit server, database, user, and password.
    3. Local development via Windows Integrated / Trusted Connection (default: LocalDB).
    """
    conn_str = (os.getenv("AZURE_SQL_CONNECTION_STRING") or os.getenv("DATABASE_URL") or "").strip()
    driver = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")

    if conn_str:
        if "DRIVER=" not in conn_str.upper():
            return f"Driver={{{driver}}};{conn_str}"
        return conn_str

    server = os.getenv("DB_SERVER", r"(localdb)\CausaraDB")
    database = os.getenv("DB_NAME", "CausaraDB")
    trusted = os.getenv("DB_TRUSTED_CONNECTION", "yes")

    if os.getenv("DB_USER") and os.getenv("DB_PASSWORD"):
        return (
            f"Driver={{{driver}}};"
            f"Server={server};"
            f"Database={database};"
            f"Uid={os.getenv('DB_USER')};"
            f"Pwd={os.getenv('DB_PASSWORD')};"
            f"Encrypt=yes;"
            f"TrustServerCertificate=no;"
            f"Connection Timeout=30;"
        )

    return f"Driver={{{driver}}};Server={server};Database={database};Trusted_Connection={trusted};"


@contextmanager
def get_db_connection() -> Generator[pyodbc.Connection, None, None]:
    """Context manager yielding a transactional database connection.

    Automatically commits on normal completion and rolls back on unhandled exceptions.
    """
    connection_string = build_connection_string()
    conn = None
    try:
        conn = pyodbc.connect(connection_string, autocommit=False)
        yield conn
        conn.commit()
    except Exception as ex:
        if conn:
            try:
                conn.rollback()
            except Exception as rollback_ex:
                logger.error("Failed to rollback transaction: %s", rollback_ex)
        logger.error("Database operation failed: %s", ex)
        raise
    finally:
        if conn:
            try:
                conn.close()
            except Exception as close_ex:
                logger.warning("Error closing database connection: %s", close_ex)


@contextmanager
def get_db_cursor() -> Generator[pyodbc.Cursor, None, None]:
    """Context manager yielding an active database cursor within a managed transaction."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        try:
            yield cursor
        finally:
            cursor.close()


def check_db_connectivity() -> Tuple[bool, Optional[str]]:
    """Test live connectivity to the target database instance."""
    try:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT @@VERSION;")
            row = cursor.fetchone()
            version_str = row[0][:50] if row else "Unknown"
            return True, version_str
    except Exception as ex:
        logger.warning("Database connectivity check failed: %s", ex)
        return False, str(ex)


def execute_query(sql: str, params: Optional[Tuple[Any, ...]] = None) -> List[pyodbc.Row]:
    """Execute a parameterized read query and return all fetched rows."""
    with get_db_cursor() as cursor:
        cursor.execute(sql, params or ())
        return cursor.fetchall()


def execute_scalar(sql: str, params: Optional[Tuple[Any, ...]] = None) -> Any:
    """Execute a parameterized query returning a single scalar value."""
    with get_db_cursor() as cursor:
        cursor.execute(sql, params or ())
        row = cursor.fetchone()
        return row[0] if row else None
