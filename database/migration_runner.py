"""Causara Database Migration Runner for Azure SQL Database & SQL Server."""

import hashlib
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional
import pyodbc


MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
SEEDS_DIR = Path(__file__).resolve().parent / "seeds"


class MigrationChecksumError(RuntimeError):
    """Raised when an on-disk migration file has drifted from its recorded checksum."""

    def __init__(self, version: str, file_name: str, expected_checksum: str, actual_checksum: str):
        self.version = version
        self.file_name = file_name
        self.expected_checksum = expected_checksum
        self.actual_checksum = actual_checksum
        super().__init__(
            f"Migration checksum mismatch for version {version} ({file_name}): "
            f"expected {expected_checksum}, found {actual_checksum}. "
            "Applied migrations are immutable."
        )


def get_default_connection_string() -> str:
    """Retrieve connection string from environment or fall back to local test instance.

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
        user = os.getenv("DB_USER")
        pwd = os.getenv("DB_PASSWORD")
        return (
            f"Driver={{{driver}}};Server={server};Database={database};"
            f"Uid={user};Pwd={pwd};Encrypt=yes;TrustServerCertificate=no;"
        )
    return f"Driver={{{driver}}};Server={server};Database={database};Trusted_Connection={trusted};"


def compute_file_checksum(file_path: Path) -> str:
    """Compute SHA-256 checksum of migration SQL script."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


def split_sql_batches(sql_content: str) -> List[str]:
    """Split SQL script on 'GO' batch separators case-insensitively on dedicated lines."""
    batches = re.split(r"^\s*GO\s*$", sql_content, flags=re.MULTILINE | re.IGNORECASE)
    return [b.strip() for b in batches if b.strip()]


class MigrationRunner:
    """Executes version-controlled SQL migrations with transaction safety and checksum audit."""

    def __init__(self, connection_string: Optional[str] = None):
        self.connection_string = connection_string or get_default_connection_string()

    def get_connection(self) -> pyodbc.Connection:
        """Create new connection with autocommit disabled for explicit transaction management."""
        conn = pyodbc.connect(self.connection_string, autocommit=False)
        return conn

    def ensure_migration_table(self, conn: pyodbc.Connection) -> None:
        """Create the schema_migrations tracking table if absent."""
        cursor = conn.cursor()
        cursor.execute("""
            IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL
            BEGIN
                CREATE TABLE dbo.schema_migrations (
                    version VARCHAR(50) PRIMARY KEY,
                    description NVARCHAR(255) NOT NULL,
                    applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                    execution_time_ms INT NOT NULL,
                    checksum VARCHAR(64) NOT NULL
                );
            END
        """)
        conn.commit()

    def get_applied_migrations(self, conn: pyodbc.Connection) -> Dict[str, dict]:
        """Fetch all recorded migrations from schema_migrations."""
        self.ensure_migration_table(conn)
        cursor = conn.cursor()
        cursor.execute(
            "SELECT version, description, applied_at, execution_time_ms, checksum "
            "FROM dbo.schema_migrations ORDER BY version ASC"
        )
        rows = cursor.fetchall()
        return {
            row[0]: {
                "version": row[0],
                "description": row[1],
                "applied_at": row[2],
                "execution_time_ms": row[3],
                "checksum": row[4],
            }
            for row in rows
        }

    def get_available_migrations(self) -> List[Path]:
        """Find all forward migration files (V*__*.sql) sorted by version."""
        if not MIGRATIONS_DIR.exists():
            return []
        files = [f for f in MIGRATIONS_DIR.glob("V*__*.sql") if f.is_file()]
        return sorted(files, key=lambda f: f.name)

    def validate_checksums(self, conn: pyodbc.Connection) -> None:
        """Validate that all already-applied migrations match their on-disk SHA-256 checksums."""
        self.ensure_migration_table(conn)
        applied = self.get_applied_migrations(conn)
        available = self.get_available_migrations()
        available_map = {m.name.split("__")[0]: m for m in available}

        for version, record in applied.items():
            if version in available_map:
                migration_file = available_map[version]
                current_checksum = compute_file_checksum(migration_file)
                expected_checksum = record["checksum"]
                if current_checksum != expected_checksum:
                    raise MigrationChecksumError(
                        version=version,
                        file_name=migration_file.name,
                        expected_checksum=expected_checksum,
                        actual_checksum=current_checksum,
                    )

    def migrate(self) -> List[str]:
        """Apply all pending forward migrations in sequential order."""
        applied_names: List[str] = []
        conn = self.get_connection()
        try:
            self.ensure_migration_table(conn)
            self.validate_checksums(conn)
            applied = self.get_applied_migrations(conn)
            available = self.get_available_migrations()

            for migration_file in available:
                version_part = migration_file.name.split("__")[0]
                desc_part = migration_file.name.split("__")[1].replace(".sql", "").replace("_", " ")

                if version_part in applied:
                    continue

                checksum = compute_file_checksum(migration_file)
                sql_content = migration_file.read_text(encoding="utf-8")
                batches = split_sql_batches(sql_content)

                start_time = time.time()
                cursor = conn.cursor()
                try:
                    for batch in batches:
                        cursor.execute(batch)

                    elapsed_ms = int((time.time() - start_time) * 1000)
                    cursor.execute(
                        """
                        INSERT INTO dbo.schema_migrations (
                            version, description, applied_at, execution_time_ms, checksum
                        )
                        VALUES (?, ?, SYSUTCDATETIME(), ?, ?)
                        """,
                        version_part, desc_part, elapsed_ms, checksum,
                    )
                    conn.commit()
                    applied_names.append(version_part)
                except Exception as ex:
                    conn.rollback()
                    raise RuntimeError(f"Migration {migration_file.name} failed: {ex}") from ex
        finally:
            conn.close()

        return applied_names

    def rollback(self) -> Optional[str]:
        """Roll back the most recently applied migration using matching U*__*_down.sql script."""
        conn = self.get_connection()
        try:
            self.ensure_migration_table(conn)
            cursor = conn.cursor()
            cursor.execute("SELECT TOP 1 version, description FROM dbo.schema_migrations ORDER BY version DESC")
            row = cursor.fetchone()
            if not row:
                return None

            last_version = row[0]
            rollback_version = last_version.replace("V", "U")
            matching_down = list(MIGRATIONS_DIR.glob(f"{rollback_version}__*_down.sql"))

            if not matching_down:
                err_msg = f"Rollback script {rollback_version}__*_down.sql not found for version {last_version}"
                raise FileNotFoundError(err_msg)

            down_file = matching_down[0]
            sql_content = down_file.read_text(encoding="utf-8")
            batches = split_sql_batches(sql_content)

            try:
                for batch in batches:
                    cursor.execute(batch)
                cursor.execute("DELETE FROM dbo.schema_migrations WHERE version = ?", last_version)
                conn.commit()
                return last_version
            except Exception as ex:
                conn.rollback()
                raise RuntimeError(f"Rollback {down_file.name} failed: {ex}") from ex
        finally:
            conn.close()

    def seed(self) -> List[str]:
        """Execute catalog seed scripts from database/seeds/."""
        executed: List[str] = []
        if not SEEDS_DIR.exists():
            return executed

        seed_files = sorted(SEEDS_DIR.glob("*.sql"))
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            for seed_file in seed_files:
                sql_content = seed_file.read_text(encoding="utf-8")
                batches = split_sql_batches(sql_content)
                for batch in batches:
                    cursor.execute(batch)
                conn.commit()
                executed.append(seed_file.name)
        except Exception as ex:
            conn.rollback()
            raise RuntimeError(f"Seeding failed on {seed_file.name}: {ex}") from ex
        finally:
            conn.close()

        return executed

    def status(self) -> List[dict]:
        """Report migration ledger status."""
        conn = self.get_connection()
        try:
            applied = self.get_applied_migrations(conn)
            available = self.get_available_migrations()
            report = []
            for m in available:
                version = m.name.split("__")[0]
                desc = m.name.split("__")[1].replace(".sql", "").replace("_", " ")
                is_applied = version in applied
                checksum_drift = False
                expected_ck = None
                current_ck = compute_file_checksum(m)

                if is_applied:
                    expected_ck = applied[version]["checksum"]
                    if current_ck != expected_ck:
                        checksum_drift = True

                status_label = "DRIFTED" if checksum_drift else ("APPLIED" if is_applied else "PENDING")
                report.append({
                    "version": version,
                    "file": m.name,
                    "description": desc,
                    "status": status_label,
                    "applied_at": applied[version]["applied_at"] if is_applied else None,
                    "execution_time_ms": applied[version]["execution_time_ms"] if is_applied else None,
                    "checksum": current_ck,
                    "expected_checksum": expected_ck,
                    "checksum_valid": (not checksum_drift) if is_applied else None,
                })
            return report
        finally:
            conn.close()


def main():
    """Command-line interface for database migration operations."""
    action = sys.argv[1].lower() if len(sys.argv) > 1 else "status"
    runner = MigrationRunner()

    if action == "migrate":
        applied = runner.migrate()
        if applied:
            print(f"Successfully applied {len(applied)} migration(s): {', '.join(applied)}")
        else:
            print("Database is up to date. No pending migrations.")
    elif action == "rollback":
        rolled_back = runner.rollback()
        if rolled_back:
            print(f"Successfully rolled back migration: {rolled_back}")
        else:
            print("No migrations to roll back.")
    elif action == "seed":
        seeds = runner.seed()
        print(f"Successfully executed seed script(s): {', '.join(seeds)}")
    elif action == "status":
        items = runner.status()
        print(f"{'Version':<10} {'Status':<10} {'Applied At':<25} {'Description'}")
        print("-" * 75)
        for item in items:
            applied_str = str(item['applied_at'])[:19] if item['applied_at'] else "-"
            print(f"{item['version']:<10} {item['status']:<10} {applied_str:<25} {item['description']}")
    else:
        print(f"Unknown command: '{action}'. Available: migrate, rollback, status, seed")
        sys.exit(1)


if __name__ == "__main__":
    main()
