# 01. Project Overview

## 1. Executive Summary

**Project Name:** Causara  
**Domain:** E-Commerce Logistics, Supply Chain Intelligence, Delay Diagnosis & Counterfactual Intervention Analysis  
**Project Scope:** Solo Engineering Project (Design, Database Architecture, Backend & Frontend Implementation, Cloud Deployment)

Causara is an explainable order delay intelligence and intervention analysis platform. Instead of treating e-commerce delays as static delivery misses, Causara chronologically reconstructs the end-to-end order journey across multiple operational stages (e.g., seller fulfillment, warehouse handoff, hub transit, and last-mile delivery). It isolates the exact stages where positive or negative variance occurred, generates and scores alternative counterfactual interventions, records human-in-the-loop decisions, and verifies projected outcomes against observed delivery outcomes.

---

## 2. Problem Statement

Current e-commerce platforms and delivery tracking solutions exhibit critical limitations:
- **Opaque Timeline Aggregation**: When an order is overdue, sellers and consumers typically see a generic status message (e.g., *"Delayed in transit"*), obscuring whether the delay arose during order packaging, courier handover, linehaul transportation, or local delivery hub operations.
- **Conflation of Correlation and Causation**: Conventional analytics frequently attribute delays to whichever party handled the package last, disregarding compounding upstream bottlenecks.
- **Unverified Interventions**: When sellers take action (such as dispatching a replacement package or upgrading shipping), there is no structured mechanism to track whether the intervention actually produced the anticipated time savings.
- **Absence of Auditability**: Operational decisions to expedite or re-route orders lack structured rationales and version-controlled accountability.

---

## 3. Core Philosophy & Causara Domain Rules

Causara enforces strict domain distinctions that guide both software architecture and user interfaces:

### 3.1 Facts vs. Hypotheses vs. Estimates
- **Observed Facts**: Immutable, timestamped events recorded by systems or operators (e.g., *“Order packaged at 14:02 UTC; handoff occurred at 18:30 UTC”*).
- **Hypotheses**: Structural delay causes inferred from the event sequence (e.g., *“Seller processing stage exceeded planned baseline by 18 hours due to inventory constraint”*).
- **Estimates**: Counterfactual models predicting the potential impact of an intervention (e.g., *“Switching to Express Courier at Hub 2 is estimated to save 24 hours at an additional cost of ₹150 with 0.72 confidence”*). All estimates must state underlying assumptions explicitly.

### 3.2 Key Operating Rules
1. **Never Present Correlation as Proven Causation**: Stage variances indicate where elapsed time deviated from baseline; they do not automatically prove causality without experimental controls.
2. **Dual-Timestamp Integrity**: Ingestion distinguishes between `occurred_at` (when the event took place in the physical world) and `received_at` (when Causara ingested the event record).
3. **Idempotency & Resilience**: Event processing is idempotent to prevent duplicate messages or out-of-order webhook delivery from corrupting timelines.
4. **Separation of Predictions from Reality**: Predicted intervention benefits are stored permanently alongside actual verification results when future delivery events arrive.
5. **No Fabricated Verification**: When actual observation data is missing or incomplete, verification records reflect the gap rather than synthesizing accuracy.

---

## 4. System Actors & Roles

Causara defines six distinct user roles within its Role-Based Access Control (RBAC) model:

| Actor | Primary Responsibility | Key Interactions |
|---|---|---|
| **Customer** | Track orders and understand delivery timelines | View simplified, jargon-free delay explanations and chronological order progress. |
| **Seller** | Investigate delayed orders and execute interventions | View seller-specific orders, inspect stage variances, compare counterfactual scenarios, and record intervention decisions. |
| **Operations Manager** | Monitor system-wide performance and govern interventions | Review delay trends across sellers, audit high-cost intervention proposals, and approve pending seller decisions. |
| **Analyst** | Study historical patterns and intervention efficacy | Evaluate historical intervention effectiveness, study stage bottlenecks, and inspect aggregate delay chains. |
| **Auditor** | Inspect compliance, decision rationales, and event logs | View immutable audit logs, verify decision trails, and inspect evidence attachments with SHA-256 integrity verification. |
| **Administrator** | Manage platform configuration, roles, and integrations | Manage user accounts, assign roles, configure webhook endpoints, and inspect system health. |

---

## 5. Technology Stack Summary

- **Frontend**: Functional React with strict TypeScript, modular components, and responsive dashboards.
- **Backend API**: Python 3.14 with Flask REST API, structured into controllers, application services, domain logic, and repositories on Azure App Service (Linux container).
- **Relational Storage**: Azure SQL Database as the primary transactional source of truth (18-table 3NF schema).
- **Document Storage**: Azure Cosmos DB for flexible scenario documents and rich analytical payloads.
- **Blob Storage**: Azure Blob Storage for secure, direct-to-storage evidence attachments (photos, receipts, manifests).
- **Asynchronous Processing**: Transactional Outbox Pattern combined with Azure Storage Queues and serverless Azure Functions (Python 3.14 on Flex Consumption Plan).
- **Cloud & DevOps**: Azure App Service, Azure Functions Flex Consumption, Azure Key Vault, Docker, GitHub Actions, and Pytest.
