# Causara — Milestone M2.1 Event Ingestion Idempotency Concurrency Audit

**Audit Target**: Concurrency & Idempotency Engine for Event Ingestion  
**Workspace**: `C:\Users\aksha\Desktop\ESPV1`  
**Database**: Microsoft SQL Server LocalDB (`(localdb)\CausaraDB.CausaraDB`)  
**Audit Date**: November 9, 2026  
**Final Verdict**: **PASS**

---

## 1. Executive Summary

An isolated concurrency audit was performed on Causara's event ingestion idempotency implementation. The audit verified thread safety, race-condition handling, database constraint enforcement, transaction isolation, and error suppression under true simultaneous load using separate physical database connections per thread.

All tests completed successfully:
- **Test A (Concurrent Identical Requests)**: Exactly 1 row persisted; one request received `HTTP 201 Created` (`is_duplicate=false`) and the other received `HTTP 200 OK` (`is_duplicate=true`). No `500 Internal Server Error` was produced.
- **Test B (Concurrent Conflicting Requests)**: Exactly 1 row persisted; one request succeeded with `HTTP 201 Created` and the competing request was rejected with `HTTP 409 IDEMPOTENCY_CONFLICT`. No partial records were left.
- **Test C (Repeated Concurrency)**: 20 consecutive concurrent rounds (10 identical + 10 conflicting) executed with 100% determinism, 0 orphan records, and 0 transaction leaks (`sys.dm_tran_session_transactions` verified clean).

---

## 2. Inspected Components & Architectural Mechanism

### A. Database Constraint: `dbo.order_events`
In [`database/migrations/V001__initial_schema.sql`](file:///c:/Users/aksha/Desktop/ESPV1/database/migrations/V001__initial_schema.sql#L115):
```sql
idempotency_key NVARCHAR(200) NOT NULL UNIQUE
```
- SQL Server enforces physical uniqueness at the engine level through a unique index constraint.
- Any attempt by concurrent connections to insert the identical `idempotency_key` simultaneously causes SQL Server error 2627 / 2601 (`Violation of UNIQUE KEY constraint`).

### B. Service Concurrency Control: `EventService`
In [`app/services/event_service.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/services/event_service.py#L318-L338):
```python
try:
    event_id = self.repo.insert_order_event(event_insert_data, conn=conn)
except pyodbc.IntegrityError as ex:
    # Concurrent request race condition on UNIQUE idempotency_key
    conn.rollback()
    existing_race = self.repo.get_event_by_idempotency_key(effective_key, conn=conn)
    if existing_race:
        return self._evaluate_idempotent_duplicate(
            existing=existing_race,
            order_id=order_id,
            norm_event_type=norm_event_type,
            resolved_stage_id=resolved_stage_id,
            sql_occurred_dt=sql_occurred_dt,
            effective_key=effective_key,
        )
    logger.error("Database integrity error during event ingestion: %s", ex)
    raise APIError(
        code="INTEGRITY_VIOLATION",
        message="Database constraint violation while inserting event.",
        status_code=400,
    ) from ex
```

### C. Repository Layer: `EventRepository`
In [`app/repositories/event_repository.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/repositories/event_repository.py#L170-L205):
- Parameterized `INSERT INTO dbo.order_events (...) VALUES (?, ...)` ensures thread-safe, injection-free persistence.
- Queries operate on caller-supplied connection or managed transactional connection.

### D. Connection Layer: `app.database.connection`
In [`app/database/connection.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/database/connection.py#L40-L58):
- Each request obtains its own independent `pyodbc.Connection` with `autocommit=False`.
- Connections are not shared across threads, ensuring true database-level concurrency isolation.

---

## 3. Test Methodology & Execution

Concurrency was orchestrated using Python `threading.Thread` combined with `threading.Barrier(2)` to release both threads simultaneously. Each thread utilized an independent Flask test client and established an independent physical connection to the SQL Server LocalDB instance.

### Execution Command
```powershell
.\.venv\Scripts\python.exe "C:\Users\aksha\.gemini\antigravity\brain\4b722e04-5584-48d7-a7f0-c6ec58baad64\scratch\test_concurrency_audit.py"
```

---

## 4. Test Results

### Test A: Concurrent Identical Requests
Two threads submitted identical event payloads with the exact same idempotency key simultaneously:
- **Order ID**: `20189`
- **Key**: `concur-identical-713cd2d0-A`
- **Payload**:
  ```json
  {
    "event_type": "PACKAGE_SCANNED",
    "stage_id": 20345,
    "occurred_at": "2026-11-09T12:00:00Z",
    "location": "Warehouse Hub 1",
    "description": "Scanned at station",
    "source_type": "MANUAL_DASHBOARD"
  }
  ```

#### Observed HTTP Responses
- **Thread 1**:
  - **Status Code**: `201 Created`
  - **Response Body**:
    ```json
    {
      "success": true,
      "data": {
        "event_id": 20113,
        "order_id": 20189,
        "stage_id": 20345,
        "event_type": "PACKAGE_SCANNED",
        "occurred_at": "2026-11-09T12:00:00+00:00",
        "status": "ACCEPTED",
        "is_duplicate": false
      },
      "meta": {
        "request_id": "req_537378505340",
        "timestamp": "2026-11-09T12:39:19.033574+00:00"
      }
    }
    ```
- **Thread 2**:
  - **Status Code**: `200 OK`
  - **Response Body**:
    ```json
    {
      "success": true,
      "data": {
        "event_id": 20113,
        "order_id": 20189,
        "stage_id": 20345,
        "event_type": "PACKAGE_SCANNED",
        "occurred_at": "2026-11-09T12:00:00",
        "status": "ACCEPTED",
        "is_duplicate": true
      },
      "meta": {
        "request_id": "req_04544c31e9ba",
        "timestamp": "2026-11-09T12:39:19.092966+00:00"
      }
    }
    ```
- **Database Row Count for Key**: Exactly **1 row** (`event_id = 20113`).
- **Unhandled 500 Errors**: **0**.
- **Verdict**: **PASSED**.

---

### Test B: Concurrent Conflicting Requests
Two threads submitted conflicting event payloads with the exact same idempotency key simultaneously:
- **Order ID**: `20189`
- **Key**: `concur-conflict-713cd2d0-B`
- **Thread 1 Payload**: `event_type = "PACKAGE_SCANNED"`, `description = "Payload Candidate 1"`
- **Thread 2 Payload**: `event_type = "CANCELLED"`, `description = "Conflicting Payload Candidate 2"`

#### Observed HTTP Responses
- **Thread 2 (Winning Insert)**:
  - **Status Code**: `201 Created`
  - **Response Body**:
    ```json
    {
      "success": true,
      "data": {
        "event_id": 20115,
        "order_id": 20189,
        "stage_id": null,
        "event_type": "CANCELLED",
        "occurred_at": "2026-11-09T12:00:00+00:00",
        "status": "ACCEPTED",
        "is_duplicate": false
      },
      "meta": {
        "request_id": "req_33de13801800",
        "timestamp": "2026-11-09T12:39:19.225694+00:00"
      }
    }
    ```
- **Thread 1 (Losing Competing Insert)**:
  - **Status Code**: `409 Conflict`
  - **Response Body**:
    ```json
    {
      "success": false,
      "error": {
        "code": "IDEMPOTENCY_CONFLICT",
        "message": "Idempotency key was previously used with conflicting event data.",
        "details": {
          "idempotency_key": "concur-conflict-713cd2d0-B",
          "existing_event_id": 20115,
          "existing_order_id": 20189,
          "existing_event_type": "CANCELLED"
        }
      },
      "meta": {
        "request_id": "req_298bbbe13324",
        "timestamp": "2026-11-09T12:39:19.253298+00:00"
      }
    }
    ```
- **Database Row Count for Key**: Exactly **1 row** (`event_id = 20115`, `event_type = "CANCELLED"`).
- **Orphan/Partial Records**: **0**.
- **Unhandled 500 Errors**: **0**.
- **Verdict**: **PASSED**.

---

### Test C: Repeated Concurrency & Transaction Leak Verification
20 consecutive rounds of concurrent requests were executed using fresh idempotency keys per round:

| Iteration | Type | Thread Statuses | DB Rows | Result |
|:---:|:---|:---:|:---:|:---:|
| 1 | Identical | `[200, 201]` | 1 | PASSED |
| 2 | Identical | `[200, 201]` | 1 | PASSED |
| 3 | Identical | `[200, 201]` | 1 | PASSED |
| 4 | Identical | `[200, 201]` | 1 | PASSED |
| 5 | Identical | `[200, 201]` | 1 | PASSED |
| 6 | Identical | `[200, 201]` | 1 | PASSED |
| 7 | Identical | `[200, 201]` | 1 | PASSED |
| 8 | Identical | `[200, 201]` | 1 | PASSED |
| 9 | Identical | `[200, 201]` | 1 | PASSED |
| 10 | Identical | `[200, 201]` | 1 | PASSED |
| 11 | Conflicting | `[201, 409]` | 1 | PASSED |
| 12 | Conflicting | `[201, 409]` | 1 | PASSED |
| 13 | Conflicting | `[201, 409]` | 1 | PASSED |
| 14 | Conflicting | `[201, 409]` | 1 | PASSED |
| 15 | Conflicting | `[201, 409]` | 1 | PASSED |
| 16 | Conflicting | `[201, 409]` | 1 | PASSED |
| 17 | Conflicting | `[201, 409]` | 1 | PASSED |
| 18 | Conflicting | `[201, 409]` | 1 | PASSED |
| 19 | Conflicting | `[201, 409]` | 1 | PASSED |
| 20 | Conflicting | `[201, 409]` | 1 | PASSED |

#### Transaction Leak & Connection Health Check
Following the 20 iterations, an autocommit diagnostic connection queried SQL Server Dynamic Management Views:
```sql
SELECT COUNT(*) 
FROM sys.dm_tran_session_transactions st
JOIN sys.dm_exec_sessions s ON st.session_id = s.session_id
WHERE s.is_user_process = 1 AND st.is_user_transaction = 1 AND s.session_id <> @@SPID;
```
- **Lingering User Transactions**: **0**.
- **Verdict**: **PASSED**.

---

## 5. Teardown & Cleanup

All test entities created during the audit (User ID `20189`, Seller, Order `20189`, Stage `20345`, and all 22 test event rows) were cleanly removed from `dbo.order_events`, `dbo.order_stages`, `dbo.orders`, `dbo.sellers`, and `dbo.users`. No residue remains in the database.

---

## 6. Findings & Recommendations

- **Defects Detected**: **0**.
- **Race Condition Vulnerabilities**: **0**.
- **Code Modifications Needed**: **None**.
- **Summary**: Causara's idempotency engine demonstrates robust double-checked locking behavior coupled with database-level uniqueness enforcement. When concurrent threads execute competing inserts, SQL Server's unique constraint prevents duplicate rows, while the application layer catches `pyodbc.IntegrityError`, cleanly rolls back the failing transaction, and falls back to evaluating the winner's committed event. This eliminates unhandled 500 errors and provides deterministic, predictable responses.

---

## 7. Final Verdict

### **PASS**
The event ingestion idempotency implementation fully withstands concurrent identical and conflicting requests with zero defects, zero data duplication, and zero transaction leaks.
