# Causara — Milestone M2.2 Implementation Report
## Event Integrity & Processing Engine (Transactional Outbox)

**Milestone**: M2.2  
**Date**: November 9, 2026  
**Status**: COMPLETE & VERIFIED  
**Next Milestone**: M2.3 (Delay-Chain Reconstruction & Timeline Normalization Engine)  
**Database**: Microsoft SQL Server LocalDB (`(localdb)\CausaraDB.CausaraDB`)  
**Migrations Applied**: `V001`, `V002`, `V003`, `V004` (All validated)  
**Test Suite**: 70/70 PASSED (100%)  
**Code Quality**: Flake8 Clean (0 errors / 0 warnings across `app`, `database`, `tests`)

---

## 1. Executive Summary

Milestone M2.2 implements the **Transactional Outbox Architecture** for Causara's asynchronous event processing engine. In distributed and event-driven systems, dual-writing to a database and an external message broker introduces inconsistency when either operation fails. Causara eliminates this failure mode entirely by persisting event outbox messages inside the exact same atomic SQL Server database transaction as the primary domain event (`dbo.order_events`).

A resilient, non-blocking background worker engine (`OutboxProcessor`) claims pending messages using SQL Server locking hints (`WITH (UPDLOCK, READPAST, ROWLOCK)`), executes downstream asynchronous side effects (such as timeline reconstruction analysis jobs), and acknowledges completion or manages retries with lease-fenced optimistic concurrency control.

### Core Guarantees Delivered
1. **Atomic Dual-Write**: Domain event insertion and outbox message creation commit or rollback together in a single ACID transaction.
2. **Idempotency Preservation**: Replayed duplicate requests return existing event data and never produce duplicate outbox messages.
3. **Non-Blocking Concurrent Claiming**: Multiple background workers claim distinct message batches without lock contention, deadlocks, or duplicate processing.
4. **Worker Crash Recovery**: If a worker crashes or hangs after claiming a message, the message automatically becomes reclaimable after its lease expires (`lease_seconds`).
5. **Stale Worker Lease Fencing**: Stale or delayed workers that wake up after their lease was stolen/reclaimed cannot acknowledge or alter the message, preventing double-processing and state corruption.
6. **Downstream Idempotency**: If a worker completes downstream effects (e.g. creating an analysis job) and crashes before marking the outbox message `PUBLISHED`, the recovering worker safely detects existing downstream progress via unique idempotency keys and finalizes the message without side-effect duplication.
7. **Strict Error Isolation & Sanitization**: Transient errors trigger exponential retries up to `max_retries`; permanent validation errors fail immediately into dead-letter state (`FAILED`). All error messages are sanitized and length-bounded to protect sensitive information.
8. **Operational Observability**: An internal monitoring REST endpoint (`GET /api/v1/internal/outbox/stats`) protected by internal API key authentication exposes pending queue depth (`pending_count`), in-flight volume (`processing_count`), published total (`published_count`), dead-letter count (`failed_count`), aggregate retry attempts (`total_retries`), and oldest pending age (`oldest_pending_age_seconds`).

---

## 2. Database Schema Inspection & V004 Migration

### 2.1 Inspection of Initial Schema (V001)
Inspection of `dbo.outbox_events` in `database/migrations/V001__initial_schema.sql` revealed:
```sql
CREATE TABLE dbo.outbox_events (
    outbox_id BIGINT IDENTITY(1,1) NOT NULL,
    event_type NVARCHAR(100) NOT NULL,
    aggregate_type NVARCHAR(100) NOT NULL,
    aggregate_id BIGINT NOT NULL,
    payload_json NVARCHAR(MAX) NOT NULL,
    status NVARCHAR(50) NOT NULL CONSTRAINT DF_outbox_status DEFAULT ('PENDING'),
    retry_count INT NOT NULL CONSTRAINT DF_outbox_retry DEFAULT (0),
    created_at DATETIME2(7) NOT NULL CONSTRAINT DF_outbox_created DEFAULT (SYSUTCDATETIME()),
    published_at DATETIME2(7) NULL,
    CONSTRAINT PK_outbox_events PRIMARY KEY CLUSTERED (outbox_id),
    CONSTRAINT CK_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'))
);
```

### 2.2 Identified Deficiencies & Solution Selection
While the initial schema supported basic message persistence, it lacked two operational capabilities required for production-grade worker reliability:
1. **Worker Crash Recovery & Lease Tracking**: No timestamp or token recorded when a worker claimed a message (`PROCESSING`). Unconditional recovery after a static interval risks concurrent double-processing if a worker is merely slow.
2. **Failure Diagnostics**: No column recorded why a message failed or was retried, forcing diagnostic messages to be crammed into JSON payloads or lost.

Two architectural options were evaluated and submitted for approval:
- **Option A (Approved)**: Forward database migration `V004` adding `locked_at DATETIME2 NULL` and `error_message NVARCHAR(1000) NULL`.
- **Option B**: Store leases and error strings inside `payload_json`.

Option A was approved to maintain clean separation between domain event data and operational infrastructure state.

### 2.3 Migration Artifacts
- **Forward Migration**: `database/migrations/V004__outbox_processing_enhancements.sql`
  ```sql
  -- V004: Enhance outbox_events with worker lease claiming and error diagnostics
  ALTER TABLE dbo.outbox_events
  ADD
      locked_at DATETIME2 NULL,
      error_message NVARCHAR(1000) NULL;
  ```
- **Rollback Migration**: `database/migrations/U004__outbox_processing_enhancements_down.sql`
  ```sql
  -- U004: Rollback outbox_events enhancements
  ALTER TABLE dbo.outbox_events
  DROP COLUMN
      locked_at,
      error_message;
  ```
- **Verification**: Tested on isolated scratch database `CausaraScratch_V004` verifying full forward and down lifecycle, then applied cleanly to `CausaraDB`. Migration status verified via `python -m database.migration_runner status`.

---

## 3. Architecture & Implementation Details

```
+------------------------------------------------------------------------------------+
|                                FLASK HTTP REQUEST                                  |
|                 POST /api/v1/orders/{order_id}/events                              |
+------------------------------------------------------------------------------------+
                                         |
                                         v
+------------------------------------------------------------------------------------+
|                         EventService.ingest_order_event                            |
|                                                                                    |
|   1. Validate payload, timestamp, stage ownership, idempotency                     |
|   2. BEGIN TRANSACTION                                                             |
|      - INSERT INTO dbo.order_events (...) OUTPUT INSERTED.event_id                 |
|      - INSERT INTO dbo.outbox_events (..., 'ORDER_EVENT_INGESTED', 'PENDING')       |
|   3. COMMIT TRANSACTION (Atomic dual persistence)                                  |
+------------------------------------------------------------------------------------+
                                         |
                                         v
+------------------------------------------------------------------------------------+
|                     BACKGROUND ASYNCHRONOUS WORKER ENGINE                          |
|                     OutboxProcessor.process_batch()                                |
|                                                                                    |
|   1. ATOMIC BATCH CLAIM (OutboxRepository.claim_pending_messages):                  |
|      WITH Claimable AS (                                                           |
|          SELECT TOP (?) ... FROM dbo.outbox_events                                 |
|          WITH (UPDLOCK, READPAST, ROWLOCK)                                         |
|          WHERE status = 'PENDING'                                                  |
|             OR (status = 'PROCESSING' AND locked_at < DATEADD(second, -lease, ...))|
|          ORDER BY outbox_id ASC                                                    |
|      )                                                                             |
|      UPDATE Claimable SET status = 'PROCESSING',                                   |
|                           locked_at = CAST(SYSUTCDATETIME() AS DATETIME2(6))       |
|      OUTPUT INSERTED.*;                                                            |
|                                                                                    |
|   2. INDEPENDENT MESSAGE DISPATCH:                                                 |
|      - Execute downstream action (e.g. create dbo.analysis_jobs record)            |
|      - If success: mark_published(locked_at = expected_locked_at)                  |
|      - If transient error: mark_failed_or_retry(status='PENDING', retry_count + 1) |
|      - If permanent error / max retries: mark_failed_or_retry(status='FAILED')     |
|      - If lease lost (rowcount == 0): rollback, discard stale write                |
+------------------------------------------------------------------------------------+
```

### 3.1 Outbox Repository (`app/repositories/outbox_repository.py`)
Encapsulates all database operations against `dbo.outbox_events`:
- `insert_outbox_event(cursor, event_type, aggregate_type, aggregate_id, payload_json) -> int`: Persists a pending message within caller's existing transaction.
- `claim_pending_messages(cursor, batch_size, lease_seconds) -> List[Dict]`: Atomically claims up to `batch_size` pending or expired messages using `WITH (UPDLOCK, READPAST, ROWLOCK)`. Note that `locked_at` is stamped as `CAST(SYSUTCDATETIME() AS DATETIME2(6))` to ensure microsecond equality when passing parameters via `pyodbc`.
- `mark_published(cursor, outbox_id, expected_locked_at) -> bool`: Optimistic lease acknowledgement ensuring only the worker holding the active lease can finalize the message (`status = 'PUBLISHED'`). Returns `False` if ownership was lost.
- `mark_failed_or_retry(cursor, outbox_id, expected_locked_at, error_message, is_transient, max_retries) -> bool`: Atomically increments `retry_count`, logs sanitized `error_message`, clears `locked_at`, and re-queues to `PENDING` or moves to `FAILED`.
- `get_outbox_event_by_id(outbox_id, conn) -> Optional[Dict]`: Retrieves message by primary key.
- `get_statistics(conn) -> Dict[str, Any]`: Aggregates queue depth metrics.

### 3.2 Ingestion Integration (`app/services/event_service.py`)
- Instantiates `OutboxRepository` within `EventService`.
- Wraps order event persistence and outbox event insertion inside the exact same database connection context:
  ```python
  event_id = self.repo.insert_order_event(event_insert_data, conn=conn)

  outbox_payload = {
      "event_id": event_id,
      "order_id": order_id,
      "event_type": norm_event_type,
      "occurred_at": norm_occurred_dt.isoformat(),
      "stage_id": resolved_stage_id,
      "source_type": norm_source_type,
  }
  self.outbox_repo.insert_outbox_event(
      cursor=outbox_cursor,
      event_type="ORDER_EVENT_INGESTED",
      aggregate_type="ORDER_EVENT",
      aggregate_id=event_id,
      payload_json=json.dumps(outbox_payload),
  )
  ```
- If event insertion fails, outbox insertion never runs and connection rolls back.
- If outbox insertion fails, connection rolls back, ensuring no orphaned event exists without an outbox entry.
- Idempotent duplicate requests (`Idempotency-Key` match) return the existing event without executing the insert branch or creating redundant outbox entries.

### 3.3 Outbox Processor (`app/services/outbox_processor.py`)
- `OutboxProcessor`: Configurable background runner taking `worker_id`, `batch_size=10`, `lease_seconds=300`, `max_retries=3`, and optional `downstream_handler`.
- **Default Downstream Dispatch**:
  - Validates payload structure and parses JSON.
  - Verifies referenced `event_id` exists in `dbo.order_events`.
  - Dispatches `ORDER_EVENT_INGESTED` to downstream analysis job creation (`dbo.analysis_jobs`) with `job_type = 'TIMELINE_RECONSTRUCTION'` and unique `idempotency_key = f"job-timeline-recon-event-{event_id}"`.
- **Worker Crash Recovery & Stale Worker Protection**:
  - Implements the exact failure sequence specified in Section 4 of the milestone requirement:
    1. Worker A claims message, obtaining `locked_at_A`.
    2. Worker A executes downstream side-effects (creates analysis job record).
    3. Worker A crashes / network disconnects before calling `mark_published`.
    4. Worker A's lease expires (`locked_at < DATEADD(...)`).
    5. Worker B claims the stranded message, obtaining `locked_at_B` (`locked_at_B != locked_at_A`).
    6. Worker B retries downstream processing. Because `dbo.analysis_jobs` enforces `idempotency_key UNIQUE`, Worker B detects the existing job and safely proceeds without duplicating downstream work.
    7. If Worker A awakens as a zombie and attempts acknowledgement with `locked_at_A`, the update matches 0 rows (`cursor.rowcount == 0`), rejecting Worker A's stale attempt.
- **Error Sanitization**:
  - Truncates errors to 1,000 characters.
  - Strips passwords, connection strings, and database credentials before persisting to `error_message`.

### 3.4 Observability API (`app/api/outbox.py`)
Exposes `GET /api/v1/internal/outbox/stats`. Access is protected via an internal API key (`INTERNAL_API_KEY` configured in environment / application config) passed via the `X-Internal-API-Key` or `Authorization: Bearer <key>` header (interim security prior to Milestone M3).

#### Response Envelope:
```json
{
  "success": true,
  "data": {
    "pending_count": 0,
    "processing_count": 0,
    "published_count": 142,
    "failed_count": 0,
    "total_retries": 5,
    "oldest_pending_age_seconds": null
  },
  "meta": {
    "request_id": "req_84ef64a851aa",
    "timestamp": "2026-11-09T20:30:00.000000+00:00"
  }
}
```

#### Field Definitions and Semantics:
| Field Name | Type | Nature | Definition & Units |
|---|---|---|---|
| `pending_count` | `integer` | Snapshot / Current Gauge | Total messages currently in `PENDING` status awaiting claim or retry backoff. |
| `processing_count` | `integer` | Snapshot / Current Gauge | Total messages currently claimed by workers in `PROCESSING` status with active or expired leases. |
| `published_count` | `integer` | Cumulative Counter | Total messages successfully processed and acknowledged into `PUBLISHED` status. |
| `failed_count` | `integer` | Cumulative Counter | Total messages dead-lettered into `FAILED` status due to retry exhaustion or unrecoverable permanent errors. |
| `total_retries` | `integer` | Cumulative Counter | Aggregate count of all retry attempts recorded across all outbox messages (`SUM(retry_count)`). |
| `oldest_pending_age_seconds` | `integer` or `null` | Snapshot / Gauge | Elapsed duration in seconds between `created_at` and `SYSUTCDATETIME()` for the oldest message currently in `PENDING` status (`null` if no messages are pending). |

#### Unexposed Metrics & Design Notes:
- `total_count` is not explicitly returned as an isolated field because it can be computed as `pending_count + processing_count + published_count + failed_count`.
- `active_expired_leases_count` is not currently broken out from `processing_count`; expired leases remain in `PROCESSING` status until reclaimed or transitioned by an active worker.
Registered via `internal_outbox_bp` in `app/api/__init__.py`.

---

## 4. Verification & Testing

### 4.1 Automated Test Suite (`tests/test_outbox_processing.py`)
Contains 13 dedicated automated integration tests covering every requirement:

| # | Test Name | Target Behavior | Result |
|---|-----------|-----------------|--------|
| 1 | `test_atomic_event_and_outbox_insertion` | Event and outbox record persist atomically on valid POST | **PASSED** |
| 2 | `test_rollback_if_event_insertion_fails` | Failed event rollback creates no outbox record | **PASSED** |
| 3 | `test_rollback_if_outbox_insertion_fails` | Failed outbox rollback creates no event record | **PASSED** |
| 4 | `test_duplicate_ingestion_creates_no_additional_outbox` | Idempotent replay does not duplicate outbox entries | **PASSED** |
| 5 | `test_successful_worker_processing` | Worker claims pending message, executes effect, marks PUBLISHED | **PASSED** |
| 6 | `test_duplicate_downstream_processing_after_simulated_worker_crash` | Reclaimed message detects existing downstream effect, avoids duplication | **PASSED** |
| 7 | `test_transient_failure_and_retry` | Transient error increments retry_count and re-queues to PENDING | **PASSED** |
| 8 | `test_permanent_failure_transitions_to_failed_without_retry` | Malformed JSON permanently fails immediately without retry | **PASSED** |
| 9 | `test_missing_event_reference_permanent_failure` | Outbox referencing non-existent event permanently fails | **PASSED** |
| 10 | `test_maximum_retry_exhaustion_marks_failed` | Exceeding max_retries transitions status to FAILED | **PASSED** |
| 11 | `test_concurrent_worker_claiming_no_duplicates` | Concurrent threads claim disjoint message batches with 0 overlap | **PASSED** |
| 12 | `test_stale_worker_attempting_to_complete_reclaimed_message_fails` | Zombie worker with expired lease rejected on mark_published | **PASSED** |
| 13 | `test_outbox_observability_endpoint` | GET `/api/v1/internal/outbox/stats` returns accurate counts | **PASSED** |

### 4.2 Full Regression Suite
All 70 tests across the entire Causara repository passed:
```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
collected 70 items

tests/test_database.py ...........................                       [ 38%]
tests/test_errors.py ...                                                 [ 42%]
tests/test_event_ingestion.py ...................                        [ 70%]
tests/test_factory.py ...                                                [ 74%]
tests/test_health.py ..                                                  [ 77%]
tests/test_migration_runner.py ....                                      [ 82%]
tests/test_outbox_processing.py .............                            [100%]

============================= 70 passed in 27.37s =============================
```

### 4.3 Code Quality & Linting
```powershell
.\.venv\Scripts\flake8.exe app database tests --max-line-length=120
# Exited with code 0 (zero errors, zero warnings)
```

---

## 5. Scope & Compliance Verification

| Requirement | Audit Finding | Status |
|-------------|---------------|--------|
| No Azure Storage Queue / Service Bus | Uses existing SQL Server `dbo.outbox_events` table exclusively | **COMPLIANT** |
| No Celery, Redis, or RabbitMQ | Pure Python worker engine using thread synchronization & SQL Server locking | **COMPLIANT** |
| No Azure resources provisioned | All development & testing performed on LocalDB | **COMPLIANT** |
| No Delay-chain reconstruction started | Analysis jobs are queued (`QUEUED`); actual graph reconstruction deferred to M2.3 | **COMPLIANT** |
| Stop after M2.2 | Halting work upon M2.2 completion; awaiting explicit user instruction for M2.3 | **COMPLIANT** |

---

## 6. Files Created and Modified

### Files Created
- `database/migrations/V004__outbox_processing_enhancements.sql`: Schema enhancement migration adding `locked_at` and `error_message`.
- `database/migrations/U004__outbox_processing_enhancements_down.sql`: Rollback migration for V004.
- `app/repositories/outbox_repository.py`: Dedicated repository for outbox persistence, atomic claiming, and status lifecycle.
- `app/services/outbox_processor.py`: Background worker processor with crash recovery, lease fencing, and sanitized error logging.
- `app/api/outbox.py`: Internal observability endpoint (`/api/v1/internal/outbox/stats`).
- `tests/test_outbox_processing.py`: Comprehensive test suite (13 test cases).
- `docs/M2-2-IMPLEMENTATION-REPORT.md`: This implementation report.

### Files Modified
- `app/repositories/__init__.py`: Exported `OutboxRepository`.
- `app/services/event_service.py`: Integrated atomic outbox event persistence in the same SQL transaction as `dbo.order_events`.
- `app/api/__init__.py`: Registered `internal_outbox_bp`.
- `tests/test_database.py`: Updated migration rollback assertion to dynamically accommodate V004.

---

## 7. Next Milestone Readiness

Milestone M2.2 is complete, tested, and verified. The system is ready to proceed to **Milestone M2.3: Delay-Chain Reconstruction & Timeline Normalization Engine**.

**FINAL VERDICT: READY FOR M2.3**
