# 02. Requirements Analysis

## 1. Functional Requirements

The functional requirements define the capabilities that Causara provides across its ingestion, reasoning, intervention, and verification pipelines.

| ID | Requirement Name | Description | Target Actor |
|---|---|---|---|
| **FR-01** | User Authentication & Registration | Register, authenticate, and manage users with role-based access control (RBAC). | All Actors |
| **FR-02** | Multi-Stage Event Ingestion | Ingest order lifecycle events across stages (Order Placed, Processing, Dispatched, In Transit, Delivered). | Seller, Courier |
| **FR-03** | Chronological Event Timeline | Maintain an immutable, ordered timeline of all events associated with an order. | Customer, Seller, Manager |
| **FR-04** | Delay Chain Reconstruction | Reconstruct the dependency chain of stages and determine where delay propagated. | Seller, Manager, Analyst |
| **FR-05** | Stage-Wise Duration Variance | Calculate planned vs. actual duration for each stage, identifying time lost and time recovered. | Seller, Manager, Analyst |
| **FR-06** | Epistemological Classification | Explicitly classify diagnostic insights into facts, hypotheses, and estimates. | All Actors |
| **FR-07** | Intervention Point Identification | Identify candidate stages where intervention remains feasible and impactful. | Seller, Manager |
| **FR-08** | Scenario & Intervention Comparison | Generate and compare alternative interventions evaluated on time saved, cost, risk, and confidence. | Seller, Manager |
| **FR-09** | Customer-Facing Explanations | Translate technical stage delays into concise, customer-friendly progress summaries (excluding supplier blame/costs). | Customer |
| **FR-10** | Traceable Decision Recording | Record human decisions on chosen interventions, including rationale, operator identity, and projected metrics. | Seller, Manager |
| **FR-11** | Empirical Outcome Verification | Automatically compare recorded predictions against observed delivery outcomes, deriving forecast accuracy without causal inflation. | Manager, Analyst |
| **FR-12** | Intervention & Audit Logging | Maintain an immutable audit log of all system state changes, approvals, and evidence references. | Auditor, Admin |
| **FR-13** | Dual Ingestion Pathways | Support both manual seller event entry and authenticated external courier/OMS payloads. | Seller, Courier |
| **FR-14** | Event Normalization | Transform disparate third-party event structures into a standardized internal event schema. | System |
| **FR-15** | Ingestion Authorization & Validation | Validate event schemas, reject malformed payloads, and enforce seller ownership over order IDs. | System |
| **FR-16** | Idempotency & Deduplication | Detect and prevent duplicate event processing using client/provider idempotency keys. | System |
| **FR-17** | Out-of-Order & Late Event Handling | Correctly order events using physical `occurred_at` timestamps, triggering timeline recalculations when necessary. | System |
| **FR-18** | Timestamp & Payload Preservation | Persist both `occurred_at` and `received_at` timestamps along with raw JSON payloads for forensic auditing. | Auditor, System |

---

## 2. Non-Functional Requirements (NFRs)

| Category | Requirement | Specification & Acceptance Criteria |
|---|---|---|
| **Security** | Role-Based Access Control | Enforce strict server-side authorization (RBAC) and data isolation (multi-tenancy) ensuring sellers only view their own data. |
| **Reliability** | Zero Event Loss | Incoming accepted events must be committed transactionally before queue dispatch; no accepted event may be silently dropped. |
| **Performance** | Responsive UI | Normal dashboard queries must return in under 300 ms; heavy timeline reconstructions must be offloaded asynchronously. |
| **Scalability** | Horizontal Growth | Modular monolith structure with decoupled asynchronous workers, ready for containerized auto-scaling on Azure. |
| **Maintainability** | Clean Architecture | Separation of presentation, HTTP routing, application services, domain algorithms, and data repositories (PEP 8 & strict TypeScript). |
| **Explainability** | Assumption Disclosure | Every calculated estimate must expose its underlying baseline assumptions and confidence scoring metrics. |
| **Consistency** | ACID Transactions | Decisions, approvals, outbox messages, and verification logs must execute within ACID transactions in Azure SQL. |
| **Availability** | Graceful Degradation | System must handle transient network or service failures gracefully with retry mechanisms and circuit breaks. |

---

## 3. Minimum Viable Product (MVP) Scope

For the initial operational release, Causara focuses on a dependable core:

### In Scope (MVP)
- User registration and login with JWT and role enforcement (Customer, Seller, Manager, Auditor, Admin).
- Manual seller order creation and manual event submission via the Seller Dashboard.
- Simulated external courier webhook ingestion via authenticated endpoints.
- Common event normalization pipeline with idempotency verification.
- Deterministic delay reconstruction engine comparing planned stage baselines against actual timestamps.
- Scenario generation engine comparing at least 3 standard alternatives (e.g., Priority Warehouse Processing, Expedited Linehaul Courier, Combined Intervention).
- Decision recording workflow with optional Operations Manager approval.
- Automated verification against subsequent actual delivery events.
- Customer tracking portal with simplified delay explanations.
- Relational schema in Azure SQL (18 tables) with outbox-driven background processing via Azure Functions.

### Deferred (Post-MVP)
- Live production webhooks with major commercial carriers (FedEx, BlueDart, Delhivery).
- Machine-learning-based dynamic ETA prediction (replaced in MVP by baseline statistical and deterministic calculations).
- Automated physical intervention execution (e.g., direct API courier re-booking).

---

## 4. Ingestion Strategy & System Scale

### 4.1 Dual Ingestion Channels
Causara supports two distinct ingestion pathways that converge on a single normalized representation:
1. **Path A (Manual Ingestion)**: Sellers record events (e.g., *Order Packed*, *Awaiting Courier*, *Dispatched*) directly via the Seller Dashboard.
2. **Path B (External / Automated Ingestion)**: Courier platforms or external Order Management Systems (OMS) deliver status updates via authenticated webhooks. Simulated carrier payloads are provided for demonstration.

Both channels validate the payload, check idempotency, persist the record in `order_events`, and schedule asynchronous timeline reconstruction via `outbox_events`.

### 4.2 Initial System Scale
- **Target Scale**: College demonstration and pilot deployment scale.
- **Data Volume**: Hundreds to low thousands of demonstration orders; ~10,000–50,000 event records.
- **Concurrency**: Modest concurrent users (10–50 active sessions).
- **Deployment Strategy**: A containerized modular monolith deployed to Azure App Service with serverless Azure Functions consuming Azure Storage Queue messages.
