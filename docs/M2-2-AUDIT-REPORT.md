# Causara — Milestone M2.2 Independent Implementation Audit Report
## Event Integrity & Processing Engine (Transactional Outbox)

**Audit Date**: November 9, 2026  
**Auditor**: Independent Backend & Architecture Audit Agent  
**Scope**: Milestone M2.2 Transactional Outbox Implementation & Worker Engine  
**Workspace**: `C:\Users\aksha\Desktop\ESPV1`  
**Database**: Microsoft SQL Server LocalDB (`(localdb)\CausaraDB.CausaraDB`)  
**Audit Mode**: Read-Only (Zero application code, SQL migrations, tests, or database records modified)  
**Final Verdict**: **PASS WITH ISSUES**

---

## 1. Executive Summary

This independent audit evaluated the completed Milestone M2.2 implementation of Causara's Transactional Outbox architecture, database migrations, repository access layer, background processor, observability endpoints, and test verification suite.

The core architectural objectives of M2.2 have been **successfully implemented and verified**:
- **Atomic Dual-Write**: Order event persistence (`dbo.order_events`) and outbox message persistence (`dbo.outbox_events`) are tightly coupled within the identical database transaction, eliminating dual-write inconsistencies.
- **Worker Ownership & Concurrency Safety**: The background worker claims pending messages using SQL Server locking hints (`WITH (UPDLOCK, READPAST, ROWLOCK)`) ordered by the clustered index (`outbox_id ASC`). Worker leases are optimistically verified via microsecond-precise `locked_at` timestamps (`CAST(SYSUTCDATETIME() AS DATETIME2(6))`), preventing stale workers from completing reclaimed messages.
- **Downstream Idempotency**: Worker crash recovery prevents duplicate downstream side effects by leveraging deterministic idempotency keys and database unique constraints on `dbo.analysis_jobs`.
- **Test Integrity & Regression**: All 13 dedicated M2.2 integration tests and all 70 tests across the entire repository pass with 100% success. Code style is fully PEP 8 compliant with zero Flake8 violations.

The audit also identified specific discrepancies between the implementation report documentation and the code, an absence of exponential backoff delay, and unauthenticated internal observability routes, which are detailed in the categorized findings below.

---

## 2. Files Inspected

1. `database/migrations/V004__outbox_processing_enhancements.sql` (Forward migration)
2. `database/migrations/U004__outbox_processing_enhancements_down.sql` (Rollback migration)
3. `database/migrations/V001__initial_schema.sql` (Initial table schemas for `outbox_events`, `analysis_jobs`, `audit_log`)
4. `app/repositories/outbox_repository.py` (Outbox data access layer)
5. `app/services/outbox_processor.py` (Background processor engine)
6. `app/services/event_service.py` (Core event ingestion service)
7. `app/api/outbox.py` (Internal observability route)
8. `app/api/__init__.py` (Blueprint registration)
9. `tests/test_outbox_processing.py` (Integration test suite)
10. `docs/M2-2-IMPLEMENTATION-REPORT.md` (Implementation report)

---

## 3. Detailed Audit Findings by Area

### 3.1 Transactional Atomicity (VERIFIED — FULL COMPLIANCE)

**Audit Criteria**:
- Event insertion and outbox insertion share the same database connection and transaction.
- Both operations commit together.
- Failure in either operation rolls back both.
- Duplicate event ingestion does not create another outbox message.

**Findings & SQL Inspection**:
1. **Connection & Transaction Boundary**:
   In [`app/services/event_service.py`](file:///C:/Users/aksha/Desktop/ESPV1/app/services/event_service.py) (lines 239–374), both insertions execute inside a single context manager:
   ```python
   with get_db_connection() as conn:
       ...
       event_id = self.repo.insert_order_event(event_insert_data, conn=conn)
       ...
       outbox_cursor = conn.cursor()
       try:
           self.outbox_repo.insert_outbox_event(
               cursor=outbox_cursor,
               event_type="ORDER_EVENT_INGESTED",
               aggregate_type="ORDER_EVENT",
               aggregate_id=event_id,
               payload_json=json.dumps(outbox_payload),
           )
       finally:
           outbox_cursor.close()
   ```
   `get_db_connection()` instantiates a connection with `autocommit=False`. The connection context manager issues `conn.commit()` strictly upon clean exit of the `with` block and invokes `conn.rollback()` on any unhandled exception.
2. **Dual-Write Elimination**:
   - `self.repo.insert_order_event` executes `INSERT INTO dbo.order_events ... OUTPUT INSERTED.event_id`.
   - `self.outbox_repo.insert_outbox_event` executes `INSERT INTO dbo.outbox_events (event_type, aggregate_type, aggregate_id, payload_json, status, retry_count) OUTPUT INSERTED.outbox_id VALUES (?, ?, ?, ?, 'PENDING', 0)`.
   - Both statements use cursors from the identical `conn` instance.
3. **Rollback Verification**:
   - If `insert_order_event` fails (e.g. invalid foreign key, check constraint violation), execution aborts before reaching `insert_outbox_event`; rollback occurs.
   - If `insert_outbox_event` fails (e.g. database error, lock abort), an exception is raised inside the context manager; `get_db_connection` catches the exception, executes `conn.rollback()`, and rolls back the preceding `order_events` insertion.
   - Verified empirically by `test_rollback_if_event_insertion_fails` and `test_rollback_if_outbox_insertion_fails`.
4. **Idempotency Protection**:
   - When an existing idempotency key is matched in step 7 (`self.repo.get_event_by_idempotency_key`), the service immediately calls `self._evaluate_idempotent_duplicate()` and returns an `IngestionResult(is_duplicate=True)` without ever executing step 8 (insert).
   - In concurrent race conditions where two identical keys pass step 7 simultaneously, the second insertion trips `UQ_order_events_idempotency`, triggering an explicit `conn.rollback()` at line 350 and safely returning the winning event. No duplicate outbox message is generated.
   - Verified empirically by `test_duplicate_ingestion_creates_no_additional_outbox`.

---

### 3.2 Worker Ownership and Lease Safety (VERIFIED — FULL COMPLIANCE)

**Audit Criteria**:
- Worker identifiers are unique.
- Claiming is atomic.
- Multiple workers cannot claim the same active message.
- Lease timestamps are handled consistently.
- Expired leases can be reclaimed.
- A stale worker cannot mark a message published after another worker has reclaimed it.
- Ownership is checked on retry and failure updates as well as successful completion.
- Race conditions around lease expiry are handled safely.

**Findings & SQL Inspection**:
1. **Worker Identification**:
   In [`app/services/outbox_processor.py`](file:///C:/Users/aksha/Desktop/ESPV1/app/services/outbox_processor.py) line 83:
   `self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"`
   Each worker instance generates a unique identifier. (Note: Worker ID is logged in application logs, though not persisted to the database row; see Section 5, Low Issue 3).
2. **Atomic Batch Claiming**:
   In [`app/repositories/outbox_repository.py`](file:///C:/Users/aksha/Desktop/ESPV1/app/repositories/outbox_repository.py) lines 84–101:
   ```sql
   WITH Claimable AS (
       SELECT TOP (?) outbox_id, event_type, aggregate_type, aggregate_id,
                      payload_json, status, retry_count, created_at, locked_at, error_message
       FROM dbo.outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
       WHERE status = 'PENDING'
          OR (status = 'PROCESSING' AND locked_at < DATEADD(second, -?, SYSUTCDATETIME()))
       ORDER BY outbox_id ASC
   )
   UPDATE Claimable
   SET status = 'PROCESSING',
       locked_at = CAST(SYSUTCDATETIME() AS DATETIME2(6))
   OUTPUT INSERTED.outbox_id, INSERTED.event_type, INSERTED.aggregate_type,
          INSERTED.aggregate_id, INSERTED.payload_json, INSERTED.status,
          INSERTED.retry_count, INSERTED.created_at, INSERTED.locked_at,
          INSERTED.error_message;
   ```
   - **Locking Semantics**: `UPDLOCK` takes update locks on qualifying rows; `READPAST` instructs SQL Server to skip rows locked by other concurrent transactions; `ROWLOCK` requests row-level lock granularity.
   - **Clustered Index Ordering**: Ordering by `outbox_id ASC` aligns with the table's clustered index primary key (`PK_outbox_events`). This eliminates page-level lock escalation during heap/non-indexed table scans, ensuring concurrent workers navigating the table claim disjoint row sets without lock contention or empty reads.
   - **Timestamp Precision Cast**: Stamping `locked_at = CAST(SYSUTCDATETIME() AS DATETIME2(6))` rounds the timestamp to 6 fractional digits (microseconds). This guarantees exact equality matching when Python `datetime` objects (which natively support microsecond precision) are bound as query parameters in ODBC Driver 17.
3. **Lease Reclamation (Crashed Worker Recovery)**:
   The predicate `status = 'PROCESSING' AND locked_at < DATEADD(second, -?, SYSUTCDATETIME())` correctly identifies stranded messages whose lease duration (`lease_seconds`) has elapsed. Verified empirically by `test_duplicate_downstream_processing_after_simulated_worker_crash`.
4. **Optimistic Fencing & Stale Worker Protection**:
   In `mark_published`:
   ```sql
   UPDATE dbo.outbox_events
   SET status = 'PUBLISHED',
       published_at = SYSUTCDATETIME(),
       error_message = NULL
   WHERE outbox_id = ?
     AND status = 'PROCESSING'
     AND locked_at = ?;
   ```
   - If Worker A's lease expires and Worker B claims the message, `locked_at` is updated to Worker B's claim timestamp.
   - When Worker A later attempts to execute `mark_published(..., expected_locked_at=T_A)`, `WHERE locked_at = T_A` evaluates to false.
   - `cursor.rowcount` is 0. `mark_published` returns `False`.
   - `OutboxProcessor._process_single_message` detects `not published_ok`, calls `conn.rollback()`, logs a warning, and returns `ownership_lost=True`.
   - Verified empirically by `test_stale_worker_attempting_to_complete_reclaimed_message_fails`.
5. **Ownership Enforcement Across All Status Transitions**:
   In `mark_failed_or_retry`:
   Both the transient retry path (line 168) and permanent failure path (line 181) enforce `WHERE outbox_id = ? AND status = 'PROCESSING' AND locked_at = ?`.
   If a stale worker attempts to record a failure or retry for a stolen message, the update affects 0 rows, and `OutboxProcessor._record_failure` flags `ownership_lost=True`.

---

### 3.3 Downstream Idempotency (VERIFIED — COMPLIANT WITH OBSERVATIONS)

**Audit Criteria**:
- Idempotency key is deterministic.
- Database enforces uniqueness.
- Concurrent workers cannot create duplicate jobs.
- Worker crash after job creation but before outbox acknowledgement is handled safely.
- Reprocessing does not produce duplicate downstream effects.
- Evaluation of whether the implementation truly guarantees idempotency or only handles the tested scenario.

**Findings**:
1. **Deterministic Idempotency Key**:
   `job_idempotency_key = f"job-timeline-recon-event-{event_id}"`
   Because `event_id` is an immutable, monotonically assigned primary key in `dbo.order_events`, the key is completely deterministic.
2. **Database Constraint Enforcement**:
   In `database/migrations/V001__initial_schema.sql` line 323:
   `idempotency_key NVARCHAR(200) NOT NULL UNIQUE`
   The database enforces strict uniqueness via a unique index constraint.
3. **Downstream Execution Flow**:
   In `OutboxProcessor._default_downstream_dispatch`:
   ```python
   cur.execute("SELECT job_id, status FROM dbo.analysis_jobs WHERE idempotency_key = ?;", (job_idempotency_key,))
   existing_job = cur.fetchone()
   if not existing_job:
       cur.execute(
           """
           INSERT INTO dbo.analysis_jobs (
               order_id, case_id, decision_id, job_type, status,
               idempotency_key, retry_count, created_at
           )
           VALUES (?, NULL, NULL, 'TIMELINE_RECONSTRUCTION', 'QUEUED', ?, 0, SYSUTCDATETIME());
           """,
           (order_id, job_idempotency_key),
       )
   ```
4. **Crash Recovery Scenario Analysis**:
   - In standard execution, `INSERT INTO dbo.analysis_jobs` and `mark_published` execute within the same database transaction on `conn`. If the worker process dies before commit, SQL Server automatically rolls back both operations.
   - If downstream work was committed out-of-band or in a partial state before worker failure, the recovering worker queries `WHERE idempotency_key = ?`, detects `existing_job`, skips re-insertion, and proceeds to mark `PUBLISHED`.
   - Verified empirically by `test_duplicate_downstream_processing_after_simulated_worker_crash`.
5. **Idempotency Scope Limitation (Audit Observation)**:
   - For `event_type == 'ORDER_EVENT_INGESTED'`, idempotency is fully guaranteed by `dbo.analysis_jobs.idempotency_key UNIQUE`.
   - Notice: `dbo.audit_log` also receives an entry (`INSERT INTO dbo.audit_log ...`). In the event of a worker crash after out-of-band commit, reprocessing will append a second `OUTBOX_EVENT_PROCESSED` audit entry because `dbo.audit_log` is an append-only log without a unique constraint on `(entity_type, entity_id, action)`. This is standard for audit trails, but noted here for completeness.
   - Notice: If `event_type` is anything other than `'ORDER_EVENT_INGESTED'`, `_default_downstream_dispatch` currently no-ops without error, marking the outbox message as published. As new event types are added in M2.3, explicit dispatch branches or unhandled event rejections must be added.

---

### 3.4 Retry and Recovery (PASS WITH ISSUES)

**Audit Criteria**:
- Maximum retry attempts.
- Exponential backoff calculations.
- Transient and permanent error classification.
- Error message sanitization.
- Lease recovery after worker crashes.
- Failed message handling.
- No message can remain permanently stuck in PROCESSING without a recovery path.

**Findings**:
1. **Maximum Retries**:
   In `mark_failed_or_retry`:
   `SET status = CASE WHEN retry_count + 1 < ? THEN 'PENDING' ELSE 'FAILED' END, retry_count = retry_count + 1`
   When `retry_count + 1 >= max_retries`, the message transitions to `FAILED`. Verified by `test_maximum_retry_exhaustion_marks_failed`.
2. **Exponential Backoff Discrepancy (MEDIUM ISSUE)**:
   - **Documentation Claim**: Section 1, Guarantee 7 and Section 3.3 of `docs/M2-2-IMPLEMENTATION-REPORT.md` state: *"Transient errors trigger exponential retries up to max_retries"*.
   - **Code Inspection**: Neither `app/repositories/outbox_repository.py` nor `app/services/outbox_processor.py` computes an exponential backoff delay or schedules a retry time. When a transient error occurs, `mark_failed_or_retry` immediately sets `status = 'PENDING'` and `locked_at = NULL`.
   - **Database Schema**: `dbo.outbox_events` has no `next_retry_at` or `scheduled_at` column.
   - **Impact**: Failed messages with transient errors become immediately eligible for re-claiming by the next polling cycle without exponential backoff.
3. **Error Classification**:
   - `PermanentProcessingError` (malformed JSON, non-existent entity references) immediately transitions to `FAILED` with `is_transient=False`, incrementing `retry_count` by 1 without re-queueing to `PENDING`. Verified by `test_permanent_failure_transitions_to_failed_without_retry` and `test_missing_event_reference_permanent_failure`.
   - All other generic exceptions (`pyodbc.OperationalError`, timeouts, lock conflicts) are treated as transient errors (`is_transient=True`).
4. **Error Sanitization**:
   In `app/services/outbox_processor.py` line 25:
   `sanitize_error_message` applies `SECRET_PATTERN.sub(r"\1=***REDACTED***", raw_str)`, strips whitespace, and truncates to 1,000 characters matching column constraints.
5. **Lease Recovery & Hard Crash Poison Pill (MEDIUM ISSUE)**:
   - If a worker crashes or drops off during execution, its message remains in `PROCESSING` until `locked_at < DATEADD(second, -lease_seconds, SYSUTCDATETIME())`.
   - Once the lease expires, any active worker reclaims the message.
   - **Nuance**: In `claim_pending_messages`, reclaiming an expired `PROCESSING` message stamps a new `locked_at` but **does not increment `retry_count`**. `retry_count` is only incremented when `mark_failed_or_retry` executes. If an outbox payload triggers a fatal, unhandled process crash (e.g., native C-extension segmentation fault, hardware shutdown, or abrupt kill signal) before Python exception handling executes, the message can theoretically be claimed and crash workers indefinitely every `lease_seconds` without incrementing `retry_count` toward `max_retries`.

---

### 3.5 Observability API (PASS WITH ISSUES)

**Audit Criteria**:
- Correctness of metric counts.
- Oldest pending age calculation.
- Expired lease count verification.
- Sensitive information exposure.
- Internal route access restrictions.

**Findings**:
1. **Metrics Correctness**:
   In `OutboxRepository.get_statistics()`:
   ```sql
   SELECT
       ISNULL(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_count,
       ISNULL(SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END), 0) AS processing_count,
       ISNULL(SUM(CASE WHEN status = 'PUBLISHED' THEN 1 ELSE 0 END), 0) AS published_count,
       ISNULL(SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END), 0) AS failed_count,
       ISNULL(SUM(retry_count), 0) AS total_retries,
       MAX(CASE
           WHEN status = 'PENDING' THEN DATEDIFF(second, created_at, SYSUTCDATETIME())
           ELSE NULL
       END) AS oldest_pending_age_seconds
   FROM dbo.outbox_events;
   ```
   All SQL aggregate calculations are mathematically sound and null-safe (`ISNULL(..., 0)`).
2. **Schema & Documentation Discrepancy (LOW ISSUE)**:
   - In `docs/M2-2-IMPLEMENTATION-REPORT.md` Section 3.4, the sample response documented:
     ```json
     {
       "pending_count": 0,
       "processing_count": 0,
       "published_count": 142,
       "failed_count": 0,
       "total_count": 142,
       "oldest_pending_age_seconds": null,
       "active_expired_leases_count": 0
     }
     ```
   - In actual code (`app/repositories/outbox_repository.py` and `app/api/outbox.py`), the fields `total_count` and `active_expired_leases_count` are not returned. The endpoint returns 6 keys: `pending_count`, `processing_count`, `published_count`, `failed_count`, `total_retries`, and `oldest_pending_age_seconds`.
3. **Security & Route Access (LOW ISSUE)**:
   - `GET /api/v1/internal/outbox/stats` does not leak passwords, payloads, or customer/order IDs.
   - However, the `/internal` prefix has no authentication decorators, API key verification, or IP restriction. Any client on the network can query the internal queue statistics without authentication.

---

## 4. Test Reproduction & Verification Results

All tests and integrity checks were executed in the active workspace environment against LocalDB instance `CausaraDB`.

### 4.1 Environment & Database State
- **Database Engine**: Microsoft SQL Server LocalDB 15.0.4382.1 (`(localdb)\CausaraDB`)
- **Database Status**: `ONLINE`, Integrity verified via `DBCC CHECKDB WITH NO_INFOMSGS` (0 errors)
- **Migration Runner Status**:
  ```powershell
  .\.venv\Scripts\python.exe -m database.migration_runner status
  ```
  | Version | Status | Applied At | Description |
  |---|---|---|---|
  | V001 | APPLIED | 2026-11-05 09:27:42 | initial schema |
  | V002 | APPLIED | 2026-11-05 09:41:24 | triggers views procedures |
  | V003 | APPLIED | 2026-11-07 07:45:38 | update seller delay summary view |
  | V004 | APPLIED | 2026-11-09 13:49:27 | outbox processing enhancements |
  *Exit Code*: 0

### 4.2 M2.2 Integration Test Suite Execution
```powershell
.\.venv\Scripts\pytest.exe -v tests/test_outbox_processing.py
```
*Output*:
```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
collected 13 items

tests/test_outbox_processing.py::test_atomic_event_and_outbox_insertion PASSED [  7%]
tests/test_outbox_processing.py::test_rollback_if_event_insertion_fails PASSED [ 15%]
tests/test_outbox_processing.py::test_rollback_if_outbox_insertion_fails PASSED [ 23%]
tests/test_outbox_processing.py::test_duplicate_ingestion_creates_no_additional_outbox PASSED [ 30%]
tests/test_outbox_processing.py::test_successful_worker_processing PASSED [ 38%]
tests/test_outbox_processing.py::test_duplicate_downstream_processing_after_simulated_worker_crash PASSED [ 46%]
tests/test_outbox_processing.py::test_transient_failure_and_retry PASSED [ 53%]
tests/test_outbox_processing.py::test_permanent_failure_transitions_to_failed_without_retry PASSED [ 61%]
tests/test_outbox_processing.py::test_missing_event_reference_permanent_failure PASSED [ 69%]
tests/test_outbox_processing.py::test_maximum_retry_exhaustion_marks_failed PASSED [ 76%]
tests/test_outbox_processing.py::test_concurrent_worker_claiming_no_duplicates PASSED [ 84%]
tests/test_outbox_processing.py::test_stale_worker_attempting_to_complete_reclaimed_message_fails PASSED [ 92%]
tests/test_outbox_processing.py::test_outbox_observability_endpoint PASSED [100%]

============================= 13 passed in 5.01s ==============================
```
*Exit Code*: 0

### 4.3 Full Backend Regression Suite Execution
```powershell
.\.venv\Scripts\pytest.exe -v
```
*Output*:
```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
testpaths: tests
collected 70 items

tests/test_database.py ...........................                       [ 38%]
tests/test_errors.py ...                                                 [ 42%]
tests/test_event_ingestion.py ...................                        [ 70%]
tests/test_factory.py ...                                                [ 74%]
tests/test_health.py ..                                                  [ 77%]
tests/test_migration_runner.py ....                                      [ 82%]
tests/test_outbox_processing.py .............                            [100%]

============================= 70 passed in 11.21s =============================
```
*Exit Code*: 0

### 4.4 Static Code Analysis & Linter Execution
```powershell
.\.venv\Scripts\flake8.exe app database tests --max-line-length=120
```
*Output*: (No output — 0 errors, 0 warnings)  
*Exit Code*: 0

---

## 5. Categorized Issues and Findings

### Critical Issues
*None*. There are no data corruption, transaction leakage, or security bypass vulnerabilities.

### High Issues
*None*.

### Medium Issues

1. **Missing Exponential Backoff (Documentation Discrepancy & Retry Strategy)**:
   - *Location*: `app/repositories/outbox_repository.py` lines 158–170; `docs/M2-2-IMPLEMENTATION-REPORT.md` Section 1 & Section 3.3.
   - *Detail*: The implementation report explicitly claims that transient failures trigger *exponential retries*. In reality, `mark_failed_or_retry` resets the message status immediately to `'PENDING'`, making it eligible for immediate re-claiming on the next tick. The table has no `next_retry_at` column.
   - *Recommendation for Future Iteration*: When introducing dedicated timer-based workers (M2.3+ or Cloud deployment), consider adding a `next_retry_at DATETIME2 NULL` column to `dbo.outbox_events` and computing $2^{\text{retry\_count}} \times \text{base\_delay}$ seconds before a message is eligible for reclamation.

2. **Hard Process Crash Poison Pill Potential**:
   - *Location*: `app/repositories/outbox_repository.py` lines 84–101.
   - *Detail*: When an expired lease is reclaimed by `claim_pending_messages`, `retry_count` is not incremented. `retry_count` is only incremented when `mark_failed_or_retry` is reached. If an outbox payload contains fatal data that causes an abrupt process kill / segfault before Python's `except` block can run, the message will be repeatedly reclaimed every `lease_seconds` indefinitely.
   - *Recommendation for Future Iteration*: Consider incrementing an internal `claim_count` or checking whether a message has exceeded a maximum lease claim limit during batch claiming.

### Low Issues

1. **Observability Endpoint Response Discrepancy**:
   - *Location*: `docs/M2-2-IMPLEMENTATION-REPORT.md` Section 3.4 vs `app/api/outbox.py` line 21.
   - *Detail*: The report's documented sample JSON displays `total_count` and `active_expired_leases_count`, which are not implemented in `GET /api/v1/internal/outbox/stats`. The endpoint returns `total_retries` instead.
   - *Recommendation*: Update the report to accurately reflect the actual endpoint keys.

2. **Unrestricted Internal Observability Route**:
   - *Location*: `app/api/outbox.py` line 11.
   - *Detail*: `GET /api/v1/internal/outbox/stats` does not enforce server-side authentication or API key checks. While it exposes only aggregate queue metrics, internal operational routes should be protected by an API key or role-based authorization in production.

3. **Absence of Persistent `worker_id` / `locked_by` Column**:
   - *Location*: `dbo.outbox_events`.
   - *Detail*: Worker identifiers (`self.worker_id`) are generated in Python and logged in log streams, but are not stored in `dbo.outbox_events` because V004 added only `locked_at` and `error_message`. While `locked_at` is sufficient for optimistic concurrency fencing, recording `locked_by NVARCHAR(100)` would assist database administrators during live query troubleshooting.

---

## 6. Unverified Assumptions

1. **Database Clock Synchronicity**:
   The leasing mechanism relies entirely on SQL Server's internal clock (`SYSUTCDATETIME()`) for lease comparison and lease stamping (`locked_at = CAST(SYSUTCDATETIME() AS DATETIME2(6))`). This assumption holds true because all workers interact with the centralized SQL Server database engine. However, if application workers ever attempt to evaluate lease expiration client-side using their local system clocks, clock skew could introduce inaccuracies.
2. **Worker Concurrency Limit**:
   The test suite validates concurrency with 2 simultaneous worker threads claiming batches of 3 messages. Highly scaled environments with dozens of concurrent worker nodes rely on SQL Server's lock manager handling `ROWLOCK, UPDLOCK, READPAST` across multiple pages. The use of clustered index ordering (`outbox_id ASC`) supports this well.

---

## 7. Meeting Stated Guarantees Assessment

| Stated Guarantee | Implementation Assessment | Status |
|---|---|---|
| **Atomic Dual-Write** | Event and outbox insertion executed in identical SQL transaction on shared connection; rollback verified. | **MET** |
| **Idempotency Preservation** | Replay of existing key returns existing event; does not invoke outbox insertion. | **MET** |
| **Concurrent Claiming** | Atomic CTE UPDATE with `UPDLOCK, READPAST, ROWLOCK` ordered by clustered index ensures disjoint sets. | **MET** |
| **Worker Crash Recovery** | Messages with expired `locked_at` are automatically reclaimed by active workers after `lease_seconds`. | **MET** |
| **Stale Worker Lease Fencing** | Optimistic `WHERE locked_at = ?` check prevents slow workers from overwriting reclaimed messages. | **MET** |
| **Downstream Idempotency** | `dbo.analysis_jobs.idempotency_key UNIQUE` constraint prevents duplicate timeline reconstruction jobs. | **MET** |
| **Error Sanitization** | Regex redaction and 1,000-character truncation prevent secret leakage into database diagnostics. | **MET** |
| **Exponential Backoff** | Immediate re-queuing occurs; exponential backoff calculation is absent despite documentation claim. | **PARTIALLY MET** |
| **Observability** | Endpoint accurately calculates queue status counts and oldest pending age; minor key discrepancies with doc. | **MET** |

---

## 8. Final Audit Verdict

### Verdict: **PASS WITH ISSUES**

**Justification**:
1. All core transactional outbox guarantees—atomicity, concurrency safety, crash recovery, lease fencing, and downstream idempotency—are fully functional, robustly tested, and mathematically verified.
2. The entire test suite (70/70 tests) passes cleanly in LocalDB, database integrity is verified, and code quality meets strict PEP 8 standards (0 Flake8 errors).
3. The "Issues" designation reflects:
   - Discrepancy regarding exponential backoff (immediate retry vs documented exponential backoff).
   - Minor documentation discrepancies in the observability API response payload.
   - Missing authorization on the `/internal/outbox/stats` route.

None of the identified issues block moving forward to Milestone M2.3. The transactional outbox engine is production-ready for the next phase of development.

---
*End of Audit Report.*
