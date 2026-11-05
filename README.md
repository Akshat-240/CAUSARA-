# Causara

> **Explainable E-Commerce Order Delay Intelligence and Intervention Analysis Platform**

Causara is a specialized intelligence platform designed to reconstruct e-commerce order timelines, isolate stages contributing to delivery delays, evaluate and compare counterfactual interventions, generate transparent explanations, and rigorously verify predicted outcomes against observed delivery events.

---

## 1. Project Overview

In conventional e-commerce logistics, delivery delays are frequently treated as opaque, single-metric failures ("package is late"). Sellers and operations teams lack visibility into the root cause of delays, while customers receive vague status updates.

Causara solves this problem by:
1. **Reconstructing Order Timelines**: Ingesting events across stages (order placed, seller processing, courier transit, last-mile delivery) and building an immutable chronological history.
2. **Quantifying Delays & Variances**: Identifying positive and negative duration variances across sequential lifecycle stages.
3. **Evaluating Interventions**: Generating and comparing counterfactual alternatives (e.g., priority handling, courier rerouting) based on time saved, cost, risk, and confidence.
4. **Recording Traceable Decisions**: Providing an auditable workflow for seller decisions and manager approvals with composite integrity.
5. **Verifying Predictions**: Benchmarking forecasts against observed delivery timestamps to derive mathematical prediction errors ($E_{signed}, E_{abs}$) without causal inflation.

---

## 2. Core Architectural Principles

- **Modular Monolith**: One deployable backend organized into independent, domain-driven modules with serverless background compute via Azure Functions.
- **Transactional Source of Truth**: Azure SQL Database serves as the authoritative source for relational entities, stage definitions, event logs, decisions, and audit records (18-table 3NF schema).
- **Document & Blob Complementarity**: Azure Cosmos DB stores flexible, semi-structured scenario JSON models; Azure Blob Storage stores unstructured evidence attachments (screenshots, receipts, delivery slips) accessed via short-lived SAS tokens.
- **Asynchronous Reliability**: Asynchronous delay and scenario calculations decouple HTTP request handling from compute-intensive operations using the **Transactional Outbox Pattern** and **Azure Storage Queues**.
- **Rigorous Domain Distinctions**:
  - **Facts**: Directly observed, immutable events and durations.
  - **Hypotheses**: Inferred bottleneck causes (e.g., inventory delay vs. carrier congestion).
  - **Estimates**: Model-predicted savings and costs with explicit assumptions and confidence scores.

---

## 3. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, CSS Modules / Modern Styling |
| **Backend API** | Python 3.14, Flask REST API, Marshmallow / Pydantic, Gunicorn |
| **Database & Storage** | Azure SQL Database (18 tables in 3NF), Azure Cosmos DB, Azure Blob Storage |
| **Messaging & Background** | Azure Storage Queue, Azure Functions (Flex Consumption, Python 3.14) |
| **Cloud & Security** | Azure App Service (Linux), Azure Static Web Apps, Azure Key Vault, Azure Monitor |
| **Testing & CI/CD** | Pytest, Vitest, React Testing Library, Flake8, Docker, GitHub Actions |

---

## 4. Documentation Index

The design and implementation documentation is organized under the [`docs/`](file:///c:/Users/aksha/Desktop/ESPV1/docs) directory:

- [**01. Project Overview**](file:///c:/Users/aksha/Desktop/ESPV1/docs/01-project-overview.md): High-level system purpose, problem statement, key differentiators, and system roles.
- [**02. Requirements Analysis**](file:///c:/Users/aksha/Desktop/ESPV1/docs/02-requirements.md): Functional (FR-01 to FR-18) and non-functional requirements, MVP scope, and ingestion strategy.
- [**03. System Architecture**](file:///c:/Users/aksha/Desktop/ESPV1/docs/03-system-architecture.md): System context, High-Level Design (HLD), Low-Level Design (LLD), algorithms, and class models.
- [**04. Database Design**](file:///c:/Users/aksha/Desktop/ESPV1/docs/04-database-design.md): 18-table 3NF relational schema, ER diagrams, indexes, stored procedures, and Azure data mappings.
- [**05. API Specification**](file:///c:/Users/aksha/Desktop/ESPV1/docs/05-api-specification.md): REST v1 contracts, payload envelopes, idempotency, direct-to-blob upload flows, and RBAC matrix.
- [**06. Security & Scalability**](file:///c:/Users/aksha/Desktop/ESPV1/docs/06-security-design.md): Defense-in-depth, JWT authentication, RBAC, input validation, secret management, and rate limiting.
- [**07. Deployment Design**](file:///c:/Users/aksha/Desktop/ESPV1/docs/07-deployment-design.md): Cloud topology on Azure, CI/CD pipeline with GitHub Actions, containerization, and monitoring.

---

## 5. Project Structure

```text
ESPV1/
├── .venv/                   # Python virtual environment (Python 3.14)
├── .vscode/                 # IDE workspace configuration
│   └── settings.json
├── app/                     # Flask REST API backend package
│   ├── __init__.py          # Application factory (create_app)
│   ├── config.py            # Centralized environment-aware configuration
│   ├── database/            # Database access layer & connection management
│   │   ├── __init__.py
│   │   └── connection.py    # Connection pooling, context managers, transaction handling
│   └── api/                 # API blueprints and endpoints
│       ├── __init__.py      # API v1 blueprint registration
│       ├── errors.py        # Centralized JSON error envelopes
│       └── health.py        # Health probe endpoint (/api/v1/health)
├── database/                # Database migrations and seed scripts
│   ├── migrations/          # Version-controlled forward and rollback migrations
│   │   ├── V001__initial_schema.sql
│   │   ├── U001__initial_schema_down.sql
│   │   ├── V002__triggers_views_procedures.sql
│   │   ├── U002__triggers_views_procedures_down.sql
│   │   ├── V003__update_seller_delay_summary_view.sql
│   │   └── U003__update_seller_delay_summary_view_down.sql
│   ├── seeds/               # Idempotent catalog seed scripts
│   │   └── 001_seed_roles_interventions.sql
│   └── migration_runner.py  # Python migration CLI (migrate, rollback, status, seed)
├── docs/                    # Approved architectural documentation (1-7)
├── frontend/                # React + TypeScript + Vite SPA
│   ├── src/                 # Application source code
│   │   ├── services/        # Backend API integration services
│   │   ├── types/           # API response & domain TypeScript interfaces
│   │   ├── test/            # Vitest setup & mocks
│   │   ├── App.tsx          # Application shell component
│   │   ├── App.test.tsx     # Shell component unit tests
│   │   └── main.tsx         # React DOM mount point
│   ├── index.html           # HTML5 template
│   ├── package.json         # Frontend dependencies & scripts
│   ├── tsconfig.json        # TypeScript configuration
│   └── vite.config.ts       # Vite bundler & test configuration
├── tests/                   # Backend automated test suite (Pytest)
│   ├── conftest.py          # Shared fixtures (app, client, runner)
│   ├── test_errors.py       # Error envelope & status code tests
│   ├── test_factory.py      # Factory & environment configuration tests
│   └── test_health.py       # Health check endpoint tests
├── .env.example             # Environment variable template
├── .gitignore               # Comprehensive Git ignore rules
├── AGENTS.md                # Persistent workspace agent instructions & rules
├── pytest.ini               # Pytest configuration
├── requirements.txt         # Runtime backend dependencies
├── requirements-dev.txt     # Development & testing dependencies
├── run.py                   # WSGI application entrypoint
└── README.md                # Project documentation & engineering handbook
```

---

## 6. Prerequisites

- **Python**: Version 3.14.x (Active environment: Python 3.14.2 64-bit)
- **Node.js**: Version 20.x or 24.x LTS (Active: v24.11.1)
- **npm**: Version 10.x or 11.x (Active: 11.11.0)
- **Windows PowerShell**: PowerShell 5.1 or PowerShell 7+

---

## 7. Local Development Setup

### 7.1 Backend Setup

1. **Activate the virtual environment**:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```

2. **Install dependencies**:
   ```powershell
   pip install -r requirements-dev.txt
   ```

3. **Configure environment variables**:
   ```powershell
   Copy-Item .env.example .env
   ```

### 7.2 Frontend Setup

1. **Navigate to the frontend directory**:
   ```powershell
   cd frontend
   ```

2. **Install frontend dependencies**:
   ```powershell
   npm install
   ```

### 7.3 Database Setup & Migrations

Causara supports **Microsoft Azure SQL Database** (production) and **Microsoft SQL Server 2019+ / LocalDB** (local development).

1. **Start LocalDB instance and ensure database exists (if using local SQL Server)**:
   ```powershell
   sqllocaldb create CausaraDB
   sqllocaldb start CausaraDB
   sqlcmd -S "(localdb)\CausaraDB" -Q "IF DB_ID('CausaraDB') IS NULL CREATE DATABASE CausaraDB;"
   ```

2. **Check migration status**:
   ```powershell
   .\.venv\Scripts\python.exe -m database.migration_runner status
   ```

3. **Apply forward migrations**:
   ```powershell
   .\.venv\Scripts\python.exe -m database.migration_runner migrate
   ```

4. **Populate catalog seed data**:
   ```powershell
   .\.venv\Scripts\python.exe -m database.migration_runner seed
   ```

5. **Roll back the latest migration (if needed)**:
   ```powershell
   .\.venv\Scripts\python.exe -m database.migration_runner rollback
   ```

---

## 8. Running the Application Locally

### 8.1 Start the Backend REST API

From the project root:
```powershell
.\.venv\Scripts\python.exe run.py
```
The Flask API will start on `http://localhost:5000`.
- Health check: [`http://localhost:5000/api/v1/health`](http://localhost:5000/api/v1/health)
- Service root: [`http://localhost:5000/`](http://localhost:5000/)

### 8.2 Start the React Frontend

From the `frontend/` directory:
```powershell
cd frontend
npm run dev
```
The React development server will start on `http://localhost:5173` with automatic API proxying to `http://localhost:5000`.

---

## 9. Running Automated Tests

### 9.1 Backend Test Suite (Pytest)

```powershell
.\.venv\Scripts\pytest.exe
```

Run PEP 8 linter:
```powershell
.\.venv\Scripts\flake8.exe app tests --max-line-length=120
```

### 9.2 Frontend Test Suite (Vitest)

```powershell
cd frontend
npm run test
```

### 9.3 Frontend Production Build Verification

```powershell
cd frontend
npm run build
```
Generates production-optimized static assets into `frontend/dist/`.

---

## 10. Database Engine & Azure SQL Configuration

### 10.1 Supported Database Engines
- **Target Cloud Database**: **Microsoft Azure SQL Database** (General Purpose / Serverless).
- **Local Development**: **Microsoft SQL Server Express LocalDB** or containerized SQL Server 2019/2022.
- **Excluded Engines**: **SQLite is strictly prohibited** because it does not support composite foreign keys, `PERSISTED` computed columns, schema-level triggers, or T-SQL stored procedures.

### 10.2 Configuration Parameters
Set the connection parameters in `.env`:
- `AZURE_SQL_CONNECTION_STRING`: Full ADO.NET / ODBC connection string with encryption.
- Alternatively, component variables: `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_DRIVER`, `DB_TRUSTED_CONNECTION`.

### 10.3 Known Limitations & Domain Boundary Rules
- **Cross-Order Referential Integrity**: Enforced through composite keys on child tables (`order_events`, `evidence`, `analysis_jobs`) and multi-row triggers on `delay_edges`.
- **Parent Immutability**: Order ownership (`order_id`) on `order_stages` and `decision_cases` is permanently immutable; updates to parent `order_id` are rejected with errors `50012` and `50013`.
- **Frontend Isolation**: The React frontend never connects directly to SQL Server; all database access is gated by the Flask REST API.
