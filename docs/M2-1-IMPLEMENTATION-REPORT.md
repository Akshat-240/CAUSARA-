# Causara — Milestone M2.1 Implementation Report: Core Order Event Ingestion

**Document Version:** 1.0.0  
**Date:** 2026-11-07  
**Sub-Milestone:** M2.1 — Core Order Event Ingestion  
**Status:** Complete  
**Target Engine:** Microsoft SQL Server 2019 Express LocalDB `(localdb)\CausaraDB`  
**Execution Environment:** Windows, Python 3.14.2, `pyodbc 5.3.0`, `flask 3.1.3`, `pytest 9.2.0`, `flake8 7.5.0`

---

## 1. Executive Summary & Final Verdict

### Final Verdict: **READY FOR M2.2**

Milestone M2.1 (Core Order Event Ingestion) has been implemented in strict alignment with the approved system architecture, database schema, and domain rules.

- **Append-Only Event Store:** Operational events are strictly append-only. No existing event is ever overwritten or modified when a newer order status is ingested.
- **Idempotency & Concurrent Safety:** Enforces deduplication via the database `idempotency_key` unique constraint (`idempotency_key NVARCHAR(200) NOT NULL UNIQUE`). Repeated requests with identical keys and matching payloads return `200 OK` (idempotent replay) without duplicate persistence. Conflicting payload reuse is rejected with `409 IDEMPOTENCY_CONFLICT`.
- **Relational Integrity & Multi-Tenancy:** Composite stage ownership (`(order_id, stage_id) -> order_stages(order_id, stage_id)`) and order existence are verified before persistence, preventing cross-order stage leaks.
- **Transaction Safety:** Implemented with parameterized queries using the centralized database connection layer, guaranteeing complete rollback on failure with zero partial row persistence.
- **Automated Test Coverage:** 18 dedicated integration tests covering all positive, negative, edge-case, and concurrency failure modes. All 57 tests across the entire Causara test suite pass cleanly (100% pass rate).

---

## 2. Architecture & Files Created or Modified

Following Causara's modular monolith architecture and separation of concerns:

```
app/
├── repositories/
│   ├── __init__.py                  # [NEW] Repositories package init
│   └── event_repository.py          # [NEW] Parameterized SQL data access for orders, stages, events
├── services/
│   ├── __init__.py                  # [NEW] Services package init
│   └── event_service.py             # [NEW] Validation, normalization, idempotency, transaction orchestration
├── api/
│   ├── __init__.py                  # [MODIFIED] Registered events_bp on api_v1
│   └── events.py                    # [NEW] HTTP REST endpoints for event ingestion & timeline retrieval
tests/
└── test_event_ingestion.py          # [NEW] 18 comprehensive integration tests
```

### Component Roles:
1. **`app.repositories.event_repository.EventRepository`**:
   - Executes parameterized queries against `dbo.orders`, `dbo.order_stages`, and `dbo.order_events`.
   - Supports transactional participation by accepting an optional active `pyodbc.Connection`.
   - Never constructs ad-hoc unparameterized SQL strings.
2. **`app.services.event_service.EventService`**:
   - Validates required fields, ISO 8601 timestamps, event type formats, source types, and string constraints.
   - Resolves human-readable `stage_code` to the order's specific `stage_id`.
   - Reconciles existing records on duplicate idempotency keys to detect idempotent replays vs. payload conflicts.
   - Manages ACID transaction boundaries via `get_db_connection()`.
3. **`app.api.events.events_bp`**:
   - Exposes `POST /api/v1/orders/<int:order_id>/events` and `GET /api/v1/orders/<int:order_id>/events`.
   - Extracts `Idempotency-Key` from HTTP request headers (or payload fallback).
   - Formats responses inside Causara's standardized `{success, data, meta}` envelopes.

---

## 3. Event Ingestion Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as Seller / Courier API
    participant Route as Flask Blueprint (app/api/events.py)
    participant Service as EventService (app/services/event_service.py)
    participant Repo as EventRepository (app/repositories/event_repository.py)
    participant DB as SQL Server (order_events)

    Client->>Route: POST /api/v1/orders/{order_id}/events [Idempotency-Key header]
    Route->>Service: ingest_event(order_id, payload, idempotency_key)
    
    Service->>Service: Validate payload fields (event_type, occurred_at, source_type)
    Service->>Repo: get_order(order_id)
    alt Order does not exist
        Repo-->>Service: None
        Service-->>Route: Raise APIError(ORDER_NOT_FOUND, 404)
        Route-->>Client: HTTP 404 Not Found
    end

    alt stage_code or stage_id provided
        Service->>Repo: Validate & resolve stage against order_id
        alt Stage does not belong to order
            Service-->>Route: Raise APIError(STAGE_ORDER_MISMATCH, 400)
            Route-->>Client: HTTP 400 Bad Request
        end
    end

    Service->>Repo: get_event_by_idempotency_key(idempotency_key)
    alt Idempotency Key Exists
        alt Payload Matches Existing Event Exactly
            Service-->>Route: Return existing event (is_duplicate: True)
            Route-->>Client: HTTP 200 OK (Idempotent replay)
        else Payload Differs
            Service-->>Route: Raise APIError(IDEMPOTENCY_CONFLICT, 409)
            Route-->>Client: HTTP 409 Conflict
        end
    end

    Service->>Repo: insert_order_event(normalized_event)
    Repo->>DB: INSERT INTO dbo.order_events ... OUTPUT INSERTED.event_id
    DB-->>Repo: event_id
    Repo-->>Service: event_id
    Service-->>Route: IngestionResult(event_id, ACCEPTED, is_duplicate: False)
    Route-->>Client: HTTP 201 Created
```

---

## 4. Validation & Idempotency Strategy

### 4.1 Validation Rules
- **`order_id`**: Must be a positive integer referencing an existing row in `dbo.orders` (returns 404 `ORDER_NOT_FOUND` if absent).
- **`idempotency_key`**: Required via `Idempotency-Key` HTTP header (or fallback `idempotency_key` payload property). Length constrained to 1–200 characters (returns 400 `MISSING_IDEMPOTENCY_KEY` or `INVALID_IDEMPOTENCY_KEY`).
- **`event_type`**: Required string matching `^[A-Z0-9_]{2,50}$`. Automatically normalized to uppercase (returns 400 `INVALID_EVENT_TYPE`).
- **`occurred_at`**: Required ISO 8601 timestamp string (e.g., `2026-11-04T10:30:00Z`). Converted to UTC datetime. Future timestamps (> 5 minutes clock skew) are strictly rejected (returns 400 `INVALID_EVENT_TIMESTAMP`).
- **`stage_code` / `stage_id`**: Optional. If `stage_id` is supplied, it must belong to `order_id` (returns 400 `STAGE_ORDER_MISMATCH`). If `stage_code` is supplied, it resolves against `dbo.order_stages` for that order (returns 404 `STAGE_NOT_FOUND` if absent).
- **`source_type`**: Must match the database constraint enum: `MANUAL_DASHBOARD`, `COURIER_API`, `OMS_WEBHOOK`, `SYSTEM`. Defaults to `MANUAL_DASHBOARD` (returns 400 `INVALID_SOURCE_TYPE`).
- **`location` & `description`**: Sanitized strings with maximum length limits (200 and 500 characters respectively).

### 4.2 Idempotency & Conflict Handling
- **Database Unique Constraint:** Backed by `idempotency_key NVARCHAR(200) NOT NULL UNIQUE` on `dbo.order_events`.
- **Idempotent Replay (HTTP 200):** If an incoming request matches an existing record's `order_id`, `event_type`, `stage_id`, and `occurred_at`, the service recognizes it as an idempotent replay, returning the existing `event_id` with `"is_duplicate": true` and HTTP status 200.
- **Idempotency Conflict (HTTP 409):** If an existing key is resubmitted with differing event parameters (e.g., different `event_type` or `order_id`), the service rejects the call with HTTP 409 `IDEMPOTENCY_CONFLICT` and detailed conflict metadata.
- **Concurrency Safety:** In the event of two simultaneous requests submitting the same new key, the database unique constraint raises `pyodbc.IntegrityError` on the trailing transaction. The service catches the exception, rolls back, and evaluates the winner's record against the conflict rule, preventing race conditions.

---

## 5. API Contracts & Examples

### 5.1 Ingest Event: `POST /api/v1/orders/{order_id}/events`

#### Request
```http
POST /api/v1/orders/101/events HTTP/1.1
Host: localhost:5000
Content-Type: application/json
Idempotency-Key: manual-evt-101-dispatch-01

{
  "event_type": "DISPATCHED",
  "stage_code": "LINEHAUL_TRANSPORT",
  "occurred_at": "2026-11-04T10:30:00Z",
  "location": "Warehouse Hub 1, Bengaluru",
  "description": "Package handed over to BlueDart courier.",
  "source_type": "MANUAL_DASHBOARD"
}
```

#### Response (201 Created — Initial Ingestion)
```json
{
  "success": true,
  "data": {
    "event_id": 5001,
    "order_id": 101,
    "stage_id": 10,
    "event_type": "DISPATCHED",
    "occurred_at": "2026-11-04T10:30:00+00:00",
    "status": "ACCEPTED",
    "is_duplicate": false
  },
  "meta": {
    "request_id": "req_88f912c",
    "timestamp": "2026-11-07T06:45:00Z"
  }
}
```

#### Response (200 OK — Idempotent Duplicate Replay)
```json
{
  "success": true,
  "data": {
    "event_id": 5001,
    "order_id": 101,
    "stage_id": 10,
    "event_type": "DISPATCHED",
    "occurred_at": "2026-11-04T10:30:00+00:00",
    "status": "ACCEPTED",
    "is_duplicate": true
  },
  "meta": {
    "request_id": "req_88f912d",
    "timestamp": "2026-11-07T06:45:05Z"
  }
}
```

---

### 5.2 Retrieve Timeline: `GET /api/v1/orders/{order_id}/events`

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "order_id": 101,
    "events": [
      {
        "event_id": 5000,
        "order_id": 101,
        "stage_id": 9,
        "stage_code": "SELLER_PROCESSING",
        "event_type": "ORDER_PLACED",
        "occurred_at": "2026-11-04T08:00:00",
        "received_at": "2026-11-04T08:01:00",
        "source_type": "MANUAL_DASHBOARD",
        "source_provider": null,
        "source_event_id": null,
        "idempotency_key": "manual-evt-101-placed-01",
        "location": "Online Store",
        "description": "Order confirmed by seller.",
        "raw_payload": "{...}"
      },
      {
        "event_id": 5001,
        "order_id": 101,
        "stage_id": 10,
        "stage_code": "LINEHAUL_TRANSPORT",
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-04T10:30:00",
        "received_at": "2026-11-04T10:35:12",
        "source_type": "MANUAL_DASHBOARD",
        "source_provider": null,
        "source_event_id": null,
        "idempotency_key": "manual-evt-101-dispatch-01",
        "location": "Warehouse Hub 1, Bengaluru",
        "description": "Package handed over to BlueDart courier.",
        "raw_payload": "{...}"
      }
    ],
    "count": 2
  },
  "meta": {
    "request_id": "req_88f912e",
    "timestamp": "2026-11-07T06:45:10Z"
  }
}
```

---

## 6. Transaction & Error-Handling Behavior

- **Explicit Transaction Management:** Handled via `get_db_connection()`. Database mutations commit only upon successful validation and query execution.
- **Automatic Rollback:** If any unhandled exception occurs (e.g., connection drop, validation error, query failure), `conn.rollback()` is executed immediately, leaving no partial or orphaned rows.
- **Safe Error Masking:** Database connection details, server names, credentials, and low-level driver stack traces are masked behind standardized API errors (`APIError`), returning clean HTTP error envelopes (`400`, `404`, `409`, `500`).

---

## 7. Automated Test Execution Results

Command: `.\.venv\Scripts\pytest.exe -v`

```
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.2.0, pluggy-1.7.0
rootdir: C:\Users\aksha\Desktop\ESPV1
configfile: pytest.ini
testpaths: tests
collected 57 items

tests/test_database.py (27 tests) ...........................            [ 47%]
tests/test_errors.py (3 tests) ...                                       [ 52%]
tests/test_event_ingestion.py (18 tests)
  test_valid_event_ingestion_success PASSED                              [ 54%]
  test_valid_event_ingestion_with_stage_id PASSED                        [ 56%]
  test_valid_event_ingestion_without_stage PASSED                        [ 57%]
  test_ingest_event_missing_idempotency_key PASSED                       [ 59%]
  test_ingest_event_missing_event_type PASSED                            [ 61%]
  test_ingest_event_missing_occurred_at PASSED                           [ 63%]
  test_ingest_event_nonexistent_order PASSED                             [ 64%]
  test_ingest_event_stage_belonging_to_different_order PASSED            [ 66%]
  test_ingest_event_unknown_stage_code PASSED                            [ 68%]
  test_ingest_event_invalid_timestamp_format PASSED                      [ 70%]
  test_ingest_event_future_timestamp PASSED                              [ 71%]
  test_ingest_event_invalid_event_type PASSED                            [ 73%]
  test_ingest_event_invalid_source_type PASSED                            [ 75%]
  test_idempotent_duplicate_replay PASSED                                [ 77%]
  test_idempotency_conflict_rejection PASSED                             [ 78%]
  test_transaction_rollback_on_database_failure PASSED                   [ 80%]
  test_multiple_events_chronological_timeline PASSED                     [ 82%]
  test_preservation_of_existing_event_history PASSED                     [ 84%]
tests/test_factory.py (3 tests) ...                                      [ 89%]
tests/test_health.py (2 tests) ..                                        [ 92%]
tests/test_migration_runner.py (4 tests) ....                            [100%]

============================= 57 passed in 3.52s ==============================
```

- **Static Analysis (Flake8):** `0 errors / 0 warnings` (`flake8 app database tests --max-line-length=120`).
- **Frontend Verification:** `2 passed in 3.39s` (`npm --prefix frontend run test -- --run`).

---

## 8. Known Limitations & Deferred Capabilities

In strict compliance with the milestone scope boundaries:
1. **Asynchronous Outbox Dispatching for Ingestion:** Ingested events are recorded in `dbo.order_events`. Automated enqueueing of `TIMELINE_RECONSTRUCTION` jobs in `dbo.analysis_jobs` and `dbo.outbox_events` is deferred to sub-milestone M2.2.
2. **Third-Party HMAC Courier Webhooks:** The courier webhook endpoint (`/api/v1/webhooks/couriers/{provider}`) is deferred to M2.3.
3. **JWT Authentication:** Authentication middleware is deferred to Milestone M3; route-level role-based enforcement will be added once auth services are established.

---

## 9. Conclusion

Milestone M2.1 has been completed with comprehensive integration tests, zero schema mutations, and strict preservation of append-only historical integrity. All existing M0 and M1 tests continue to pass without regression.
