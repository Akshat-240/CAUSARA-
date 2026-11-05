# Causara — Milestone M1 Independent Database Audit Report

**Document Version:** 1.0.0  
**Date of Audit:** 2026-11-05  
**Auditor:** Independent Database Architect & Principal Systems Engineer  
**Audit Target:** Milestone M1 Database Implementation (`database/`, `app/database/`, `tests/test_database.py`)  
**Target Engine:** Microsoft SQL Server 2019 Express LocalDB `(localdb)\CausaraDB` (v15.0.4382.1, 64-bit)  
**Execution Environment:** Windows, Python 3.14.2, `pyodbc 5.3.0`, `pytest 9.2.0`, `flake8 7.5.0`

---

## 1. Executive Summary & Verdict

### Final Verdict: **PASS WITH ISSUES**

The completed Milestone M1 Database Implementation demonstrates exceptional architectural rigor, faithful adherence to the approved Third Normal Form (3NF) relational design, and robust enforcement of operational and epistemological domain rules. All 18 specified relational tables, 30 foreign key constraints (including 6 composite foreign keys), 18 check constraints, 3 multi-row database triggers, 4 stored procedures, 2 analytical views, and 12 performance indexes have been verified against the live Microsoft SQL Server engine.

The classification **PASS WITH ISSUES** is rendered solely due to one Medium-severity gap in migration runner checksum drift detection and three minor Low-severity items concerning analytical view column naming, zero-order null aggregation, and test coverage for stored procedure negative paths. None of these issues compromise relational integrity or data isolation.

### Scorecard Summary

| Category | Specification | Verified Status | Result |
|---|---|---|---|
| **Relational Schema** | 18 normalized tables | 18/18 confirmed on SQL Server | **PASS** |
| **Relational Integrity** | Composite FKs preventing cross-order reference leaks | 6 composite FKs verified | **PASS** |
| **Graph Integrity** | Delay edges 3NF preserved; no self-loops, no cross-order edges | Multi-row trigger verified (50010, 50011) | **PASS** |
| **Parent Immutability** | Order ownership immutable on stages and decision cases | Triggers verified (50012, 50013) | **PASS** |
| **Analysis Job Dependencies** | Type combination constraint `CK_analysis_jobs_type_deps` | All combinations enforced | **PASS** |
| **Computed Columns** | Derivation of signed error, absolute error, delivery variance | 3 `PERSISTED` computed columns verified | **PASS** |
| **Verification Cardinality** | 1:0..1 relationship per decision case | `UQ_verifications_decision` enforced | **PASS** |
| **Analytical Views** | `vw_SellerDelaySummary`, `vw_OrderStageDelayBreakdown` | Both operational; 1 naming discrepancy | **PASS WITH ISSUES** |
| **Stored Procedures** | 4 atomic procedures with Outbox & Audit logging | All 4 functional with atomic rollback | **PASS** |
| **Migration Runner** | Forward migrations, rollbacks, and seed idempotency | V001, V002, U002, U001 confirmed | **PASS WITH ISSUES** |
| **Code Quality & Tests** | PEP 8, Flake8, and live Pytest suite | 28/28 tests passed; 0 flake8 errors | **PASS** |

---

## 2. Live Verification Environment & Empirical Evidence

All verification queries and test suites were executed directly against the active Microsoft SQL Server LocalDB instance `(localdb)\CausaraDB`.

### 2.1 Test Suite Execution
```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0 -- C:\Users\aksha\Desktop\ESPV1\.venv\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
testpaths: tests
collected 28 items

tests/test_database.py::test_all_18_tables_exist PASSED                  [  3%]
tests/test_database.py::test_primary_key_enforcement PASSED              [  7%]
tests/test_database.py::test_foreign_key_enforcement PASSED              [ 10%]
tests/test_database.py::test_composite_foreign_key_integrity PASSED      [ 14%]
tests/test_database.py::test_not_null_constraints PASSED                 [ 17%]
tests/test_database.py::test_unique_constraints PASSED                   [ 21%]
tests/test_database.py::test_check_constraints PASSED                    [ 25%]
tests/test_database.py::test_analysis_job_type_combinations PASSED       [ 28%]
tests/test_database.py::test_cross_order_reference_rejection PASSED      [ 32%]
tests/test_database.py::test_delay_edge_self_loop_rejection PASSED       [ 35%]
tests/test_database.py::test_delay_edge_cross_order_rejection PASSED     [ 39%]
tests/test_database.py::test_multi_row_trigger_behavior PASSED           [ 42%]
tests/test_database.py::test_immutable_order_stages_parent_reference PASSED [ 46%]
tests/test_database.py::test_immutable_decision_cases_parent_reference PASSED [ 50%]
tests/test_database.py::test_computed_column_correctness PASSED          [ 53%]
tests/test_database.py::test_verification_uniqueness PASSED              [ 57%]
tests/test_database.py::test_migration_upgrade_and_status PASSED         [ 60%]
tests/test_database.py::test_migration_rollback_and_reapply PASSED       [ 64%]
tests/test_database.py::test_stored_procedures_workflow PASSED           [ 67%]
tests/test_database.py::test_analytical_views PASSED                     [ 71%]
tests/test_errors.py::test_404_not_found_envelope PASSED                 [ 75%]
tests/test_errors.py::test_405_method_not_allowed_envelope PASSED        [ 78%]
tests/test_errors.py::test_custom_api_error_handling PASSED              [ 82%]
tests/test_factory.py::test_app_creation_testing_mode PASSED             [ 85%]
tests/test_factory.py::test_app_creation_development_mode PASSED         [ 89%]
tests/test_factory.py::test_root_index_endpoint PASSED                   [ 92%]
tests/test_health.py::test_health_check_success PASSED                   [ 96%]
tests/test_health.py::test_health_check_propagates_request_id PASSED     [100%]

============================= 28 passed in 0.98s ==============================
```

### 2.2 Migration Ledger Verification
Command: `python -m database.migration_runner status`
```
Version    Status     Applied At                Description
---------------------------------------------------------------------------
V001       APPLIED    2026-11-05 09:27:42       initial schema
V002       APPLIED    2026-11-05 09:34:21       triggers views procedures
```

### 2.3 Code Quality & Linter Verification
Command: `flake8 app database tests --max-line-length=120`  
**Result:** Exit Code 0 (0 warnings, 0 violations).

---

## 3. Detailed Architectural Inspection

### 3.1 Relational Schema Completeness (18 Tables)
Every table specified in [`docs/04-database-design.md`](file:///c:/Users/aksha/Desktop/ESPV1/docs/04-database-design.md) exists with correct column definitions and constraints:

1. **`users`**: Identity entity with `email UNIQUE`, `password_hash`, `is_active BIT`, `created_at DATETIME2`.
2. **`roles`**: Standardized RBAC catalog (`role_name UNIQUE`).
3. **`user_roles`**: Composite PK `(user_id, role_id)` with cascading delete from users.
4. **`sellers`**: `owner_user_id UNIQUE`, `business_status` checked (`'ACTIVE'`, `'SUSPENDED'`, `'UNDER_REVIEW'`).
5. **`orders`**: Candidate key `UQ_orders_seller_ref (seller_id, external_order_ref)`; `CK_orders_delivery_window (expected_delivery_at > placed_at)`; status domain constrained.
6. **`order_stages`**: `UQ_order_stages_seq (order_id, sequence_no)`; candidate key `UQ_order_stages_order_stage (order_id, stage_id)` enabling composite FK referencing; status constrained.
7. **`order_events`**: Append-only log with `idempotency_key UNIQUE`, `occurred_at` vs `received_at` separation, source type domain check.
8. **`decision_cases`**: Investigation case tracking with candidate key `UQ_decision_cases_order_case (order_id, case_id)`.
9. **`evidence`**: Binary asset tracking with `blob_uri UNIQUE`, `sha256_hash CHAR(64)`, upload lifecycle checks.
10. **`delay_edges`**: Directional links in delay graph, preserving strict 3NF without redundant `order_id` column.
11. **`interventions`**: Operational catalog with `intervention_code UNIQUE`.
12. **`scenarios`**: Simulation scenarios with candidate key `UQ_scenarios_case_scenario (case_id, scenario_id)`, `confidence_score` checked (0.0 to 1.0), `estimated_cost >= 0.0`.
13. **`scenario_interventions`**: Composite PK `(scenario_id, intervention_id)` with cost contribution.
14. **`decisions`**: Intervention choice records with candidate key `UQ_decisions_case_decision (case_id, decision_id)`.
15. **`verifications`**: Empirical delivery benchmarks with `UQ_verifications_decision (decision_id)` enforcing 1:0..1 cardinality.
16. **`audit_log`**: Append-only audit trail with `actor_user_id` (nullable for system actions), action, entity metadata.
17. **`outbox_events`**: Transactional outbox pattern implementation with retry count and status domain checks.
18. **`analysis_jobs`**: Asynchronous worker orchestration with `idempotency_key UNIQUE` and dependency combination checks.

### 3.2 Composite Foreign Keys & Multi-Tenant Cross-Order Isolation
Six composite foreign keys prevent data leakage across order boundaries at the relational engine level:

1. **`order_events` -> `order_stages`**:
   `CONSTRAINT FK_order_events_order_stage FOREIGN KEY (order_id, stage_id) REFERENCES dbo.order_stages(order_id, stage_id)`
   *Verification:* In SQL Server, if `stage_id` is populated, it is physically impossible for an event to reference a stage belonging to an order different from `order_events.order_id`.
2. **`evidence` -> `order_events`**:
   `CONSTRAINT FK_evidence_order_event FOREIGN KEY (order_id, event_id) REFERENCES dbo.order_events(order_id, event_id)`
   *Verification:* Confirmed by test `test_cross_order_reference_rejection`. An evidence row cannot attach to an event from another order.
3. **`evidence` -> `decision_cases`**:
   `CONSTRAINT FK_evidence_order_case FOREIGN KEY (order_id, case_id) REFERENCES dbo.decision_cases(order_id, case_id)`
   *Verification:* Guarantees evidence cannot cross-link a decision case belonging to a different order.
4. **`analysis_jobs` -> `decision_cases`**:
   `CONSTRAINT FK_analysis_jobs_order_case FOREIGN KEY (order_id, case_id) REFERENCES dbo.decision_cases(order_id, case_id)`
   *Verification:* Guarantees asynchronous analysis jobs cannot investigate a case belonging to another order.
5. **`analysis_jobs` -> `decisions`**:
   `CONSTRAINT FK_analysis_jobs_case_decision FOREIGN KEY (case_id, decision_id) REFERENCES dbo.decisions(case_id, decision_id)`
   *Verification:* Prevents verification jobs from referencing decisions outside the investigated case.
6. **`decisions` -> `scenarios`**:
   `CONSTRAINT FK_decisions_case_scenario FOREIGN KEY (case_id, scenario_id) REFERENCES dbo.scenarios(case_id, scenario_id)`
   *Verification:* Prohibits selecting an intervention scenario that was simulated under a different case.

### 3.3 Database Integrity Triggers & 3NF Delay Graph
Because `delay_edges` deliberately omits a redundant `order_id` column to maintain strict Third Normal Form (3NF), relational cross-order validation is delegated to a database trigger:

- **`trg_delay_edges_order_stage_integrity`**:
  1. Prevents self-loops: Throws `50010` if `from_stage_id = to_stage_id`.
  2. Prevents cross-order leakage: Throws `50011` if `from_stage` or `to_stage` order does not match `decision_cases.order_id`.
  3. Multi-row safety: Evaluates set-based operations using `IF EXISTS (SELECT 1 FROM inserted i JOIN ... WHERE ...)`.
  *Verification:* Tested and confirmed in `test_delay_edge_self_loop_rejection`, `test_delay_edge_cross_order_rejection`, and `test_multi_row_trigger_behavior`.
- **`trg_order_stages_immutable_order`**:
  Throws `50012` if `UPDATE(order_id)` alters `order_id` on an existing stage.
  *Verification:* Confirmed in `test_immutable_order_stages_parent_reference`.
- **`trg_decision_cases_immutable_order`**:
  Throws `50013` if `UPDATE(order_id)` alters `order_id` on an existing case.
  *Verification:* Confirmed in `test_immutable_decision_cases_parent_reference`.

### 3.4 Computed Columns & Epistemological Derivations
In `dbo.verifications`, error metrics are computed natively by the database engine:
- `signed_prediction_error_minutes AS (DATEDIFF(MINUTE, predicted_delivery_at, actual_delivery_at)) PERSISTED`
- `absolute_prediction_error_minutes AS (ABS(DATEDIFF(MINUTE, predicted_delivery_at, actual_delivery_at))) PERSISTED`
- `delivery_variance_minutes AS (DATEDIFF(MINUTE, original_expected_delivery_at, actual_delivery_at)) PERSISTED`

*Auditor Check:* Derivations are marked `PERSISTED`, allowing indexability and eliminating application-level derivation drift. Causal counterfactual recovery is never fabricated as a physical column, preserving Causara domain integrity rules.

### 3.5 Analysis Job State Dependencies (`CK_analysis_jobs_type_deps`)
The check constraint on `analysis_jobs` strictly regulates legal combinations of nullable foreign keys:
```sql
CONSTRAINT CK_analysis_jobs_type_deps CHECK (
    (job_type = 'TIMELINE_RECONSTRUCTION' AND case_id IS NULL AND decision_id IS NULL) OR
    (job_type = 'SCENARIO_SIMULATION' AND case_id IS NOT NULL AND decision_id IS NULL) OR
    (job_type = 'OUTCOME_VERIFICATION' AND case_id IS NOT NULL AND decision_id IS NOT NULL)
)
```
*Verification:* Tested in `test_analysis_job_type_combinations`. Prohibits unattached outcome verifications and prevents timeline reconstructions from binding to specific cases.

### 3.6 Stored Procedures Execution & Transaction Safety
All four stored procedures operate with explicit transactions, error trapping, rollback handling, and audit logging:

1. **`usp_CreateDecisionCase`**: Validates `@OrderId` (error 50001), inserts decision case, generates `analysis_jobs` record (`SCENARIO_SIMULATION`), generates JSON payload in `outbox_events` (`ANALYSIS_JOB_QUEUED`), and inserts `audit_log` (`CASE_OPENED`).
2. **`usp_RecordDecision`**: Validates scenario belongs to case (error 50004), records decision with `decision_status = 'PENDING'`, and logs `audit_log` (`DECISION_RECORDED`).
3. **`usp_ApproveDecision`**: Updates decision to `APPROVED` conditionally on `decision_status = 'PENDING'` (checks `@@ROWCOUNT = 1`, error 50003), logs `audit_log` (`DECISION_APPROVED`), and creates outbox event (`DECISION_APPROVED`).
4. **`usp_VerifyPrediction`**: Retrieves scenario prediction, computes predicted delivery timestamp, executes upsert into `verifications` reconciling existing rows (maintaining 1:0..1 cardinality), transitions `decision_status = 'EXECUTED'`, and records audit log (`PREDICTION_VERIFIED`).

---

## 4. Migration & Rollback Lifecycle Audit

A dedicated scratch database lifecycle test was conducted on Microsoft SQL Server to verify clean execution of all migration and rollback scripts from an empty state:

1. **Forward Cycle**:
   - `V001__initial_schema.sql`: Executed cleanly, creating 18 tables, constraints, and indexes.
   - `V002__triggers_views_procedures.sql`: Executed cleanly, creating 3 triggers, 2 views, and 4 stored procedures.
   - `001_seed_roles_interventions.sql`: Executed cleanly via idempotent `MERGE` statements.
2. **Reverse Cycle**:
   - `U002__triggers_views_procedures_down.sql`: Dropped 4 procedures, 3 triggers, and 2 views cleanly without errors.
   - `U001__initial_schema_down.sql`: Dropped all 18 tables in exact reverse dependency order without foreign key collision errors.

---

## 5. Classified Audit Findings

### Medium Severity Findings

#### Finding M1-01: MigrationRunner does not validate checksums of previously applied migrations
- **Location:** [`database/migration_runner.py#L120-L121`](file:///c:/Users/aksha/Desktop/ESPV1/database/migration_runner.py#L120-L121)
- **Description:** When `MigrationRunner.migrate()` iterates through available migration files, it evaluates:
  ```python
  if version_part in applied:
      continue
  ```
  It skips any already-applied version without comparing `compute_file_checksum(migration_file)` against the recorded checksum in `dbo.schema_migrations`.
- **Consequence:** If an applied migration file (such as `V001__initial_schema.sql`) is subsequently edited on disk, neither `migrate()` nor `status()` alerts or raises an error regarding the file drift.
- **Recommendation:** In `migrate()`, if `version_part in applied`, compare the file checksum with `applied[version_part]["checksum"]`. Raise a `RuntimeError("Checksum mismatch on applied migration ...")` if they differ. Include a checksum verification indicator in `status()`.

---

### Low Severity Findings

#### Finding M1-02: Column naming discrepancy in `vw_SellerDelaySummary` (`avg_delay_hours` vs `avg_excess_delay_hours`)
- **Location:** [`database/migrations/V002__triggers_views_procedures.sql#L17`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V002__triggers_views_procedures.sql#L17) vs [`docs/04-database-design.md#L498`](file:///c:/Users/aksha/Desktop/ESPV1/docs/04-database-design.md#L498)
- **Description:** In the approved design document (`docs/04-database-design.md`), the aggregated delay column is specified as `avg_excess_delay_hours`. In migration `V002__triggers_views_procedures.sql`, it was implemented as `avg_delay_hours`.
- **Consequence:** API layer or frontend dashboards expecting the documented property name `avg_excess_delay_hours` will receive `avg_delay_hours`.
- **Recommendation:** Align the view column name with documentation or update the API documentation accordingly.

#### Finding M1-03: `vw_SellerDelaySummary` aggregates 0.00 delay hours for sellers with zero orders
- **Location:** [`database/migrations/V002__triggers_views_procedures.sql#L15-L17`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V002__triggers_views_procedures.sql#L15-L17)
- **Description:** In the view expression:
  ```sql
  CAST(AVG(CASE WHEN o.actual_delivery_at > o.expected_delivery_at 
                THEN DATEDIFF(MINUTE, o.expected_delivery_at, o.actual_delivery_at) 
                ELSE 0 END) / 60.0 AS DECIMAL(10,2)) AS avg_delay_hours
  ```
  When a seller has no orders (a `LEFT JOIN` result where `o.order_id IS NULL`), `o.actual_delivery_at > o.expected_delivery_at` evaluates to UNKNOWN, falling into `ELSE 0`. Consequently, `AVG(0)` yields `0.00` rather than `NULL` for new sellers with zero order history.
- **Consequence:** Sellers with no orders are reported as having `0.00` delay hours instead of an unrated / null status.
- **Recommendation:** Modify the aggregation to evaluate `CASE WHEN o.order_id IS NOT NULL AND o.actual_delivery_at > o.expected_delivery_at ... ELSE NULL END`.

#### Finding M1-04: Stored procedure negative / error path test coverage
- **Location:** [`tests/test_database.py#L582-L655`](file:///c:/Users/aksha/Desktop/ESPV1/tests/test_database.py#L582-L655)
- **Description:** `test_stored_procedures_workflow` thoroughly exercises the valid happy-path lifecycle across all four stored procedures. However, negative execution paths (e.g., error 50001 on invalid order ID, error 50004 on mismatched scenario, error 50003 on non-pending approval) are not asserted in the automated pytest suite.
- **Recommendation:** Add explicit negative test cases asserting `pyodbc.ProgrammingError` and specific custom error codes (50001, 50003, 50004) when stored procedure validation fails.

#### Finding M1-05: LocalDB configuration defaults to `master` database
- **Location:** [`app/database/connection.py#L19`](file:///c:/Users/aksha/Desktop/ESPV1/app/database/connection.py#L19), [`database/migration_runner.py#L24`](file:///c:/Users/aksha/Desktop/ESPV1/database/migration_runner.py#L24), [`.env.example#L23`](file:///c:/Users/aksha/Desktop/ESPV1/.env.example#L23)
- **Description:** The connection fallback uses `DB_NAME = "master"`. In SQL Server LocalDB, putting application tables in the `master` database is functional for local development but deviates from SQL Server best practices.
- **Recommendation:** Update documentation and `.env.example` recommending creating a dedicated user database `CausaraDB` on LocalDB (`CREATE DATABASE CausaraDB;`) and setting `DB_NAME=CausaraDB`.

---

### Informational / Architectural Observations

#### Observation INFO-01: Documentation Bug Corrected in Implementation (`decision_status = 'VERIFIED'`)
- **Location:** [`docs/04-database-design.md#L728`](file:///c:/Users/aksha/Desktop/ESPV1/docs/04-database-design.md#L728) vs [`database/migrations/V002__triggers_views_procedures.sql#L307`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V002__triggers_views_procedures.sql#L307)
- **Detail:** In `docs/04-database-design.md`, section 6.3 showed `usp_VerifyPrediction` updating `decision_status = 'VERIFIED'`. However, `CK_decisions_status` strictly permits only `('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED')`. The implementation correctly updated the status to `'EXECUTED'`, avoiding a check constraint runtime failure.
- **Action:** Synchronize `docs/04-database-design.md` section 6.3 to reference `'EXECUTED'`.

#### Observation INFO-02: SQL Server Compatibility adaptation (`FOR JSON PATH` vs `JSON_OBJECT`)
- **Location:** [`docs/04-database-design.md#L654`](file:///c:/Users/aksha/Desktop/ESPV1/docs/04-database-design.md#L654) vs [`database/migrations/V002__triggers_views_procedures.sql#L152-L160`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V002__triggers_views_procedures.sql#L152-L160)
- **Detail:** `JSON_OBJECT()` was introduced in SQL Server 2022. The implementation substituted `(SELECT ... FOR JSON PATH, WITHOUT_ARRAY_WRAPPER)`, ensuring complete compatibility with SQL Server 2016-2022, LocalDB, and Azure SQL Database without functional loss.

---

## 6. Actionable Resolution Plan (Post-Audit Approval)

When approved by the project lead, the following minor fixes can be executed cleanly:

1. **Update `database/migration_runner.py`**:
   - Add checksum validation check in `migrate()` to verify applied files have not been modified.
   - Display checksum status in `MigrationRunner.status()`.
2. **Update `docs/04-database-design.md`**:
   - Update line 728 in section 6.3 from `'VERIFIED'` to `'EXECUTED'`.
   - Update `avg_excess_delay_hours` to `avg_delay_hours` (or vice versa).
3. **Enhance `tests/test_database.py`**:
   - Add negative tests for stored procedures (50001, 50003, 50004).

---

## 7. Sign-Off & Conclusion

The Causara M1 Database Implementation successfully fulfills all core requirements of Milestone M1. Relational normalization, composite cross-order protection, parent immutability, asynchronous outbox dispatching, and epistemological constraints are rigorously implemented and verified against Microsoft SQL Server.

The implementation is structurally sound and ready to support Milestone M2 (Backend Domain & Application Services) upon user review of this audit report.
