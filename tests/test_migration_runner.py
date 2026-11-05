"""Automated tests for migration runner checksum drift detection and lifecycle management."""

import shutil
from pathlib import Path
import pytest
from database import migration_runner
from database.migration_runner import (
    MigrationChecksumError,
    MigrationRunner,
    compute_file_checksum,
)


def test_validate_checksums_unchanged_applied_migration():
    """Verify that unchanged applied migrations pass checksum validation."""
    runner = MigrationRunner()
    conn = runner.get_connection()
    try:
        # Should execute cleanly without raising MigrationChecksumError
        runner.validate_checksums(conn)
    finally:
        conn.close()


def test_validate_checksums_modified_applied_migration(tmp_path, monkeypatch):
    """Verify that modifying an already-applied migration triggers MigrationChecksumError."""
    # 1. Copy real migrations to a temporary directory using binary copy
    temp_migrations_dir = tmp_path / "migrations"
    temp_migrations_dir.mkdir()

    real_migrations_dir = Path(__file__).resolve().parent.parent / "database" / "migrations"
    for f in real_migrations_dir.glob("V*__*.sql"):
        shutil.copy2(f, temp_migrations_dir / f.name)

    # 2. Modify one applied migration (V001) in binary mode
    v001_file = temp_migrations_dir / "V001__initial_schema.sql"
    original_checksum = compute_file_checksum(v001_file)
    with open(v001_file, "ab") as f:
        f.write(b"\n-- DRIFT_INJECTION\n")
    modified_checksum = compute_file_checksum(v001_file)
    assert original_checksum != modified_checksum

    # 3. Patch MIGRATIONS_DIR to point to temporary directory
    monkeypatch.setattr(migration_runner, "MIGRATIONS_DIR", temp_migrations_dir)

    runner = MigrationRunner()
    conn = runner.get_connection()
    try:
        with pytest.raises(MigrationChecksumError) as exc_info:
            runner.validate_checksums(conn)

        err = exc_info.value
        assert err.version == "V001"
        assert err.file_name == "V001__initial_schema.sql"
        assert err.expected_checksum == original_checksum
        assert err.actual_checksum == modified_checksum
        assert "Applied migrations are immutable" in str(err)
    finally:
        conn.close()


def test_migrate_with_new_migration(tmp_path, monkeypatch):
    """Verify that runner cleanly applies a new forward migration when applied migrations are unchanged."""
    temp_migrations_dir = tmp_path / "migrations"
    temp_migrations_dir.mkdir()

    real_migrations_dir = Path(__file__).resolve().parent.parent / "database" / "migrations"
    for f in real_migrations_dir.glob("V*__*.sql"):
        shutil.copy2(f, temp_migrations_dir / f.name)

    # Add new forward migration V999
    v999_file = temp_migrations_dir / "V999__temp_checksum_test.sql"
    v999_file.write_bytes(b"CREATE TABLE dbo._temp_runner_test (id INT PRIMARY KEY);\n")

    monkeypatch.setattr(migration_runner, "MIGRATIONS_DIR", temp_migrations_dir)

    runner = MigrationRunner()
    applied = runner.migrate()
    assert "V999" in applied

    # Clean up test table and record from dbo.schema_migrations
    conn = runner.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DROP TABLE IF EXISTS dbo._temp_runner_test;")
        cur.execute("DELETE FROM dbo.schema_migrations WHERE version = 'V999';")
        conn.commit()
    finally:
        conn.close()


def test_multiple_applied_migrations_one_drifted_stops_execution(tmp_path, monkeypatch):
    """Verify that if one applied migration drifts among multiple, execution stops immediately without applying new."""
    temp_migrations_dir = tmp_path / "migrations"
    temp_migrations_dir.mkdir()

    real_migrations_dir = Path(__file__).resolve().parent.parent / "database" / "migrations"
    for f in real_migrations_dir.glob("V*__*.sql"):
        shutil.copy2(f, temp_migrations_dir / f.name)

    # Tamper with V002 in binary mode
    v002_file = temp_migrations_dir / "V002__triggers_views_procedures.sql"
    with open(v002_file, "ab") as f:
        f.write(b"\n-- TAMPERED_LINE\n")

    # Also add a new pending migration V999
    v999_file = temp_migrations_dir / "V999__should_not_run.sql"
    v999_file.write_bytes(b"CREATE TABLE dbo._should_not_exist (id INT);\n")

    monkeypatch.setattr(migration_runner, "MIGRATIONS_DIR", temp_migrations_dir)

    runner = MigrationRunner()
    with pytest.raises(MigrationChecksumError) as exc_info:
        runner.migrate()

    assert exc_info.value.version == "V002"

    # Verify that V999 was NOT applied and the table was NOT created
    conn = runner.get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT OBJECT_ID('dbo._should_not_exist', 'U');")
        assert cur.fetchone()[0] is None
        cur.execute("SELECT COUNT(*) FROM dbo.schema_migrations WHERE version = 'V999';")
        assert cur.fetchone()[0] == 0
    finally:
        conn.close()
