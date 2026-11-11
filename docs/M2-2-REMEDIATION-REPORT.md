# Causara — Milestone M2.2 Audit Remediation Report
## Asynchronous Outbox Processing Engine Remediation

**Milestone**: M2.2 Remediation  
**Date**: November 9, 2026  
**Status**: COMPLETE & VERIFIED  
**Audit Reference**: `docs/M2-2-AUDIT-REPORT.md`  
**Database**: Microsoft SQL Server LocalDB (`(localdb)\CausaraDB.CausaraDB`)  
**Migrations Applied**: `V001`, `V002`, `V003`, `V004`, `V005` (All validated)  
**Test Suite**: 78/78 PASSED (100%)  
**Code Quality**: Flake8 Clean (0 errors / 0 warnings across `app`, `database`, `tests`)

---

## 1. Executive Summary

Following the independent implementation audit of Milestone M2.2 documented in `docs/M2-2-AUDIT-REPORT.md`, four remediation items were approved and scheduled for implementation:

1. **Exponential Retry Backoff**: Replace immediate re-claiming of transiently failed outbox messages with bounded exponential backoff scheduled via a new database column `next_retry_at`.
2. **Hard-Crash Recovery Counting**: Increment `retry_count` atomically upon reclaiming an expired worker lease, apply retry exhaustion dead-lettering (`FAILED`), record a sanitized recovery diagnostic, and eliminate race conditions between concurrent recovery workers.
3. **Observability Documentation Alignment**: Correct discrepancies in `docs/M2-2-IMPLEMENTATION-REPORT.md` so that documented metrics, fields, and descriptions match the actual operational response from `GET /api/v1/internal/outbox/stats`.
4. **Internal Statistics Endpoint Protection**: Secure the operational `/stats` endpoint with environment-configured API key verification (`INTERNAL_API_KEY`) using constant-time comparison ahead of Milestone M3 authentication architecture.

All four findings have been remediated, verified on an isolated scratch database lifecycle, integrated into production code, and validated through dedicated automated integration tests.

---

## 2. Database Schema & Migration Changes (V005 / U005)

### 2.1 Forward Migration (`database/migrations/V005__outbox_exponential_backoff.sql`)
Introduces `next_retry_at DATETIME2 NULL` to track the earliest timestamp at which a retried outbox message can be claimed by background workers:

```sql
-- ============================================================================
-- Causara Database Migration: V005__outbox_exponential_backoff.sql
-- Description: Adds next_retry_at column to dbo.outbox_events to support
--              exponential retry backoff with bounded delays.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'next_retry_at') IS NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    ADD next_retry_at DATETIME2 NULL;
END;
GO
```

### 2.2 Rollback Migration (`database/migrations/U005__outbox_exponential_backoff_down.sql`)
Provides clean, non-destructive rollbacks:

```sql
-- ============================================================================
-- Causara Rollback Migration: U005__outbox_exponential_backoff_down.sql
-- Description: Drops next_retry_at column from dbo.outbox_events.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'next_retry_at') IS NOT NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    DROP COLUMN next_retry_at;
END;
GO
```

### 2.3 Verification Lifecycle
- Created an isolated scratch database `CausaraScratch_V005` on `(localdb)\CausaraDB`.
- Validated forward migration sequence (`V001` through `V005`).
- Validated rollback migration (`U005`), verifying clean removal of `next_retry_at`.
- Validated re-application (`V005`), verifying idempotency.
- Applied `V005` to production LocalDB `CausaraDB` and verified ledger status via `python -m database.migration_runner status`.

---

## 3. Remediation Details by Finding

### 3.1 Finding 1: Exponential Retry Backoff

#### Repository Layer (`app/repositories/outbox_repository.py`)
- Updated `claim_pending_messages` query to filter claimable `PENDING` messages:
  ```sql
  WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= SYSUTCDATETIME()))
     OR (status = 'PROCESSING' AND locked_at < DATEADD(second, -?, SYSUTCDATETIME()))
  ```
- When a message is successfully claimed or published, `next_retry_at` is cleared to `NULL`.
- Updated `mark_failed_or_retry` with `retry_delay_seconds: Optional[int] = None`:
  - When `is_transient` is True and retries remain (`retry_count + 1 < max_retries`), sets `next_retry_at = DATEADD(second, ?, SYSUTCDATETIME())` using SQL Server UTC time, eliminating client-server clock skew.
  - When retries are exhausted or failure is permanent, `next_retry_at` is set to `NULL` and `status` transitions to `'FAILED'`.

#### Processor Layer (`app/services/outbox_processor.py`)
- Added configurable backoff parameters to `OutboxProcessor.__init__`:
  - `base_backoff_seconds: float = 1.0`
  - `backoff_multiplier: float = 2.0`
  - `max_backoff_seconds: float = 300.0`
- Implemented `compute_backoff_delay(retry_count: int) -> int`:
  $$\text{delay} = \min\left(\text{max\_backoff\_seconds}, \text{base\_backoff\_seconds} \times \text{backoff\_multiplier}^{\text{retry\_count}}\right)$$
- On transient exceptions, computes the delay for the message's current retry count and passes it to `_record_failure`.

---

### 3.2 Finding 2: Hard-Crash Recovery Counting & Retry Exhaustion

#### Atomic Reclaim in SQL Server CTE
Previously, reclaiming an expired lease only stamped a new `locked_at` without incrementing `retry_count`. If a worker crashed repeatedly during downstream processing, the message could be reclaimed infinitely.

Remediated atomic SQL CTE update in `OutboxRepository.claim_pending_messages`:
```sql
WITH Claimable AS (
    SELECT TOP (?) outbox_id, event_type, aggregate_type, aggregate_id,
                   payload_json, status, retry_count, created_at, locked_at,
                   error_message, next_retry_at
    FROM dbo.outbox_events WITH (UPDLOCK, READPAST, ROWLOCK)
    WHERE (status = 'PENDING' AND (next_retry_at IS NULL OR next_retry_at <= SYSUTCDATETIME()))
       OR (status = 'PROCESSING' AND locked_at < DATEADD(second, -?, SYSUTCDATETIME()))
    ORDER BY outbox_id ASC
)
UPDATE Claimable
SET status = CASE
        WHEN status = 'PROCESSING' AND retry_count + 1 >= ? THEN 'FAILED'
        ELSE 'PROCESSING'
    END,
    retry_count = CASE
        WHEN status = 'PROCESSING' THEN retry_count + 1
        ELSE retry_count
    END,
    locked_at = CASE
        WHEN status = 'PROCESSING' AND retry_count + 1 >= ? THEN NULL
        ELSE CAST(SYSUTCDATETIME() AS DATETIME2(6))
    END,
    next_retry_at = NULL,
    error_message = CASE
        WHEN status = 'PROCESSING' AND retry_count + 1 >= ?
            THEN 'Maximum retries exhausted (worker lease expired)'
        WHEN status = 'PROCESSING'
            THEN 'Worker lease expired; reclaimed by recovery worker'
        ELSE error_message
    END
OUTPUT INSERTED.outbox_id, INSERTED.event_type, INSERTED.aggregate_type,
       INSERTED.aggregate_id, INSERTED.payload_json, INSERTED.status,
       INSERTED.retry_count, INSERTED.created_at, INSERTED.locked_at,
       INSERTED.error_message, INSERTED.next_retry_at;
```

#### Key Guarantees:
1. **Atomic Crash Counting**: `retry_count` is incremented atomically inside the CTE update if and only if `status = 'PROCESSING'`. For `status = 'PENDING'`, `retry_count` is NOT incremented upon claim, preventing double-counting of normal transient failures.
2. **Dead-Lettering on Exhaustion**: If `retry_count + 1 >= max_retries` when reclaiming an expired lease, the message transitions directly to `FAILED`, `locked_at` is set to `NULL`, and a diagnostic message is recorded.
3. **Downstream Safety**: `OutboxProcessor.process_batch` checks if a claimed message has `status == 'FAILED'`. If so, it records the message in `summary.failed_count` and immediately skips downstream dispatch, ensuring crashing tasks never execute downstream side-effects once retries expire.
4. **Race Elimination**: `WITH (UPDLOCK, READPAST, ROWLOCK)` guarantees that two concurrent recovery workers cannot claim or increment the same expired lease twice.
5. **Stale Worker Rejection**: If the original crashed worker revives, its attempt to call `mark_published` or `mark_failed_or_retry` checks `WHERE locked_at = ?`, which fails because `locked_at` was replaced by the recovery worker or cleared to `NULL`.

---

### 3.3 Finding 3: Observability Documentation Alignment

Updated `docs/M2-2-IMPLEMENTATION-REPORT.md` Sections 1.8 and 3.4 to align precisely with `app/api/outbox.py`:
- Replaced the mismatched JSON snippet with the exact 6-field payload structure returned in the standard Causara envelope.
- Documented definitions, data types, snapshot vs cumulative nature, and units for all 6 fields:
  - `pending_count` (Snapshot gauge)
  - `processing_count` (Snapshot gauge)
  - `published_count` (Cumulative counter)
  - `failed_count` (Cumulative counter)
  - `total_retries` (Cumulative counter)
  - `oldest_pending_age_seconds` (Snapshot gauge in seconds)
- Explicitly documented unexposed metrics (`total_count`, `active_expired_leases_count`) explaining their derivation.

---

### 3.4 Finding 4: Internal Endpoint Authentication

#### Configuration (`app/config.py`)
Added `INTERNAL_API_KEY`:
- `BaseConfig`: `os.getenv("INTERNAL_API_KEY", "")`
- `DevelopmentConfig`: defaults to `"dev-internal-key"`
- `TestingConfig`: defaults to `"test-internal-api-key"`
- `ProductionConfig`: reads strictly from environment

#### Authentication Enforcement (`app/api/outbox.py`)
- Created `_verify_internal_api_key()`:
  - Extracts key from `X-Internal-API-Key` or `Authorization: Bearer <key>`.
  - Compares with `current_app.config["INTERNAL_API_KEY"]` using `hmac.compare_digest` to prevent timing attacks.
  - On missing or mismatched keys, raises `APIError(code="UNAUTHORIZED", message="Valid internal API key is required to access outbox metrics.", status_code=401)`.
  - Never logs supplied keys.
  - Documented as an interim operational control ahead of Milestone M3.

---

## 4. Verification & Testing

### 4.1 Automated Test Suite (`tests/test_outbox_processing.py`)
The outbox test suite expanded from 13 to 21 tests:

| # | Test Name | Target Behavior | Result |
|---|-----------|-----------------|--------|
| 1 | `test_atomic_event_and_outbox_insertion` | Event and outbox record persist atomically | **PASSED** |
| 2 | `test_rollback_if_event_insertion_fails` | Failed event rollback creates no outbox record | **PASSED** |
| 3 | `test_rollback_if_outbox_insertion_fails` | Failed outbox rollback creates no event record | **PASSED** |
| 4 | `test_duplicate_ingestion_creates_no_additional_outbox` | Idempotent replay does not duplicate outbox entries | **PASSED** |
| 5 | `test_successful_worker_processing` | Worker claims pending message, marks PUBLISHED | **PASSED** |
| 6 | `test_duplicate_downstream_processing_after_simulated_worker_crash` | Reclaimed message detects existing downstream effect | **PASSED** |
| 7 | `test_transient_failure_and_retry` | Transient error increments retry_count and sets backoff | **PASSED** |
| 8 | `test_permanent_failure_transitions_to_failed_without_retry` | Malformed JSON fails immediately without retry | **PASSED** |
| 9 | `test_missing_event_reference_permanent_failure` | Non-existent event reference permanently fails | **PASSED** |
| 10 | `test_maximum_retry_exhaustion_marks_failed` | Exceeding max_retries transitions status to FAILED | **PASSED** |
| 11 | `test_concurrent_worker_claiming_no_duplicates` | Concurrent threads claim disjoint message batches | **PASSED** |
| 12 | `test_stale_worker_attempting_to_complete_reclaimed_message_fails` | Zombie worker with expired lease rejected on completion | **PASSED** |
| 13 | `test_outbox_observability_endpoint` | GET `/api/v1/internal/outbox/stats` returns metrics with auth | **PASSED** |
| 14 | `test_exponential_retry_backoff_delays_and_caps` | Backoff delay formula scales exponentially and caps | **PASSED** |
| 15 | `test_pending_message_not_claimed_before_next_retry_at` | Future `next_retry_at` messages are skipped during claiming | **PASSED** |
| 16 | `test_pending_message_claimed_after_next_retry_at_elapses` | Elapsed `next_retry_at` messages are claimed, clearing retry timestamp | **PASSED** |
| 17 | `test_hard_crash_recovery_increments_retry_count_and_sets_diagnostic` | Expired lease claim increments retry_count and sets diagnostic | **PASSED** |
| 18 | `test_hard_crash_retry_exhaustion_marks_failed` | Expired lease at retry limit dead-letters to FAILED without dispatch | **PASSED** |
| 19 | `test_internal_outbox_stats_auth_missing_key` | Request without API key returns 401 UNAUTHORIZED | **PASSED** |
| 20 | `test_internal_outbox_stats_auth_invalid_key` | Request with incorrect API key returns 401 UNAUTHORIZED | **PASSED** |
| 21 | `test_internal_outbox_stats_auth_valid_bearer_token` | Request with Bearer token succeeds with 200 OK | **PASSED** |

### 4.2 Full Regression Suite
All 78 tests across the Causara test suite passed cleanly:
```
tests/test_database.py ...........................                       [ 34%]
tests/test_errors.py ...                                                 [ 38%]
tests/test_event_ingestion.py ...................                        [ 62%]
tests/test_factory.py ...                                                [ 66%]
tests/test_health.py ..                                                  [ 69%]
tests/test_migration_runner.py ....                                      [ 74%]
tests/test_outbox_processing.py .....................                    [100%]

============================= 78 passed in 6.95s ==============================
```

### 4.3 Code Quality & Linting
```powershell
.venv\Scripts\flake8.exe app database tests --max-line-length=120
# Exited with code 0 (zero errors, zero warnings)
```

---

## 5. Scope & Compliance Verification

| Requirement | Audit Finding | Status |
|---|---|---|
| Migration V005 & U005 | Implemented and verified on scratch DB; applied to LocalDB | **COMPLIANT** |
| Exponential Retry Backoff | Implemented with configurable base, multiplier, and ceiling | **COMPLIANT** |
| Crash Attempt Counting | Implemented atomically inside SQL CTE; dead-letters on exhaustion | **COMPLIANT** |
| Observability Docs Aligned | Documented exact 6 fields, units, definitions, and types | **COMPLIANT** |
| Endpoint Auth Protection | Protected `/stats` with `INTERNAL_API_KEY` via `hmac.compare_digest` | **COMPLIANT** |
| Strict Isolation | No Azure services provisioned; all operations on LocalDB | **COMPLIANT** |
| No Premature M2.3 Scope | Stopped upon completing M2.2 remediation; awaiting instructions | **COMPLIANT** |

---

## 6. Files Created and Modified

### Files Created
- `database/migrations/V005__outbox_exponential_backoff.sql`: Schema migration adding `next_retry_at DATETIME2 NULL`.
- `database/migrations/U005__outbox_exponential_backoff_down.sql`: Rollback migration dropping `next_retry_at`.
- `docs/M2-2-REMEDIATION-REPORT.md`: This remediation report.

### Files Modified
- `app/config.py`: Added `INTERNAL_API_KEY` to configuration classes.
- `app/api/outbox.py`: Added `_verify_internal_api_key()` to protect `/api/v1/internal/outbox/stats`.
- `app/repositories/outbox_repository.py`:
  - Updated `claim_pending_messages` to enforce `next_retry_at` backoff and atomically count/exhaust crashed worker leases.
  - Updated `mark_published` to clear `next_retry_at`.
  - Updated `mark_failed_or_retry` to accept `retry_delay_seconds` and compute `next_retry_at`.
  - Added `next_retry_at` to `get_outbox_event_by_id`.
- `app/services/outbox_processor.py`:
  - Added configurable backoff parameters and `compute_backoff_delay`.
  - Updated `process_batch` to pass `max_retries` to claim query and skip downstream execution for messages dead-lettered during claim.
  - Updated `_process_single_message` to pass computed backoff delay to failure recording.
- `docs/M2-2-IMPLEMENTATION-REPORT.md`: Aligned observability documentation with exact endpoint responses.
- `tests/test_database.py`: Updated migration assertions to validate `V005`.
- `tests/test_outbox_processing.py`: Added 8 new integration tests covering backoff, crash counting, retry exhaustion, and endpoint authentication.

---

## 7. Final Verdict

All findings from `docs/M2-2-AUDIT-REPORT.md` are **FULLY RESOLVED AND VERIFIED**. Milestone M2.2 is in a clean, production-ready state with 100% test passing and zero linting violations.
