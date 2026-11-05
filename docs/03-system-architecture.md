# 03. System Architecture (HLD & LLD)

## 1. System Context & Boundaries

At the boundary level, Causara acts as an intelligent reasoning and intervention layer situated between e-commerce participants and external logistics providers.

### 1.1 Context Diagram

```mermaid
flowchart TD
    subgraph Actors["Human Actors"]
        Customer["Customer"]
        Seller["Seller"]
        Manager["Operations Manager"]
        Analyst["Analyst"]
        Auditor["Auditor"]
        Admin["Administrator"]
    end

    subgraph Causara["Causara Platform"]
        Core["Causara Intelligence Platform\n(Order Tracking, Delay Engine, Interventions, Verification)"]
    end

    subgraph External["External Systems"]
        Courier["External Courier / Logistics APIs"]
        SellerOMS["Seller Order Management Systems (OMS)"]
        PowerBI["Power BI Analytics & Reporting"]
    end

    Customer -->|Track order & view customer summary| Core
    Seller -->|Create orders, ingest events, analyze delays| Core
    Manager -->|Monitor performance & approve interventions| Core
    Analyst -->|Analyze historical trends & efficacy| Core
    Auditor -->|Inspect audit logs & decision records| Core
    Admin -->|Manage users, roles & configurations| Core

    Courier -->|Deliver status updates & tracking events| Core
    SellerOMS -->|Fulfillment & order metadata| Core
    Core -->|Export reporting views| PowerBI
```

### 1.2 System Boundary Matrix

| Inside Causara Logical Boundary | Outside Causara Logical Boundary |
|---|---|
| User identity, authentication, and RBAC | Courier linehaul and fleet tracking hardware |
| Order lifecycle management and stage definitions | Physical package handling, sorting, or transportation |
| Event ingestion, normalization, and deduplication | Third-party ERP / Inventory databases |
| Delay reconstruction and stage-wise variance calculation | Direct courier driver routing and dispatch |
| Counterfactual scenario simulation and comparison | Commercial external identity providers |
| Decision capture, approval workflows, and audit logging | Power BI reporting visualization canvas |
| Outcome verification against actual delivery events | Physical execution of real-world interventions |

---

## 2. Core System Sequence Workflows

### 2.1 Use Case 1: Customer Tracks a Delayed Order

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant UI as Customer Portal (React)
    participant API as Flask REST API
    participant Engine as Delay Engine
    participant DB as Azure SQL Database

    Customer->>UI: Enter Order Number / View Order
    UI->>API: GET /api/v1/orders/{id}/timeline
    API->>DB: Query order & normalized order_events
    DB-->>API: Return event history
    API->>Engine: Generate customer-friendly delay summary
    Engine-->>API: Plain-language summary & stage progress
    API-->>UI: Return HTTP 200 OK (order_id, status, customer_summary, timeline)
    UI-->>Customer: Display interactive timeline & delay status
```

> **Customer Summary Boundary**: The `customer_summary` is a plain-language explanation generated strictly for the consumer. It omits internal supplier fault attribution, hypothetical root causes, confidential cost figures, and sensitive carrier negotiations.

---

### 2.2 Use Case 2: Seller Investigates Delay & Selects Intervention

```mermaid
sequenceDiagram
    autonumber
    actor Seller
    participant UI as Seller Dashboard (React)
    participant API as Flask REST API
    participant Engine as Intervention Engine
    participant DB as Azure SQL Database
    participant Outbox as outbox_events

    Seller->>UI: Open delayed order investigation
    UI->>API: POST /api/v1/orders/{id}/cases
    API->>DB: Create decision_case & analysis_jobs record
    API->>Outbox: Write outbox_events record (ANALYSIS_JOB_QUEUED)
    DB-->>API: Case ID 9001, Job ID 1201 created
    API-->>UI: Return HTTP 201 Created
    
    Seller->>UI: Request alternative intervention scenarios
    UI->>API: POST /api/v1/cases/9001/scenarios/generate
    API->>Engine: Evaluate candidate points & simulate scenarios
    Engine->>DB: Create scenarios in SQL (status: PENDING_PERSISTENCE)
    Engine->>Engine: Upsert full analytical graph to Cosmos DB
    Engine->>DB: Update SQL scenarios (status: READY)
    API-->>UI: Return generated scenarios (Time Saved, Cost, Risk, Confidence)
    
    Seller->>UI: Select preferred scenario (e.g., Alternative Courier)
    UI->>API: POST /api/v1/cases/9001/decisions
    API->>DB: Execute SQL Transaction (Store decision with composite case-scenario FK, audit log, outbox event)
    DB-->>API: Transaction Committed
    API-->>UI: Return HTTP 201 Created (Decision Pending/Approved)
```

---

### 2.3 Use Case 3: Empirical Decision Verification via Azure Functions

```mermaid
sequenceDiagram
    autonumber
    participant Courier as Courier API / Ingestion
    participant API as Flask REST API
    participant DB as Azure SQL Database
    participant Dispatcher as Timer Azure Function (Outbox Dispatcher)
    participant Queue as Azure Storage Queue
    participant Worker as Queue-Triggered Azure Function (Analysis Worker)

    Courier->>API: POST /api/v1/orders/{id}/events (DELIVERED)
    API->>DB: Insert order_event, insert analysis_jobs (OUTCOME_VERIFICATION), write outbox_events
    DB-->>API: Transaction Committed
    API-->>Courier: Return HTTP 200 OK
    
    Dispatcher->>DB: Poll pending outbox_events (Timer every 10s)
    Dispatcher->>Queue: Push message {job_id: 1405, order_id: 101, job_type: 'OUTCOME_VERIFICATION'}
    Dispatcher->>DB: Update outbox_events to PUBLISHED
    
    Worker->>Queue: Trigger on new queue message
    Worker->>DB: Update analysis_jobs status to RUNNING
    Worker->>DB: Fetch decision, original expected delivery, predicted delivery, and actual delivery
    Worker->>DB: Insert verifications record (Computed columns calculate signed error, absolute error, delivery variance)
    Worker->>DB: Update analysis_jobs status to COMPLETED
```

---

## 3. High-Level Design (HLD)

Causara adopts a **Modular Monolith Architecture** organized across five distinct logical layers.

### 3.1 Five-Tier Layered Architecture

```mermaid
flowchart TD
    subgraph PresentationLayer["1. Presentation Layer (React + TypeScript)"]
        UI_Customer["Customer Tracking Portal"]
        UI_Seller["Seller Investigation Dashboard"]
        UI_Manager["Manager Approval & Ops Portal"]
        UI_Auditor["Auditor & Compliance View"]
    end

    subgraph APILayer["2. API & Access Layer (Flask REST API on Azure App Service)"]
        Router["HTTP Routing & Versioning (/api/v1)"]
        AuthMiddleware["JWT Authentication & RBAC Middleware"]
        InputValidator["Schema & Request Validator"]
    end

    subgraph BusinessLogic["3. Business Logic Layer (Python Services & Domain)"]
        OrderService["Order Management Service"]
        IngestionService["Event Ingestion & Normalizer"]
        DelayEngine["Delay Reconstruction Engine"]
        InterventionEngine["Counterfactual Scenario Engine"]
        DecisionService["Decision & Approval Service"]
        VerificationService["Prediction Verification Engine"]
        AuditService["Audit & Compliance Service"]
    end

    subgraph BackgroundLayer["4. Background Processing Layer (Azure Functions & Storage Queue)"]
        OutboxDispatcher["Timer-Triggered Azure Function\n(Outbox Dispatcher)"]
        StorageQueue["Azure Storage Queue\n('analysis-jobs' & 'verification-jobs')"]
        QueueWorker["Queue-Triggered Azure Function\n(Analysis & Verification Worker)"]
    end

    subgraph DataLayer["5. Data & Storage Layer"]
        AzureSQL["Azure SQL Database\n(Transactional Source of Truth: 18 Tables)"]
        CosmosDB["Azure Cosmos DB\n(Analytical Scenario JSON Documents)"]
        BlobStorage["Azure Blob Storage\n(Private Evidence Files & Attachments)"]
        KeyVault["Azure Key Vault\n(Secret & Connection String Store)"]
    end

    PresentationLayer -->|HTTPS / JSON REST API| APILayer
    APILayer --> BusinessLogic
    BusinessLogic --> AzureSQL
    BusinessLogic --> CosmosDB
    BusinessLogic --> BlobStorage
    OutboxDispatcher -->|Poll PENDING outbox_events| AzureSQL
    OutboxDispatcher -->|Push job_id message| StorageQueue
    StorageQueue -->|QueueTrigger| QueueWorker
    QueueWorker --> BusinessLogic
    QueueWorker --> AzureSQL
    QueueWorker --> CosmosDB
    KeyVault -.->|Secret Injection| APILayer
    KeyVault -.->|Secret Injection| OutboxDispatcher
    KeyVault -.->|Secret Injection| QueueWorker
```

---

## 4. Low-Level Design (LLD)

### 4.1 Backend Module Hierarchy

```
causara/
│
├── app/                            # Core Monolith Application (API & Domain)
│   ├── __init__.py                 # Application factory & extension setup
│   │
│   ├── controllers/                # HTTP route definitions & request mapping
│   │   ├── auth_controller.py
│   │   ├── order_controller.py
│   │   ├── event_controller.py
│   │   ├── analysis_controller.py
│   │   ├── decision_controller.py
│   │   ├── verification_controller.py
│   │   └── evidence_controller.py
│   │
│   ├── services/                   # Application orchestration & transactions
│   │   ├── auth_service.py
│   │   ├── order_service.py
│   │   ├── event_service.py
│   │   ├── delay_service.py
│   │   ├── intervention_service.py
│   │   ├── decision_service.py
│   │   └── verification_service.py
│   │
│   ├── domain/                     # Pure business logic & algorithms
│   │   ├── models/                 # Pure domain entities (Order, Event, Scenario)
│   │   ├── algorithms/             # Delay reconstruction & counterfactual simulators
│   │   └── validators/             # Business rule validators
│   │
│   ├── repositories/               # SQL abstraction & data access objects
│   │   ├── user_repository.py
│   │   ├── order_repository.py
│   │   ├── event_repository.py
│   │   ├── case_repository.py
│   │   ├── decision_repository.py
│   │   ├── job_repository.py
│   │   └── audit_repository.py
│   │
│   ├── integrations/               # Cloud & external client adapters
│   │   ├── azure_sql/              # DB connection pooling & raw query helpers
│   │   ├── cosmos_db/              # Scenario document client
│   │   ├── blob_storage/           # SAS token generation & upload helpers
│   │   └── storage_queue/          # Queue publisher & consumer
│   │
│   └── security/                   # Crypto, hashing, and JWT tokens
│       ├── tokens.py
│       ├── password.py
│       └── rbac.py
│
├── functions/                      # Azure Functions App (Background Processing)
│   ├── host.json                   # Azure Functions runtime configuration
│   ├── local.settings.json         # Local development settings (Azurite)
│   ├── outbox_dispatcher/          # Timer-triggered function (polls SQL outbox -> Storage Queue)
│   │   ├── __init__.py
│   │   └── function.json
│   └── queue_processor/            # Queue-triggered function (consumes Storage Queue -> executes jobs)
│       ├── __init__.py
│       └── function.json
│
├── tests/                          # Pytest suite (unit, integration, contracts)
├── migrations/                     # Version-controlled SQL DDL scripts
├── requirements.txt
└── run.py
```

---

### 4.2 Normalized Event Data Structure

Disparate event inputs are normalized into the following internal structure:

```json
{
  "order_id": 101,
  "stage_code": "TRANSPORT",
  "event_type": "HUB_DEPARTURE",
  "occurred_at": "2026-11-04T10:30:00Z",
  "received_at": "2026-11-04T10:35:12Z",
  "source_type": "COURIER_API",
  "source_provider": "BlueDart",
  "source_event_id": "BD-882910-E2",
  "idempotency_key": "bluedart-101-BD-882910-E2",
  "location": "Regional Hub Bengaluru",
  "description": "Departed facility on truck 41B",
  "raw_payload": "{\"scanner_id\": \"S12\", \"bat_level\": 98}"
}
```

---

### 4.3 Deterministic Delay Reconstruction Algorithm

The delay reconstruction algorithm calculates stage durations and variances from the sorted, immutable event stream:

```python
from datetime import datetime
from typing import List, Dict, Any

def reconstruct_order_delay(
    order_events: List[Dict[str, Any]], 
    planned_stages: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Reconstructs stage-wise actual durations and isolates variance against planned baselines.
    Preserves both positive variance (delay/lost time) and negative variance (time recovered).
    """
    # 1. Sort strictly by physical occurrence time, resolving ties by ingestion order
    sorted_events = sorted(
        order_events, 
        key=lambda e: (e["occurred_at"], e["received_at"])
    )
    
    stage_breakdown = []
    
    for stage in planned_stages:
        stage_code = stage["stage_code"]
        planned_minutes = stage["planned_duration_minutes"]
        
        # Identify bounding events for this stage
        stage_events = [e for e in sorted_events if e.get("stage_code") == stage_code]
        
        if not stage_events:
            actual_minutes = 0
            status = "PENDING"
        else:
            start_time = stage_events[0]["occurred_at"]
            end_time = stage_events[-1]["occurred_at"]
            actual_minutes = max(0, int((end_time - start_time).total_seconds() / 60))
            status = "COMPLETED"
        
        variance_minutes = actual_minutes - planned_minutes
        
        stage_breakdown.append({
            "stage_code": stage_code,
            "status": status,
            "planned_duration_minutes": planned_minutes,
            "actual_duration_minutes": actual_minutes,
            "variance_minutes": variance_minutes,
            "time_lost_minutes": max(0, variance_minutes),
            "time_recovered_minutes": max(0, -variance_minutes)
        })
        
    return stage_breakdown
```

---

### 4.4 Counterfactual Intervention & Verification Formulas

To maintain strict scientific and epistemological integrity, Causara explicitly partitions distinct delivery reference timestamps:

| Reference Timestamp | Symbol | Definition |
|---|---|---|
| **Original Expected Delivery** | $T_{expected}$ | Initial delivery contract promise recorded at order placement (`orders.expected_delivery_at`). |
| **Baseline Estimated Delivery** | $T_{baseline}$ | Model projection of delivery timestamp assuming **no intervention** is taken. |
| **Predicted Delivery** | $T_{predicted}$ | Model projection of delivery timestamp **after applying** the selected intervention. |
| **Actual Observed Delivery** | $T_{actual}$ | Observed delivery timestamp recorded upon package arrival (`orders.actual_delivery_at`). |

#### 1. Estimated Counterfactual Recovery
$$\Delta_{recovery} = T_{baseline} - T_{predicted}$$
*The estimated time saving anticipated by applying the intervention compared to the delayed baseline.*

#### 2. Forecast Accuracy (Prediction Errors)
- **Signed Prediction Error**:
  $$E_{signed} = T_{actual} - T_{predicted}$$
  *A positive value signifies the package arrived later than the forecast; a negative value signifies it arrived earlier.*
- **Absolute Prediction Error**:
  $$E_{abs} = |T_{actual} - T_{predicted}|$$

#### 3. Net Customer Delivery Variance
$$V_{delivery} = T_{actual} - T_{expected}$$
*The true elapsed delivery difference experienced by the customer relative to the original promise.*

> [!IMPORTANT] **Causal Rigor & Limitations**
> The difference between the un-intervened baseline estimate and the actual delivery ($T_{baseline} - T_{actual}$) represents an **estimated counterfactual recovery**, not an experimentally proven causal effect. Without a randomized control trial or identical twin delivery baseline, the system logs forecast accuracy ($E_{signed}, E_{abs}$) and empirical variance ($V_{delivery}$), explicitly separating model verification from causal claims.

---

### 4.5 Domain Class Diagram

```mermaid
classDiagram
    class Order {
        +int order_id
        +int seller_id
        +int customer_user_id
        +string external_order_ref
        +datetime placed_at
        +datetime expected_delivery_at
        +datetime actual_delivery_at
        +string status
    }

    class OrderStage {
        +int stage_id
        +int order_id
        +string stage_code
        +int sequence_no
        +datetime planned_start_at
        +datetime planned_end_at
        +datetime actual_start_at
        +datetime actual_end_at
    }

    class OrderEvent {
        +int event_id
        +int order_id
        +int stage_id
        +string event_type
        +datetime occurred_at
        +datetime received_at
        +string source_type
        +string idempotency_key
    }

    class Evidence {
        +int evidence_id
        +int order_id
        +int event_id
        +int case_id
        +string blob_uri
        +string sha256_hash
        +string status
        +datetime upload_expires_at
        +datetime completed_at
    }

    class DecisionCase {
        +int case_id
        +int order_id
        +string case_title
        +string status
        +datetime opened_at
    }

    class DelayEdge {
        +int edge_id
        +int case_id
        +int from_stage_id
        +int to_stage_id
        +string edge_type
        +string evidence_class
        +int estimated_delay_minutes
    }

    class Scenario {
        +int scenario_id
        +int case_id
        +string scenario_name
        +string status
        +int predicted_time_saved_minutes
        +decimal estimated_cost
        +string risk_level
        +decimal confidence_score
        +string cosmos_document_id
    }

    class Decision {
        +int decision_id
        +int case_id
        +int scenario_id
        +int decided_by
        +int approved_by
        +string decision_status
        +datetime selected_at
    }

    class Verification {
        +int verification_id
        +int decision_id
        +datetime original_expected_delivery_at
        +datetime baseline_estimated_delivery_at
        +datetime predicted_delivery_at
        +datetime actual_delivery_at
        +int signed_prediction_error_minutes
        +int absolute_prediction_error_minutes
        +int delivery_variance_minutes
    }

    class AnalysisJob {
        +int job_id
        +int order_id
        +int case_id
        +int decision_id
        +string job_type
        +string status
        +string idempotency_key
        +int retry_count
    }

    Order "1" --> "*" OrderStage : contains
    Order "1" --> "*" OrderEvent : records
    Order "1" --> "*" Evidence : supports
    Order "1" --> "*" DecisionCase : investigated_by
    Order "1" --> "*" AnalysisJob : tracks
    DecisionCase "1" --> "*" Evidence : references
    DecisionCase "1" --> "*" DelayEdge : generates
    DecisionCase "1" --> "*" Scenario : explores
    DecisionCase "1" --> "*" Decision : captures
    DecisionCase "1" --> "*" AnalysisJob : contextualizes
    Scenario "1" --> "*" Decision : selected_in
    Decision "1" --> "0..1" Verification : evaluated_by
    Decision "1" --> "*" AnalysisJob : verifies
```
