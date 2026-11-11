# Causara — Deferred Work Checklist

**Document Version:** 1.0.0  
**Target Delivery Date:** Post-MVP Submission (Production Hardening)  
**Tracking Scope:** Architecture, Security, Cloud, Integrations, and Product Capabilities  

---

## 1. Security & Authentication

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **User Authentication** | P1 | Hardcoded test actor IDs passed in payload / query params. Passwords hashed in seed scripts. | JWT bearer authentication with RS256 signing and refresh token rotation. |
| **Role-Based Access Control (RBAC)** | P1 | Server checks actor presence; no role hierarchy enforcement in API routes. | Middleware checking user roles (`CUSTOMER`, `SELLER`, `ANALYST`, `MANAGER`, `ADMIN`) on all endpoints. |
| **Production Secret Management** | P1 | Local environment variables (`.env`). | Azure Key Vault integration with Managed Identity. |
| **Per-Client Rate Limiting** | P2 | No rate limits on endpoints. | Redis-backed token bucket rate limiting (100 req/min per API client). |
| **Evidence Antivirus Scanning** | P2 | MIME type and extension validation with 10MB limit. | Azure Defender for Storage scanning uploaded blobs asynchronously. |

---

## 2. Cloud & Infrastructure

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **Cloud Hosting** | P1 | Local Flask dev server (`localhost:5000`). | Azure App Service (Linux B1/P1v3) with auto-scaling. |
| **Background Processing** | P1 | Synchronous execution + local outbox worker triggers (`POST /internal/outbox/process-batch`). | Azure Functions triggered by Azure Storage Queue / Service Bus. |
| **Blob Storage** | P1 | `LocalStorageProvider` persisting files to `storage/evidence/`. | Azure Blob Storage using `azure-storage-blob` SDK with short-lived SAS URIs. |
| **Cosmos DB Persistence** | P2 | Simulation document IDs generated (`sim-*`) and metadata tracked in Azure SQL `dbo.scenarios`. | Real-time scenario JSON document persistence into Azure Cosmos DB NoSQL container. |
| **Database Geo-Replication** | P3 | SQL Server LocalDB (`(localdb)\CausaraDB`). | Azure SQL Database Business Critical tier with active geo-replication. |

---

## 3. Platform & Carrier Integrations

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **Carrier Ingestion Webhooks** | P1 | Standardized `POST /api/v1/events` endpoint accepting normalized event payloads. | Dedicated carrier webhook adapters (FedEx, UPS, DHL, BlueDart) with HMAC signature verification. |
| **E-Commerce Webhooks** | P2 | Ingested via API `POST /orders`. | Shopify, WooCommerce, and Amazon SP-API direct order sync connectors. |
| **Customer Notification Gateways** | P2 | Documented in decision scenarios as communication interventions (`CUSTOMER_PROACTIVE_NOTICE`). | Twilio SMS and SendGrid email transactional notification dispatchers. |

---

## 4. Advanced Intelligence & Analytics

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **Machine Learning Delay Predictions** | P2 | Deterministic rule-based variance calculation and historical baseline comparison. | Trained Gradient Boosted Tree / XGBoost models predicting delay probabilities across seasonal transit corridors. |
| **Carrier Bottleneck Clustering** | P2 | SQL view `dbo.vw_seller_delay_summary` tracking aggregate seller delays. | Automated k-means clustering detecting systemic carrier hub congestion. |
| **Real-time Anomaly Detection** | P3 | Rule-based timestamp and out-of-order sequence anomaly flagging. | Streaming anomaly detection on order events stream using Azure Stream Analytics. |

---

## 5. Reliability & Observability

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **Distributed Tracing** | P1 | Python standard `logging` with structured output. | OpenTelemetry instrumentation with Azure Application Insights telemetry. |
| **Dead-Letter Replay Worker** | P2 | `FAILED` outbox messages recorded with `error_message` and `next_retry_at`. | Automated administrative dashboard and replay worker for poisoned messages. |
| **Health Monitoring Probes** | Accepted | `GET /api/v1/health` verifying database connectivity. | Liveness and readiness endpoints with memory, connection pool, and queue depth checks. |

---

## 6. Frontend & User Experience

| Item | Priority | Current State (Submission MVP) | Production Target |
| :--- | :--- | :--- | :--- |
| **Interactive Logistics Dashboard** | Accepted | Full 9-tab React 18 + TypeScript SPA with dark navy sidebar, enterprise styling, and live `/api/v1` integration. | Production CDN deployment on Azure Static Web Apps. |
| **Epistemological Taxonomy Separation** | Accepted | 4-quadrant display (Facts, Variances, Hypotheses, Estimates) preventing duration variance from being represented as proven causal blame. | Customizable user-defined epistemology filters and rule sets. |
| **Delay Propagation Graph Display** | Accepted | Structured tabular and node representation with edge types (`STAGE_TRANSITION`, `BOTTLENECK_PROPAGATION`), confidence scores, and epistemology badges. | Interactive canvas drag-and-drop diagramming using React Flow or Cytoscape. |
| **Interactive Scenario Simulator** | Accepted | Side-by-side multi-scenario comparison table, auto-generation, custom simulation modal, time savings, cost, and risk metrics. | Dynamic real-time sliders adjusting budget ceilings with instant counterfactual recomputation. |
| **Evidence Repository & Integrity Inspector** | Accepted | File upload with MIME and 10MB validation, SHA-256 cryptographic digest inspection modal. | In-browser inline PDF rendering and bounding-box OCR text highlighting. |
| **Governance Approval Workflow** | Accepted | Role-based decision recording, Operations Manager approval/rejection actions, and audit trail. | Multi-signature approval workflows with dual-custody authorization. |
| **Outcome Verification Engine** | Accepted | Closed-loop actual delivery timestamp logging, signed prediction error, and SLA variance analysis. | Automated webhook delivery event confirmation with GPS-tagged courier proof. |
