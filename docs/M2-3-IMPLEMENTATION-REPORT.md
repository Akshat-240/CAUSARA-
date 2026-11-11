# Causara — Milestone M2.3 Implementation Report
## Timeline Reconstruction & Normalization Engine

**Milestone**: M2.3  
**Date**: November 9, 2026  
**Status**: COMPLETE & VERIFIED  
**Next Milestone**: M2.4 (Delay Cause Identification Engine)  
**Database**: Microsoft SQL Server LocalDB (`(localdb)\CausaraDB.CausaraDB`)  
**Migrations Applied**: `V001`, `V002`, `V003`, `V004`, `V005` (All validated; no schema alterations needed for M2.3)  
**Test Suite**: 92/92 PASSED (100% across full regression test suite; 14/14 new M2.3 tests passing)  
**Code Quality**: Flake8 Clean (0 errors / 0 warnings across `app`, `database`, `tests`)

---

## 1. Executive Summary

Milestone M2.3 delivers the **Timeline Reconstruction & Normalization Engine** for Causara. In real-world e-commerce supply chains, raw order event streams suffer from out-of-order ingestion, network retries, conflicting courier updates, missing stage milestones, and disparate timezone representations. The M2.3 engine ingests these raw events and reconstructs a strictly factual, chronological, and normalized order journey.

The reconstruction engine strictly honors Causara's foundational epistemological principles:
- **Reconstruct Facts, Never Fabricate**: The engine reconstructs observed physical reality. It never synthesizes phantom events or artificial timestamps to bridge gaps in missing stages.
- **Strict Evidence Classification**: Every timeline entry and stage transition is categorized into `FACT` (verified operational observation), `DATA_QUALITY_ISSUE` (duplicates, conflicts, sequence inversions), or `INFERRED` (stage mapping deduced from unmapped event types). Inferences are never presented as confirmed facts.
- **Dual-Timestamp Preservation**: `occurred_at` (physical event occurrence in the real world) and `received_at` (system ingestion time) are preserved independently, converted to ISO-8601 UTC, and used for deterministic multi-key ordering (`occurred_at ASC, received_at ASC, event_id ASC`).
- **Non-Destructive Anomaly Detection**: Ingested records are never purged or altered. Duplicate events, inverted stage transitions, out-of-order arrivals, and post-terminal updates are explicitly flagged, cross-referenced (`related_event_ids`, `duplicate_of`), and preserved in full for auditability.
- **Planned vs. Actual Progression**: Planned stage milestones (`order_stages`) are compared against reconstructed physical events, computing `actual_duration_minutes`, `variance_minutes`, `time_lost_minutes`, and `time_recovered_minutes`. Missing stages are explicitly marked `SKIPPED`.
- **Customer Summary Boundary**: A customer-facing narrative is generated that explains order status clearly while strictly omitting internal blame, supplier disputes, or confidential cost metrics.
- **Asynchronous Analysis Job Lifecycle**: Reconstruction jobs integrate with `dbo.analysis_jobs` under job type `TIMELINE_RECONSTRUCTION`, obeying all database constraints (`CK_analysis_jobs_type_deps`) with idempotent status transitions (`QUEUED` -> `RUNNING` -> `COMPLETED`/`FAILED`).

---

## 2. Database Schema Sufficiency & Constraints

### 2.1 Schema Verification
Before implementation, the database schema established in migrations `V001` through `V005` was thoroughly inspected. It was confirmed that all required tables and columns already exist in `(localdb)\CausaraDB.CausaraDB`:
1. `dbo.order_stages`:
   - Contains `actual_start_at DATETIME2 NULL`, `actual_end_at DATETIME2 NULL`, and `status NVARCHAR(50)`.
   - Constrained by `CK_order_stages_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'FAILED'))`.
   - Constrained by `CK_order_stages_actual_window CHECK (actual_end_at IS NULL OR actual_start_at IS NULL OR actual_end_at >= actual_start_at)`.
2. `dbo.orders`:
   - Contains `actual_delivery_at DATETIME2 NULL` and `status NVARCHAR(50)`.
3. `dbo.order_events`:
   - Contains `event_id`, `order_id`, `stage_id`, `event_type`, `occurred_at`, `received_at`, `source_type`, `source_provider`, `source_event_id`, `location`, `description`, `raw_payload`.
4. `dbo.analysis_jobs`:
   - Contains `job_id`, `order_id`, `case_id`, `decision_id`, `job_type`, `status`, `retry_count`, `created_at`, `started_at`, `completed_at`, `error_message`.
   - Constrained by `CK_analysis_jobs_type_deps`:
     ```sql
     CHECK (
         (job_type = 'TIMELINE_RECONSTRUCTION' AND case_id IS NULL AND decision_id IS NULL) OR
         (job_type = 'DELAY_DETECTION' AND case_id IS NULL AND decision_id IS NULL) OR
         (job_type = 'CAUSE_ANALYSIS' AND case_id IS NOT NULL AND decision_id IS NULL) OR
         (job_type = 'SCENARIO_SIMULATION' AND case_id IS NOT NULL AND decision_id IS NULL) OR
         (job_type = 'OUTCOME_VERIFICATION' AND case_id IS NOT NULL AND decision_id IS NOT NULL)
     )
     ```
   - Constrained by `CK_analysis_jobs_status CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'))`.

**Conclusion**: No database migration (`V006`) was required. Existing constraints and schema are 100% sufficient and were strictly adhered to.

---

## 3. Architecture & Reconstruction Engine Design

The timeline reconstruction subsystem follows Causara's modular monolith architecture:

```
┌────────────────────────────────────────────────────────┐
│                   REST API Layer                       │
│  app/api/timeline.py                                   │
│  - GET  /api/v1/orders/<id>/timeline                   │
│  - POST /api/v1/orders/<id>/timeline/reconstruct       │
│  - GET  /api/v1/analysis-jobs/<id>                     │
│  - GET  /api/v1/orders/<id>/analysis-jobs              │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                 Domain Service Layer                   │
│  app/services/timeline_service.py                      │
│  - Pure algorithmic reconstruction                     │
│  - ISO-8601 UTC timestamp normalization                │
│  - Deterministic multi-key sorting                     │
│  - Non-destructive deduplication & conflict detection  │
│  - Planned vs. actual stage variance calculation       │
│  - Evidence classification (FACT / INFERRED / ISSUE)   │
│  - Customer-safe plain-language summary narrative      │
│  - Analysis job execution & status lifecycle           │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│               Data Access Repository                   │
│  app/repositories/timeline_repository.py               │
│  - Parameterized queries with deterministic ORDER BY   │
│  - Atomic stage actuals persistence                    │
│  - Analysis job creation & transition management       │
│  - Audit log recording                                 │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│              Transactional Database                    │
│  Microsoft SQL Server LocalDB                          │
│  dbo.orders, dbo.order_stages, dbo.order_events,       │
│  dbo.analysis_jobs, dbo.audit_log                      │
└────────────────────────────────────────────────────────┘
```

---

## 4. Algorithmic Rules & Epistemological Boundaries

### 4.1 Deterministic Physical Ordering
SQL Server and Python sorting enforce absolute stability:
```sql
SELECT e.event_id, e.order_id, e.stage_id, s.stage_code, s.sequence_no,
       e.event_type, e.occurred_at, e.received_at, e.source_type,
       e.source_provider, e.source_event_id, e.location, e.description, e.raw_payload
FROM dbo.order_events e
LEFT JOIN dbo.order_stages s ON e.stage_id = s.stage_id
WHERE e.order_id = ?
ORDER BY e.occurred_at ASC, e.received_at ASC, e.event_id ASC;
```
If two events occurred at the exact same physical instant (`occurred_at`), ingestion receipt order (`received_at`) breaks the tie. If both timestamps match, the unique auto-incrementing `event_id` provides the final immutable tie-breaker.

### 4.2 Non-Destructive Deduplication & Conflict Detection
1. **Duplicate Events**: If an event matches an existing event on `(event_type, occurred_at, stage_code)`:
   - Preserved in the timeline (zero event deletion).
   - Flagged with `is_duplicate = True`, `duplicate_of = original_event_id`.
   - `validation_status = 'DUPLICATE'`.
   - `evidence_classification = 'DATA_QUALITY_ISSUE'`.
2. **Out-of-Order Ingestion**: Evaluated in physical ingestion stream order (`received_at ASC, event_id ASC`). If an incoming event occurred *earlier* than an event that was already received:
   - Flagged with `validation_status = 'OUT_OF_ORDER'`.
   - Warning notes the event arrived after a later-occurring event.
   - `related_event_ids` includes the prior received event.
   - Preserved as a `FACT` for stage progression once integrated.
3. **Post-Terminal Conflicts**: If an operational event occurs after the order reached a terminal state (`DELIVERED`, `CANCELLED`, `RETURNED`):
   - Flagged with `is_conflict = True`.
   - `validation_status = 'CONFLICTING'`.
   - `evidence_classification = 'DATA_QUALITY_ISSUE'`.
   - Excluded from advancing operational stage progress.
4. **Stage Sequence Inversions**: If an event occurs with a lower stage sequence number than a previously observed valid event:
   - Flagged with `is_conflict = True`.
   - `validation_status = 'CONFLICTING'`.
   - Warning explicitly documents the inverted stage transition.

### 4.3 Stage Progression & Variance Calculation
Valid events are grouped by stage and evaluated against planned baseline windows:
- **Actual Start**: Established by the earliest valid event in that stage.
- **Actual End**: Established by the latest event in that stage, or when a subsequent stage starts.
- **Actual Duration**: `(actual_end_at - actual_start_at)` in minutes.
- **Variance**: `actual_duration_minutes - planned_duration_minutes`.
  - Positive variance: Stage took longer than planned (`time_lost_minutes = variance`).
  - Negative variance: Stage completed faster than planned (`time_recovered_minutes = -variance`).
- **Skipped Stages**: Stages with zero recorded events while subsequent stages have commenced or completed are marked `status = 'SKIPPED'`. The engine raises an anomaly warning and never synthesizes phantom events.
- **Repeated Stage Events**: Multiple distinct events within the same stage (e.g. repeated courier out-for-delivery scans) are recorded and flagged as operational repetitions.

### 4.4 Customer Summary Safety Boundary
The plain-language narrative strictly enforces operational clarity without leaking internal liability:
- States current progress and confirmed delivery milestone.
- Summarizes whether stages completed on schedule or experienced delay.
- Omits internal supplier attribution, driver fault, carrier disputes, or confidential costs.
- Displays a neutral holding message if zero events have arrived.

---

## 5. API Endpoints & Request/Response Contracts

### 5.1 `GET /api/v1/orders/<order_id>/timeline`
Retrieves the normalized, chronological timeline, stage progression, and customer summary.

**Response Example (200 OK)**:
```json
{
  "success": true,
  "data": {
    "order_id": 100599,
    "order_status": "DELIVERED",
    "external_order_ref": "ORD-M23-001",
    "placed_at": "2026-11-04T10:00:00Z",
    "expected_delivery_at": "2026-11-06T18:00:00Z",
    "actual_delivery_at": "2026-11-06T17:00:00Z",
    "reconstructed_at": "2026-11-09T16:20:00Z",
    "job_id": null,
    "summary": {
      "is_complete": true,
      "has_anomalies": false,
      "total_events": 5,
      "valid_event_count": 5,
      "duplicate_count": 0,
      "conflict_count": 0,
      "out_of_order_count": 0,
      "customer_summary": "Your order was successfully delivered on 2026-11-06 17:00:00 UTC. Total transit time was 55.0 hours.",
      "warnings": []
    },
    "stage_progression": [
      {
        "stage_id": 100951,
        "stage_code": "SELLER_PROCESSING",
        "sequence_no": 1,
        "status": "COMPLETED",
        "planned_start_at": "2026-11-04T10:00:00Z",
        "planned_end_at": "2026-11-04T16:00:00Z",
        "actual_start_at": "2026-11-04T10:00:00Z",
        "actual_end_at": "2026-11-04T16:00:00Z",
        "event_count": 1,
        "event_ids": [501],
        "planned_duration_minutes": 360,
        "actual_duration_minutes": 360,
        "variance_minutes": 0,
        "time_lost_minutes": 0,
        "time_recovered_minutes": 0,
        "anomalies": []
      }
    ],
    "timeline": [
      {
        "event_id": 501,
        "order_id": 100599,
        "stage_id": 100951,
        "stage_code": "SELLER_PROCESSING",
        "sequence_no": 1,
        "event_type": "ORDER_PLACED",
        "occurred_at": "2026-11-04T10:00:00Z",
        "received_at": "2026-11-04T10:00:01Z",
        "source_type": "WEBHOOK",
        "source_provider": "SHOPIFY",
        "sequence_position": 1,
        "validation_status": "VALID",
        "evidence_classification": "FACT",
        "is_duplicate": false,
        "duplicate_of": null,
        "is_conflict": false,
        "is_inferred": false,
        "warnings": [],
        "related_event_ids": []
      }
    ]
  },
  "meta": {
    "request_id": "req-9b87c12f"
  }
}
```

### 5.2 `POST /api/v1/orders/<order_id>/timeline/reconstruct`
Triggers synchronous or asynchronous timeline reconstruction.

**Request Body (Synchronous)**:
```json
{
  "async": false,
  "persist_stage_actuals": true
}
```
**Response**: Immediate 200 OK with `data` containing full `ReconstructedTimeline`.

**Request Body (Asynchronous)**:
```json
{
  "async": true
}
```
**Response (202 Accepted)**:
```json
{
  "success": true,
  "data": {
    "job_id": 801,
    "order_id": 100599,
    "job_type": "TIMELINE_RECONSTRUCTION",
    "status": "QUEUED",
    "created_at": "2026-11-09T16:21:00Z",
    "message": "Timeline reconstruction job queued successfully."
  },
  "meta": {
    "request_id": "req-3fa85f64"
  }
}
```

### 5.3 `GET /api/v1/analysis-jobs/<job_id>`
Fetches the status, duration, error message, and result payload of an analysis job.

### 5.4 `GET /api/v1/orders/<order_id>/analysis-jobs`
Returns all analysis jobs for an order sorted by creation time descending.

---

## 6. Automated Test Suite Execution

The automated test suite in `tests/test_timeline_reconstruction.py` covers 14 specific scenarios:

| # | Scenario / Test Name | Condition Tested | Verification Assertions | Result |
|---|---|---|---|:---:|
| 1 | `test_normal_chronological_order` | Ideal chronological 5-stage order | Perfect stage progression, zero anomalies, delivery timestamp verified | **PASSED** |
| 2 | `test_out_of_order_event_arrival` | Event 2 received at 13:00 after Event 3 arrived at 12:05 | Placed at chronological position 2, flagged `OUT_OF_ORDER`, out_of_order_count >= 1 | **PASSED** |
| 3 | `test_equal_occurrence_timestamps_deterministic_tie_breaking` | 4 events with identical `occurred_at` | Deterministic ordering on `received_at`, tie-breaker on `event_id`, stable on repeated runs | **PASSED** |
| 4 | `test_duplicate_events` | 3 events with identical (type, occurred_at, stage) | Non-destructive: all 3 preserved; 2 duplicates flagged, `duplicate_of` original, valid_count = 1 | **PASSED** |
| 5 | `test_conflicting_events` | In-transit event occurring after order was already delivered | Preserved; flagged `CONFLICTING`, `post-terminal conflict` warning, `DATA_QUALITY_ISSUE` | **PASSED** |
| 6 | `test_missing_events_and_incomplete_timelines` | Stages 2 & 3 completely missing from event stream | Gaps reported; Stages 2 & 3 marked `SKIPPED`; zero phantom events fabricated | **PASSED** |
| 7 | `test_invalid_stage_transitions` | Event in Stage 1 occurs chronologically after Stage 4 | Flagged `CONFLICTING`, `stage sequence inversion` warning, anomaly recorded | **PASSED** |
| 8 | `test_repeated_stage_events` | Multiple courier out-for-delivery events in Last Mile | Multiple events preserved in stage, `Repeated event occurrences` anomaly flagged | **PASSED** |
| 9 | `test_orders_with_no_events` | Order with planned stages but zero received events | Returns clean empty timeline, planned stages `PENDING`, customer-safe holding message | **PASSED** |
| 10 | `test_invalid_or_missing_orders` | Querying nonexistent order ID | Raises HTTP 404 with standard envelope `ORDER_NOT_FOUND` | **PASSED** |
| 11 | `test_timezone_normalization` | Disparate offsets (`+05:30` IST, `-04:00` EDT, `Z` UTC) | Correctly normalized to UTC; exact chronological order verified | **PASSED** |
| 12 | `test_reconstruction_idempotency` | Multiple identical synchronous reconstructions | Deterministic results; duplicate background jobs deduplicated under `QUEUED`/`RUNNING` | **PASSED** |
| 13 | `test_job_failure_and_retry_behavior` | Job failure during execution | Status transitions to `FAILED`, `retry_count` incremented, sanitized error captured | **PASSED** |
| 14 | `test_api_endpoints` | End-to-end HTTP requests across all 4 REST endpoints | 200 OK, 202 Accepted, pagination/envelopes match API specification | **PASSED** |

### Regression Verification
- **Total Test Suite**: 92 tests
- **Milestones Covered**: M0, M1, M2.1, M2.2, M2.3
- **Result**: 92 passed in 9.30s (100% pass rate)
- **Flake8**: 0 errors, 0 warnings across all project code

---

## 7. Known Limitations & Scope Boundaries

1. **Deterministic Facts Only**: This milestone specifically reconstructs facts and observations. It does not calculate counterfactual scenarios, identify root delay causes, or propose interventions (deferred to M2.4 and M2.5).
2. **Synchronous vs. Asynchronous Scheduling**: In LocalDB testing environments, asynchronous execution runs in-process or via simulated worker execution. Production deployment leverages Azure Storage Queue and Azure Functions as designed in `docs/03-system-architecture.md`.
3. **No External Machine Learning or LLM Dependencies**: The engine operates purely deterministically using relational database logic and Python data structures without external API calls or AI hallucinations.

---

## 8. Summary of Files Created & Modified

### Created Files
- `app/repositories/timeline_repository.py`: Parameterized database operations for timeline reconstruction, stage updates, and analysis job lifecycle.
- `app/services/timeline_service.py`: Domain models (`ReconstructedTimeline`, `ReconstructedStage`, `TimelineEvent`, `TimelineSummary`), timestamp normalizer, evidence classifier, and reconstruction algorithms.
- `app/api/timeline.py`: Versioned REST API endpoints for timeline inspection, reconstruction execution, and analysis job tracking.
- `tests/test_timeline_reconstruction.py`: Comprehensive test suite verifying all 14 milestone scenarios.
- `docs/M2-3-IMPLEMENTATION-REPORT.md`: This document.

### Modified Files
- `app/repositories/__init__.py`: Exported `TimelineRepository`.
- `app/services/__init__.py`: Exported `TimelineService`, `ReconstructedTimeline`, `ReconstructedStage`, `TimelineEvent`.
- `app/api/__init__.py`: Registered `timeline_bp` blueprint on the Flask application.
- `docs/05-api-specification.md`: Synchronized documentation for `POST /orders/{id}/timeline/reconstruct` and `GET /orders/{id}/analysis-jobs`.
