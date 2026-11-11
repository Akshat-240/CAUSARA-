# Causara — Submission Sprint: Backend MVP Completion Report

**Project:** Causara — Explainable E-Commerce Order Delay Intelligence and Intervention Analysis  
**Date:** 10 November 2026  
**Status:** Completed & Verified  
**Workspace:** `C:\Users\aksha\Desktop\ESPV1`  

---

## 1. Executive Summary

The Causara backend MVP has been successfully completed in accordance with the Submission Sprint specification. The implementation delivers an end-to-end, modular monolith backend powering:
- High-throughput idempotent event ingestion.
- Crash-resilient transactional outbox processing with exponential retry backoff.
- Factual timeline reconstruction and normalization with strict anomaly detection.
- Tamper-evident evidence registration with local storage abstraction.
- Deterministic delay-chain reconstruction with epistemological separation of facts, duration variances, causal hypotheses, and estimates.
- Rule-based intervention discovery matching operational delay points to realistic recovery actions.
- Multi-scenario simulation calculating projected time savings, estimated costs, risk ratings, and confidence scores.
- Decision governance with manager approvals and immutable audit logging.
- Outcome verification reconciling actual delivery against predicted delivery, computing signed prediction errors and SLA variances.
- Complete order management and operational stage lifecycle APIs.
- Deterministic demonstration seed data showcasing four comprehensive business scenarios.

---

## 2. Implemented Capabilities & Architecture

### 2.1 M2.3 Critical Defect Remediation
- **Out-of-Order Ingestion Detection**: Precomputes arrival order using `received_at ASC, event_id ASC` and tracks `max_seen_occurred_at` to distinguish out-of-order events from skipped stages.
- **Terminal Event Semantics**: Disconnected non-delivery terminal events (`CANCELLED`, `RETURNED`) from delivery confirmation. Cancelled orders cleanly finalize without populating `actual_delivery_at` or emitting false delivery summaries.
- **Completed Job Fencing**: Enforced atomic transitions on `dbo.analysis_jobs` via `expected_statuses=['QUEUED', 'FAILED']` and short-circuited repeated execution on `COMPLETED` jobs to prevent overwriting results.

### 2.2 Evidence Management (`dbo.evidence`)
- **Repository**: [`EvidenceRepository`](file:///c:/Users/aksha/Desktop/ESPV1/app/repositories/evidence_repository.py) enforcing foreign keys `FK_evidence_order_event` and `FK_evidence_order_case` to block cross-order contamination.
- **Service**: [`EvidenceService`](file:///c:/Users/aksha/Desktop/ESPV1/app/services/evidence_service.py) providing `LocalStorageProvider` persistence at `storage/evidence/<order_id>/`, SHA-256 integrity hashing, 10MB file limit, and MIME validation (`application/pdf`, `image/jpeg`, `image/png`, `text/plain`).
- **REST API**: [`app/api/evidence.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/api/evidence.py) supporting both JSON metadata ingestion and direct multipart file uploads.

### 2.3 Delay-Chain Reconstruction & Epistemological Guardrails (`dbo.delay_edges`)
- **Repository**: [`DelayRepository`](file:///c:/Users/aksha/Desktop/ESPV1/app/repositories/delay_repository.py) wrapping `dbo.decision_cases` and `dbo.delay_edges`, compatible with SQL Server table triggers via `SET NOCOUNT ON` table variable returns.
- **Service**: [`DelayAnalysisService`](file:///c:/Users/aksha/Desktop/ESPV1/app/services/delay_service.py) computing planned vs. actual stage durations, excess durations, and building graph edges:
  - `STAGE_TRANSITION` (`FACT`): Sequential stage handovers with observed timestamps.
  - `BOTTLENECK_PROPAGATION` (`HYPOTHESIS`): Delay in an upstream stage hypothesized to compress downstream operational buffers.
- **Epistemological Guardrail**: Strictly partitions reporting into **Facts**, **Variances**, **Hypotheses**, and **Estimates**, accompanied by mandatory epistemological disclaimer:
  > *"Epistemological Guardrail: Duration variance indicates deviation from planned schedule buffers. It constitutes an observed arithmetic variance and does not, in isolation, prove causal blame or responsibility."*

### 2.4 Intervention Discovery & Scenario Simulation (`dbo.scenarios`, `dbo.scenario_interventions`)
- **Discovery**: [`InterventionService`](file:///c:/Users/aksha/Desktop/ESPV1/app/services/intervention_service.py) dynamically matches delay points to candidate interventions:
  - `SELLER_PROCESSING` delay $\rightarrow$ `PRIORITY_PACKING` (Warehouse expedite, 60–240m savings, $25).
  - `DISPATCH` handover bottleneck $\rightarrow$ `CARRIER_REROUTE` (Carrier partner switch, 120–480m savings, $65).
  - `LINEHAUL_TRANSPORT` major delay $\rightarrow$ `AIR_FREIGHT_UPGRADE` (Next-flight-out air cargo, 360–1200m savings, $180).
  - `LAST_MILE` distribution delay $\rightarrow$ `HUB_EXPEDITE` (Priority dock sorting, 60–240m savings, $35).
  - Any delayed order $\rightarrow$ `CUSTOMER_PROACTIVE_NOTICE` (Trust & SLA reset, $0).
- **Simulation**: [`ScenarioService`](file:///c:/Users/aksha/Desktop/ESPV1/app/services/scenario_service.py) models compound interventions, calculates `predicted_time_saved_minutes`, `estimated_cost`, `risk_level` (`LOW`/`MEDIUM`/`HIGH`), `confidence_score` (0.62–0.88), and records explicit operational assumptions.

### 2.5 Decisions & Outcome Verification (`dbo.decisions`, `dbo.verifications`)
- **Stored Procedure Integration**:
  - `dbo.usp_RecordDecision`: Persists decision in `PENDING` status, validates scenario-case alignment, logs to `dbo.audit_log`.
  - `dbo.usp_ApproveDecision`: Updates status to `APPROVED`, records `approved_by`, creates transactional `outbox_events` row (`DECISION_APPROVED`).
  - `dbo.usp_VerifyPrediction`: Reconciles actual delivery timestamp against predicted delivery, computing persisted columns `signed_prediction_error_minutes`, `absolute_prediction_error_minutes`, and `delivery_variance_minutes`.
- **Unique Verification Guarantee**: Unique constraint `UQ_verifications_decision` preserved while allowing reconciliation updates.

### 2.6 Order Management & Demonstration Data
- **Order APIs**: [`app/api/orders.py`](file:///c:/Users/aksha/Desktop/ESPV1/app/api/orders.py) supporting order creation with automatic 5-stage proportional timeline synthesis (15/10/45/20/10% buffer split), order detail retrieval, stage querying, and tenant filtering.
- **Demo Script**: [`database/seed_demo_data.py`](file:///c:/Users/aksha/Desktop/ESPV1/database/seed_demo_data.py) deterministically seeding:
  1. `ORD-DEMO-ONTIME-001`: Fully completed on-time delivery.
  2. `ORD-DEMO-WAREHOUSE-002`: Active warehouse picking bottleneck with incident evidence, delay analysis graph, multi-intervention scenario simulation, and approved decision.
  3. `ORD-DEMO-TRANSPORT-003`: Linehaul transport delay resolved via air freight upgrade, decision executed, and outcome verified with exact signed prediction errors.
  4. `ORD-DEMO-CANCELLED-004`: Clean customer cancellation at seller processing with null delivery timestamp and no false delivery notices.

---

## 3. Implemented File Inventory

| Layer | File | Purpose |
| :--- | :--- | :--- |
| **Repositories** | `app/repositories/evidence_repository.py` | Data access for `dbo.evidence` |
| | `app/repositories/delay_repository.py` | Data access for `dbo.decision_cases` and `dbo.delay_edges` |
| | `app/repositories/scenario_repository.py` | Data access for `dbo.interventions`, `dbo.scenarios`, `dbo.scenario_interventions` |
| | `app/repositories/decision_repository.py` | Wraps `usp_RecordDecision`, `usp_ApproveDecision`, `usp_VerifyPrediction` |
| | `app/repositories/order_repository.py` | Data access for `dbo.orders` and `dbo.order_stages` |
| **Services** | `app/services/evidence_service.py` | Evidence file upload, storage, hash validation |
| | `app/services/delay_service.py` | Delay analysis, variance math, epistemological guardrails |
| | `app/services/intervention_service.py` | Delay point matching to operational candidate interventions |
| | `app/services/scenario_service.py` | Scenario simulation and multi-option synthesis |
| | `app/services/decision_service.py` | Decision lifecycle, approval governance, outcome verification |
| | `app/services/order_service.py` | Order creation and stage baseline scheduling |
| **API Endpoints**| `app/api/evidence.py` | REST routes for evidence ingestion and retrieval |
| | `app/api/delay.py` | REST routes for delay analysis and case graph |
| | `app/api/scenarios.py` | REST routes for intervention discovery and scenarios |
| | `app/api/decisions.py` | REST routes for decisions, approvals, and verifications |
| | `app/api/orders.py` | REST routes for order creation, listing, and stages |
| **Database** | `database/seed_demo_data.py` | Deterministic, rerunnable 4-order seed script |
| **Tests** | `tests/test_evidence.py` | 8 integration tests for evidence backend |
| | `tests/test_delay_analysis.py` | 4 integration tests for delay-chain reconstruction |
| | `tests/test_scenarios.py` | 4 integration tests for intervention & scenario simulation |
| | `tests/test_decisions.py` | 4 integration tests for decision governance & verification |
| | `tests/test_orders.py` | 3 integration tests for order management & stage synthesis |
| **Docs** | `docs/DEFERRED-WORK-CHECKLIST.md` | Comprehensive deferred work checklist across 6 categories |
| | `docs/05-api-specification.md` | Updated API contract reflecting all endpoints |

---

## 4. Verification & Quality Standards

- **Epistemological Integrity**: Variance in stage duration is never conflated with causal fault; candidate causal edges are clearly labeled `HYPOTHESIS`.
- **Idempotency & Isolation**: Every test suite operates in isolated fixtures with full teardown; stored procedures handle duplicate records predictably.
- **SQL Server Standards**: All T-SQL statements use parameterized inputs, avoid SQL injection, and properly handle table trigger constraints.
- **Python Quality**: Type annotations applied throughout; clean PEP 8 adherence verified via Flake8.
