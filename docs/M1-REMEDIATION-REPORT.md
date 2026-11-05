# Causara — Milestone M1 Audit Remediation Report

**Document Version:** 1.0.0  
**Date:** 2026-11-05  
**Remediation Target:** Milestone M1 Database Implementation  
**Auditor Reference:** [`docs/M1-AUDIT-REPORT.md`](file:///c:/Users/aksha/Desktop/ESPV1/docs/M1-AUDIT-REPORT.md)  
**Target Engine:** Microsoft SQL Server 2019 Express LocalDB `(localdb)\CausaraDB` (v15.0.4382.1, 64-bit)  
**Execution Environment:** Windows, Python 3.14.2, `pyodbc 5.3.0`, `pytest 9.2.0`, `flake8 7.5.0`

---

## 1. Executive Summary & Final Recommendation

### Final Recommendation: **READY FOR M1 ACCEPTANCE**

All five findings identified during the independent audit ([`docs/M1-AUDIT-REPORT.md`](file:///c:/Users/aksha/Desktop/ESPV1/docs/M1-AUDIT-REPORT.md)) have been systematically remediated and verified.

1. **Migration Checksum Drift Detection (M1-01):** Implemented strict immutability validation in `MigrationRunner`. Applied migrations with altered on-disk checksums immediately halt execution, reporting the version, expected checksum, and actual checksum without modifying database history.
2. **Analytical View Naming (M1-02):** Created forward migration `V003` updating `vw_SellerDelaySummary` output column from `avg_delay_hours` to `avg_excess_delay_hours`, matching the approved system design.
3. **Zero-Order Seller Aggregation (M1-03):** Corrected `vw_SellerDelaySummary` to return `NULL` for sellers with zero order records, while preserving genuine `0.00` values for on-time order fulfillments.
4. **Stored Procedure Negative Tests (M1-04):** Implemented automated integration tests verifying error codes `50001`, `50003`, and `50004`, confirming atomic transaction rollback with zero partial state persistence.
5. **LocalDB Default Database (M1-05):** Standardized LocalDB configuration to default to dedicated database `CausaraDB` rather than `master`, documented database initialization prerequisites, and preserved explicit user-defined `DB_NAME` overrides.

All 39 Pytest tests pass in 1.15s, Flake8 reports 0 errors, and all 3 migrations are recorded as `APPLIED` with verified checksums.

---

## 2. Audit Finding Remediation Details

### Finding M1-01: Migration Checksum Drift Detection
- **Severity:** Medium
- **Problem:** `MigrationRunner.migrate()` previously skipped applied migrations without comparing on-disk SHA-256 checksums against `dbo.schema_migrations`. Tampered or modified migration files went undetected.
- **Files Changed:**
  - [`database/migration_runner.py`](file:///c:/Users/aksha/Desktop/ESPV1/database/migration_runner.py)
  - [`tests/test_migration_runner.py`](file:///c:/Users/aksha/Desktop/ESPV1/tests/test_migration_runner.py) *(new)*
- **Exact Changes Made:**
  1. Defined `MigrationChecksumError(RuntimeError)` capturing `version`, `file_name`, `expected_checksum`, and `actual_checksum`.
  2. Implemented `MigrationRunner.validate_checksums(conn)` which computes the SHA-256 hash of each available forward migration and asserts equality with `applied[version]["checksum"]`.
  3. Integrated `self.validate_checksums(conn)` at the beginning of `MigrationRunner.migrate()`, halting execution before applying any pending migrations if drift is detected.
  4. Updated `MigrationRunner.status()` to inspect checksum validity and flag modified migrations with status `DRIFTED`.
  5. Created four dedicated automated tests in `tests/test_migration_runner.py`:
     - `test_validate_checksums_unchanged_applied_migration`
     - `test_validate_checksums_modified_applied_migration`
     - `test_migrate_with_new_migration`
     - `test_multiple_applied_migrations_one_drifted_stops_execution`

---

### Finding M1-02: Analytical View Output Naming
- **Severity:** Low
- **Problem:** `vw_SellerDelaySummary` created in `V002` named the average delay column `avg_delay_hours` instead of the design specification `avg_excess_delay_hours`.
- **Files Changed:**
  - [`database/migrations/V003__update_seller_delay_summary_view.sql`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V003__update_seller_delay_summary_view.sql) *(new)*
  - [`database/migrations/U003__update_seller_delay_summary_view_down.sql`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/U003__update_seller_delay_summary_view_down.sql) *(new)*
  - [`tests/test_database.py`](file:///c:/Users/aksha/Desktop/ESPV1/tests/test_database.py)
- **Exact Changes Made:**
  1. Enforced migration immutability by leaving `V001` and `V002` untouched and introducing forward migration `V003`.
  2. Updated column definition to:
     ```sql
     CAST(AVG(...) / 60.0 AS DECIMAL(10,2)) AS avg_excess_delay_hours
     ```
  3. Created corresponding rollback script `U003` dropping and restoring the `V002` definition.
  4. Added test `test_seller_delay_summary_column_naming` asserting that `avg_excess_delay_hours` is queryable.

---

### Finding M1-03: Zero-Order Seller Handling in `vw_SellerDelaySummary`
- **Severity:** Low
- **Problem:** Due to `CASE WHEN o.actual_delivery_at > o.expected_delivery_at ... ELSE 0 END`, sellers with no orders (a `LEFT JOIN` row where `o.order_id IS NULL`) evaluated to `0`, causing `AVG(0)` to return `0.00` rather than `NULL`.
- **Files Changed:**
  - [`database/migrations/V003__update_seller_delay_summary_view.sql`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V003__update_seller_delay_summary_view.sql)
  - [`tests/test_database.py`](file:///c:/Users/aksha/Desktop/ESPV1/tests/test_database.py)
- **Exact Changes Made:**
  1. Refined aggregation expression in `V003`:
     ```sql
     CAST(AVG(CASE 
         WHEN o.order_id IS NULL THEN NULL
         WHEN o.actual_delivery_at > o.expected_delivery_at 
             THEN DATEDIFF(MINUTE, o.expected_delivery_at, o.actual_delivery_at) 
         ELSE 0 
     END) / 60.0 AS DECIMAL(10,2)) AS avg_excess_delay_hours
     ```
  2. Added three integration tests in `tests/test_database.py`:
     - `test_seller_zero_orders_returns_null_delay`: Confirms `avg_excess_delay_hours IS NULL` and `avg_fulfillment_hours IS NULL` when `total_orders == 0`.
     - `test_seller_on_time_orders_returns_zero_delay`: Confirms genuine `0.00` excess delay when order arrives on or before expected delivery date.
     - `test_seller_delayed_orders_returns_positive_delay`: Confirms positive excess delay (e.g. 180 min late = `3.00` hours) when orders exceed expected delivery date.

---

### Finding M1-04: Stored Procedure Negative / Error Code Tests
- **Severity:** Low
- **Problem:** Automated test coverage exercised only happy paths for stored procedures. Error conditions and custom THROW error numbers (`50001`, `50003`, `50004`) were not explicitly tested.
- **Files Changed:**
  - [`tests/test_database.py`](file:///c:/Users/aksha/Desktop/ESPV1/tests/test_database.py)
- **Exact Changes Made:**
  1. Added `test_usp_create_decision_case_invalid_order_50001`:
     - Calls `dbo.usp_CreateDecisionCase` with non-existent `order_id = 999999999`.
     - Asserts `pyodbc.ProgrammingError` containing error code `50001` and message `"Invalid order_id specified."`.
     - Asserts 0 partial rows in `decision_cases` or `outbox_events`.
  2. Added `test_usp_approve_decision_non_pending_50003`:
     - Calls `dbo.usp_ApproveDecision` on an already-approved decision and on a non-existent decision ID.
     - Asserts `pyodbc.ProgrammingError` containing error code `50003` and message `"Decision not in PENDING state or does not exist."`.
     - Verifies approval timestamp and approver user ID remain unaltered.
  3. Added `test_usp_record_decision_mismatched_scenario_50004`:
     - Calls `dbo.usp_RecordDecision` pairing `case_id` from Case 1 with `scenario_id` from Case 2.
     - Asserts `pyodbc.ProgrammingError` containing error code `50004` and message `"Scenario does not belong to the specified decision case."`.
     - Asserts 0 partial decision records or spurious audit log entries.

---

### Finding M1-05: LocalDB Default Database Configuration
- **Severity:** Low
- **Problem:** Database connection fallback defaulted to `master`, creating application tables in the SQL Server system database if `DB_NAME` was not set.
- **Files Changed:**
  - [`app/database/connection.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/database/connection.py)
  - [`database/migration_runner.py`](file:///c:/Users/aksha/Desktop/ESPV1/database/migration_runner.py)
  - [`.env.example`](file:///c:/Users/aksha/Desktop/ESPV1/.env.example)
  - [`README.md`](file:///c:/Users/aksha/Desktop/ESPV1/README.md)
- **Exact Changes Made:**
  1. Updated fallback in `app/database/connection.py`:
     ```python
     server = os.getenv("DB_SERVER", r"(localdb)\CausaraDB")
     database = os.getenv("DB_NAME", "CausaraDB")
     ```
  2. Updated fallback in `database/migration_runner.py` to `CausaraDB`.
  3. Updated `.env.example` with `DB_NAME=CausaraDB` and prerequisite initialization command:
     ```powershell
     sqlcmd -S "(localdb)\CausaraDB" -Q "IF DB_ID('CausaraDB') IS NULL CREATE DATABASE CausaraDB;"
     ```
  4. Updated `README.md` Section 7.3 and project file structure tree to document `CausaraDB` database initialization and migrations `V003`/`U003`.
  5. Initialized dedicated `CausaraDB` database on the LocalDB instance, preserving all migration history timestamps.

---

## 3. Migration Ledger Status

Command: `python -m database.migration_runner status`

```
Version    Status     Applied At                Description
---------------------------------------------------------------------------
V001       APPLIED    2026-11-05 09:27:42       initial schema
V002       APPLIED    2026-11-05 09:41:24       triggers views procedures
V003       APPLIED    2026-11-05 09:56:33       update seller delay summary view
```

- **Checksum verification:** All 3 on-disk files match their recorded SHA-256 hashes.
- **Rollback script parity:** `U001`, `U002`, and `U003` are present in `database/migrations/`.

---

## 4. Verification Commands & Test Results

### 4.1 Pytest Suite Execution
Command: `.\.venv\Scripts\pytest.exe -v`  
**Exit Code:** 0

```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0 -- C:\Users\aksha\Desktop\ESPV1\.venv\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
testpaths: tests
collected 39 items

tests/test_database.py::test_all_18_tables_exist PASSED                  [  2%]
tests/test_database.py::test_primary_key_enforcement PASSED              [  5%]
tests/test_database.py::test_foreign_key_enforcement PASSED              [  7%]
tests/test_database.py::test_composite_foreign_key_integrity PASSED      [ 10%]
tests/test_database.py::test_not_null_constraints PASSED                 [ 12%]
tests/test_database.py::test_unique_constraints PASSED                   [ 15%]
tests/test_database.py::test_check_constraints PASSED                    [ 17%]
tests/test_database.py::test_analysis_job_type_combinations PASSED       [ 20%]
tests/test_database.py::test_cross_order_reference_rejection PASSED      [ 23%]
tests/test_database.py::test_delay_edge_self_loop_rejection PASSED       [ 25%]
tests/test_database.py::test_delay_edge_cross_order_rejection PASSED     [ 28%]
tests/test_database.py::test_multi_row_trigger_behavior PASSED           [ 30%]
tests/test_database.py::test_immutable_order_stages_parent_reference PASSED [ 33%]
tests/test_database.py::test_immutable_decision_cases_parent_reference PASSED [ 35%]
tests/test_database.py::test_computed_column_correctness PASSED          [ 38%]
tests/test_database.py::test_verification_uniqueness PASSED              [ 41%]
tests/test_database.py::test_migration_upgrade_and_status PASSED         [ 43%]
tests/test_database.py::test_migration_rollback_and_reapply PASSED       [ 46%]
tests/test_database.py::test_stored_procedures_workflow PASSED           [ 48%]
tests/test_database.py::test_analytical_views PASSED                     [ 51%]
tests/test_database.py::test_seller_delay_summary_column_naming PASSED   [ 53%]
tests/test_database.py::test_seller_zero_orders_returns_null_delay PASSED [ 56%]
tests/test_database.py::test_seller_on_time_orders_returns_zero_delay PASSED [ 58%]
tests/test_database.py::test_seller_delayed_orders_returns_positive_delay PASSED [ 61%]
tests/test_database.py::test_usp_create_decision_case_invalid_order_50001 PASSED [ 64%]
tests/test_database.py::test_usp_approve_decision_non_pending_50003 PASSED [ 66%]
tests/test_database.py::test_usp_record_decision_mismatched_scenario_50004 PASSED [ 69%]
tests/test_errors.py::test_404_not_found_envelope PASSED                 [ 71%]
tests/test_errors.py::test_405_method_not_allowed_envelope PASSED        [ 74%]
tests/test_errors.py::test_custom_api_error_handling PASSED              [ 76%]
tests/test_factory.py::test_app_creation_testing_mode PASSED             [ 79%]
tests/test_factory.py::test_app_creation_development_mode PASSED         [ 82%]
tests/test_factory.py::test_root_index_endpoint PASSED                   [ 84%]
tests/test_health.py::test_health_check_success PASSED                   [ 87%]
tests/test_health.py::test_health_check_propagates_request_id PASSED     [ 89%]
tests/test_migration_runner.py::test_validate_checksums_unchanged_applied_migration PASSED [ 92%]
tests/test_migration_runner.py::test_validate_checksums_modified_applied_migration PASSED [ 94%]
tests/test_migration_runner.py::test_migrate_with_new_migration PASSED   [ 97%]
tests/test_migration_runner.py::test_multiple_applied_migrations_one_drifted_stops_execution PASSED [100%]

============================= 39 passed in 1.15s ==============================
```

### 4.2 Flake8 Static Analysis
Command: `.\.venv\Scripts\flake8.exe app database tests --max-line-length=120`  
**Exit Code:** 0 (0 violations).

### 4.3 Frontend Unit Tests
Command: `npm --prefix frontend run test -- --run`  
**Exit Code:** 0 (2 passed in 3.39s).

### 4.4 Live Database Integrity Verification
Direct SQL query against `(localdb)\CausaraDB.CausaraDB`:
- Application tables: **18**
- Database triggers: **3**
- Analytical views: **2**
- Stored procedures: **4**
- Column `avg_excess_delay_hours` in `vw_SellerDelaySummary`: **Present**

---

## 5. Scope & Compliance Audit

| Constraint | Requirement | Status |
|---|---|---|
| **Scope Boundary** | Modify only what is necessary to resolve findings | **Complied** |
| **Relational Integrity** | Preserve approved 18-table schema and relationships | **Complied** (18 tables intact) |
| **Code Boundary** | Do not modify unrelated application code | **Complied** |
| **Cloud Governance** | Do not provision Azure resources or connect to Azure SQL | **Complied** (100% LocalDB) |
| **Database Preservation** | Do not delete or reset the existing Causara database | **Complied** |
| **Migration Immutability** | Do not edit applied migrations; use forward migrations | **Complied** (Added V003/U003) |
| **Next Steps** | Do not begin M2 until approval is granted | **Complied** |

---

## 6. Remaining Issues

None. All five findings from the independent audit have been completely resolved, verified, and documented.
