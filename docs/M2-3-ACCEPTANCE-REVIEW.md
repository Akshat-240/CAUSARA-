# Causara M2.3 — Focused Acceptance Review
## Timeline Reconstruction & Normalization Engine

**Review Date**: November 9, 2026  
**Auditor**: Independent Engineering Audit (Antigravity)  
**Status**: FIX REQUIRED  
**Scope**: Read-only acceptance review of Milestone M2.3 implementation and test suite  
**Inspected Artifacts**:
- `app/services/timeline_service.py`
- `app/repositories/timeline_repository.py`
- `app/api/timeline.py`
- `tests/test_timeline_reconstruction.py`
- `docs/M2-3-IMPLEMENTATION-REPORT.md`

---

## 1. Executive Summary & Final Recommendation

An exhaustive, read-only audit of the completed Milestone M2.3 implementation was performed across all five specified review areas:
1. **Data Integrity**
2. **Reconstruction Correctness**
3. **Fact vs. Inference**
4. **Job Lifecycle**
5. **API Correctness**

Special attention was given to:
- Duplicate event classification vs. legitimate repeated operational events
- Ingestion out-of-order arrival vs. chronological stage sequence inversion
- Epistemological semantics of `time_lost_minutes`
- Consistency between synchronous and asynchronous reconstruction

### Recommendation: **FIX REQUIRED**

While the core architecture, deterministic tie-breaking, non-destructive event retention, and database regression integrity (78/78 prior milestone tests passing) are sound, **two High-Severity defects** and **one Medium-Severity defect** were discovered in `app/services/timeline_service.py`:
1. **Out-of-Order Ingestion Detection is Mathematically Unreachable**: An algorithmic flaw in timestamp comparison causes `test_out_of_order_event_arrival` to fail (`AssertionError: assert 'VALID' == 'OUT_OF_ORDER'`).
2. **Non-Delivery Terminal Events (`CANCELLED`, `RETURNED`) Corrupt Order State to `DELIVERED`**: When an order is cancelled, the engine incorrectly treats the event as a verified delivery, populating `actual_delivery_at`, marking the order `status = 'DELIVERED'` in SQL Server, and informing the customer that their package was successfully delivered.
3. **Analysis Job Re-execution Lacks Lifecycle Fencing**: Already completed jobs can be reset to `RUNNING` without status checks.

Remediation of these three findings is required before Milestone M2.3 can be accepted.

---

## 2. Review Area Findings

### Area 1: Data Integrity
> **Requirement**: Source events are never modified or deleted during reconstruction.

- **Status**: **VERIFIED / PASS**
- **Audit Findings**:
  - `app/repositories/timeline_repository.py::get_order_events` performs a pure `SELECT` with `ORDER BY e.occurred_at ASC, e.received_at ASC, e.event_id ASC`.
  - No `UPDATE` or `DELETE` SQL statements exist against `dbo.order_events` anywhere in the timeline subsystem.
  - In `app/services/timeline_service.py::build_timeline_from_data`, every raw event passed into the engine is preserved in `reconstructed.timeline`. Even duplicates and conflicts are retained with original IDs, payloads, and timestamps.
  - Length of `reconstructed.timeline` strictly equals `len(raw_events)`. Zero raw data is pruned, overwritten, or discarded.

---

### Area 2: Reconstruction Correctness
> **Requirement**: Sorting, timezone conversion, duplicate detection, conflicts, stage transitions and skipped-stage handling are logically correct.

- **Status**: **FAIL (Defect Identified)**
- **Audit Findings**:
  - **Sorting & Determinism (PASS)**: Deterministic multi-key sort `(occurred_at ASC, received_at ASC, event_id ASC)` is enforced both in SQL Server and in Python. `test_equal_occurrence_timestamps_deterministic_tie_breaking` confirms 100% deterministic order across repeated runs.
  - **Timezone Normalization (PASS)**: `parse_to_utc_datetime` correctly converts naive, aware, and string ISO-8601 timestamps (`+05:30`, `-04:00`, `Z`) to aware UTC datetime objects.
  - **Duplicate Detection (PASS)**: Exact duplicates are identified by `(event_type, occurred_at, stage_code)`. Non-destructive tracking marks `is_duplicate = True`, `duplicate_of = original_event_id`, and `evidence_classification = 'DATA_QUALITY_ISSUE'`.
  - **Skipped Stages (PASS)**: When events are missing for intermediate stages while subsequent stages have commenced, stages are marked `SKIPPED`. Zero phantom events or artificial timestamps are synthesized.
  - **Conflict Detection (PASS)**: Post-terminal events and backward stage sequence inversions are explicitly flagged `is_conflict = True` and excluded from advancing stage progression.
  - **Out-of-Order Ingestion (FAIL — Finding 1)**: The out-of-order arrival loop evaluates `occ_dt < prior_occ` over events that are already sorted chronologically by `occurred_at ASC`. Because every prior event in the loop occurred earlier or at the same time, `occ_dt < prior_occ` is mathematically impossible. Out-of-order arrivals are never detected.

---

### Area 3: Fact Versus Inference
> **Requirement**: Stage duration variance must not be presented as confirmed delay causation. Customer summaries must not invent explanations.

- **Status**: **FAIL (Defect Identified)**
- **Audit Findings**:
  - **Evidence Classification (PASS)**: Verified operational events are labeled `FACT`. Unmapped events mapped via heuristics are labeled `INFERRED` (`is_inferred = True`). Duplicates and conflicts are labeled `DATA_QUALITY_ISSUE`.
  - **Delay Causation Boundaries (PASS)**: `variance_minutes`, `time_lost_minutes`, and `time_recovered_minutes` are strictly duration delta arithmetic against planned stage baselines (`actual_duration - planned_duration`). Neither the service nor the API presents stage variance as proven root-cause delay attribution.
  - **Customer Summary Narrative (FAIL — Finding 2)**: While the generator avoids supplier blame and confidential cost leaks, a fatal logic flaw in terminal event classification causes cancelled or returned orders to output:
    `"Your package was successfully delivered on <cancellation_time>."`
    This constitutes false narrative invention.

---

### Area 4: Job Lifecycle
> **Requirement**: Repeated reconstruction requests are idempotent, job failures are handled correctly, and job status transitions are valid.

- **Status**: **PASS WITH CONCERN (Finding 3)**
- **Audit Findings**:
  - **Idempotency (PASS)**: `create_analysis_job` queries `dbo.analysis_jobs` by `idempotency_key` prior to insertion, returning existing records without duplicate generation.
  - **Constraint Compliance (PASS)**: All job insertions satisfy check constraint `CK_analysis_jobs_type_deps` (`job_type = 'TIMELINE_RECONSTRUCTION' AND case_id IS NULL AND decision_id IS NULL`).
  - **Failure Handling (PASS)**: Unhandled exceptions transition job status to `FAILED`, record sanitized `error_message`, and allow subsequent retry.
  - **Lifecycle Fencing (Concern — Finding 3)**: `execute_reconstruction_job` unconditionally sets `status = 'RUNNING'` without checking whether the job was already `COMPLETED` or is currently `RUNNING`.

---

### Area 5: API Correctness
> **Requirement**: Endpoints validate input, check order ownership/existence where applicable, and return consistent error envelopes.

- **Status**: **VERIFIED / PASS**
- **Audit Findings**:
  - All four endpoints (`GET /orders/<id>/timeline`, `POST /orders/<id>/timeline/reconstruct`, `GET /analysis-jobs/<id>`, `GET /orders/<id>/analysis-jobs`) validate target order/job existence.
  - Nonexistent orders return standard `404 Not Found` with envelope code `ORDER_NOT_FOUND`.
  - Nonexistent analysis jobs return `404 Not Found` with envelope code `RESOURCE_NOT_FOUND`.
  - Success responses adhere to the standard envelope: `{"success": true, "data": {...}, "meta": {"request_id": ...}}`.

---

## 3. Specific Focus Area Evaluations

### Focus Point A: Duplicate Classification vs. Legitimate Repeated Operational Events
- **Evaluation**: Verified correct.
- **Analysis**:
  - Deduplication signature: `sig = (e_type, occ_dt, stage_code)`.
  - An event is only a duplicate if it shares the **exact same physical occurrence timestamp** (`occurred_at`).
  - Legitimate repeated events (e.g. repeated courier delivery attempts on successive days or multiple distinct hub arrivals across transit routes) have distinct occurrence timestamps. They are preserved as distinct `VALID` events (`is_duplicate = False`).
  - In `_reconstruct_stages`, multiple distinct events within the same stage are recognized and flagged as `"Repeated event occurrences in stage '...'."` without being marked as duplicates.

### Focus Point B: Out-of-Order Arrival vs. Chronological Stage Sequence Inversion
- **Evaluation**: The conceptual distinction is architecturally sound, but out-of-order detection is currently broken by Finding 1.
- **Analysis**:
  - *Out-of-Order Ingestion*: Real-world event occurred in valid chronological sequence, but arrived late due to network latency, mobile batching, or offline courier sync. Modeled as `validation_status = 'OUT_OF_ORDER'`, `evidence_classification = 'FACT'`, `is_conflict = False`.
  - *Stage Sequence Inversion*: Physical event occurred chronologically after a later stage (e.g. `PACKING_STARTED` occurring at T+15h after `OUT_FOR_DELIVERY` occurred at T+10h). Modeled as `validation_status = 'CONFLICTING'`, `evidence_classification = 'DATA_QUALITY_ISSUE'`, `is_conflict = True`.
  - The distinction is clean, but due to Finding 1, out-of-order ingestion events fall through to `VALID`.

### Focus Point C: Does `time_lost_minutes` Imply Causation Without Evidence?
- **Evaluation**: Semantically safe in current code, but requires explicit documentation guardrails.
- **Analysis**:
  - `time_lost_minutes = max(0, actual_duration_minutes - planned_duration_minutes)`.
  - This is pure window duration variance arithmetic.
  - The engine does not claim that positive variance in an intermediate stage caused overall delivery tardiness.
  - However, downstream consumers could mistake `time_lost_minutes` for causal blame. Explicit docstrings must affirm that causal analysis belongs strictly to M2.4.

### Focus Point D: Consistency Between Synchronous and Asynchronous Reconstruction
- **Evaluation**: Verified consistent.
- **Analysis**:
  - Both synchronous execution (`POST .../reconstruct` with `async: false`) and asynchronous worker execution invoke `execute_reconstruction_job(job_id)`.
  - Both update stage actuals in `dbo.order_stages` and write an audit record.
  - Subsequent read via `GET /api/v1/orders/<order_id>/timeline` executes `build_timeline_from_data`, producing identical chronological events, stage progressions, and summaries.

---

## 4. Detailed Defect Reports

### Finding 1: Broken Out-of-Order Ingestion Detection Loop
- **Severity**: **HIGH**
- **Impact**: Late-arriving events are never flagged as out-of-order arrivals. Anomaly summary `out_of_order_count` is permanently 0. Integration test `test_out_of_order_event_arrival` fails.
- **Source Location**: `app/services/timeline_service.py`, lines 478–496:
  ```python
  # 2. Out-of-Order Ingestion Detection (received later, occurred earlier)
  if processed_received_timestamps and processed_occurred_timestamps:
      for prior_idx, (prior_occ, prior_rec) in enumerate(
          zip(processed_occurred_timestamps, processed_received_timestamps)
      ):
          if rec_dt > prior_rec and occ_dt < prior_occ:
              out_of_order_count += 1
              ...
  ```
- **Root Cause**:
  `sorted_events` is sorted by `occurred_at ASC`. As the loop progresses, every timestamp in `processed_occurred_timestamps` is $\le$ `occ_dt`. Thus, `occ_dt < prior_occ` is mathematically impossible.
- **Reproduction Steps**:
  1. Ingest Event 1: occurred 10:00, received 10:01.
  2. Ingest Event 3: occurred 12:00, received 12:05.
  3. Ingest Event 2: occurred 11:00, received 13:00 (arrived after Event 3).
  4. Run `TimelineService().reconstruct_order_timeline(order_id)`.
  5. Inspect `reconstructed.timeline[1].validation_status`. Expected `'OUT_OF_ORDER'`, actual `'VALID'`.
- **Remediation**:
  Precompute out-of-order arrivals by sorting events in receipt order (`received_at ASC, event_id ASC`). An event arrived out-of-order if its `occurred_at` timestamp is earlier than the maximum `occurred_at` timestamp of all events received prior to it:
  ```python
  events_by_receipt = sorted(
      sorted_events,
      key=lambda item: (item["_received_dt"], int(item["event_id"])),
  )
  out_of_order_info: Dict[int, Tuple[int, datetime]] = {}
  max_seen_occ_dt: Optional[datetime] = None
  max_seen_occ_id: Optional[int] = None

  for item in events_by_receipt:
      item_id = int(item["event_id"])
      item_occ = item["_occurred_dt"]
      if max_seen_occ_dt is not None and item_occ < max_seen_occ_dt:
          out_of_order_info[item_id] = (max_seen_occ_id, max_seen_occ_dt)
      elif max_seen_occ_dt is None or item_occ > max_seen_occ_dt:
          max_seen_occ_dt = item_occ
          max_seen_occ_id = item_id
  ```
  Then in `_classify_and_validate_events`, check `if not is_duplicate and e_id in out_of_order_info:`.

---

### Finding 2: Non-Delivery Terminal Events (`CANCELLED`, `RETURNED`) Erroneously Treated as Delivery
- **Severity**: **HIGH**
- **Impact**: Database corruption of order status, incorrect `actual_delivery_at` timestamps, and false customer summary messages.
- **Source Location**: `app/services/timeline_service.py`, lines 654–658, lines 802–805, lines 848–855:
  ```python
  # Line 654
  if s_code == "DELIVERED" or any(e.event_type in TERMINAL_EVENT_TYPES for e in matched_events):
      status = "COMPLETED"
      last_event = matched_events[-1]
      actual_end_dt = parse_to_utc_datetime(last_event.occurred_at)
      verified_delivery_dt = actual_end_dt
  ```
- **Root Cause**:
  `TERMINAL_EVENT_TYPES` includes `CANCELLED` and `RETURNED`. When an order is cancelled during seller processing, the event is treated as establishing `verified_delivery_dt`.
  This cascades into:
  - Setting `reconstructed.actual_delivery_at = cancellation_time`.
  - Executing `UPDATE dbo.orders SET actual_delivery_at = ?, status = 'DELIVERED'` in `_persist_reconstruction_effects`.
  - Returning customer summary: `"Your package was successfully delivered on <cancellation_time>."`
- **Reproduction Steps**:
  1. Create an order with status `PROCESSING`.
  2. Ingest event `CANCELLED` with stage `SELLER_PROCESSING`.
  3. Reconstruct timeline with `persist_stage_actuals=True`.
  4. Query `dbo.orders` table: `status` has been changed to `DELIVERED` and `actual_delivery_at` is set to cancellation time.
  5. Inspect customer summary: claims package was successfully delivered.
- **Remediation**:
  Define explicit `DELIVERY_CONFIRMATION_EVENT_TYPES = {"DELIVERED", "DELIVERY_CONFIRMED"}` distinct from `TERMINAL_EVENT_TYPES = {"DELIVERED", "DELIVERY_CONFIRMED", "CANCELLED", "RETURNED"}`. Only delivery confirmation events may populate `verified_delivery_dt` or update `dbo.orders.actual_delivery_at`. Cancellation events should transition stage status to `COMPLETED` or `CANCELLED`, but never set `verified_delivery_dt`.

---

### Finding 3: Analysis Job Execution Lacks State Fencing Against Completed Jobs
- **Severity**: **MEDIUM**
- **Impact**: Calling `execute_reconstruction_job` on an already completed job resets `started_at` and transitions `COMPLETED` $\rightarrow$ `RUNNING` $\rightarrow$ `COMPLETED`, mutating audit timestamps.
- **Source Location**: `app/services/timeline_service.py`, lines 941–948:
  ```python
  # Mark job RUNNING
  now_dt = datetime.now(timezone.utc)
  self.repo.update_analysis_job_status(
      job_id=job_id,
      status="RUNNING",
      started_at=now_dt,
  )
  ```
- **Root Cause**: No guard checking `if job["status"] == "COMPLETED"`.
- **Reproduction Steps**:
  1. Execute a timeline reconstruction job to completion.
  2. Call `execute_reconstruction_job` with the same `job_id`.
  3. Observe job status reset to `RUNNING` and timestamps overwritten.
- **Remediation**:
  If `job["status"] == "COMPLETED"`, return the reconstructed timeline immediately without altering job metadata. If `job["status"] == "RUNNING"`, reject or wait rather than resetting `started_at`.

---

## 5. Test Suite Verification Summary

| Suite | Total Tests | Passed | Failed | Health |
|---|:---:|:---:|:---:|:---:|
| `test_database.py` (M0) | 27 | 27 | 0 | 100% |
| `test_errors.py` (M0) | 3 | 3 | 0 | 100% |
| `test_event_ingestion.py` (M2.1) | 18 | 18 | 0 | 100% |
| `test_factory.py` (M0) | 3 | 3 | 0 | 100% |
| `test_health.py` (M0) | 2 | 2 | 0 | 100% |
| `test_migration_runner.py` (M1) | 4 | 4 | 0 | 100% |
| `test_outbox_processing.py` (M2.2) | 21 | 21 | 0 | 100% |
| **Previous Milestones Subtotal** | **78** | **78** | **0** | **100%** |
| `test_timeline_reconstruction.py` (M2.3) | 14 | 13 | 1 (`test_out_of_order_event_arrival`) | 92.8% |
| **Total Test Suite** | **92** | **91** | **1** | **98.9%** |

---

## 6. Required Action Plan Before M2.4

1. **Remediate Finding 1**:
   Update `_classify_and_validate_events` in `app/services/timeline_service.py` to precompute out-of-order receipt arrivals against ingestion sequence (`received_at ASC, event_id ASC`).
2. **Remediate Finding 2**:
   Separate delivery confirmation events (`DELIVERED`, `DELIVERY_CONFIRMED`) from cancellation/return events in `_reconstruct_stages`, `_persist_reconstruction_effects`, and `_generate_customer_summary`.
3. **Remediate Finding 3**:
   Add a guard in `execute_reconstruction_job` to prevent resetting `COMPLETED` jobs to `RUNNING`.
4. **Re-run Automated Tests**:
   Verify that all 14 tests in `tests/test_timeline_reconstruction.py` pass and all 92 tests across the full suite pass with 100% success.
5. **Update Implementation Report**:
   Ensure `docs/M2-3-IMPLEMENTATION-REPORT.md` reflects the accurate remediation.
6. **Halt**:
   Do not commence M2.4 until M2.3 remediation is accepted.
