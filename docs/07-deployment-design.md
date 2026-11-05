# 07. Deployment Design & DevOps

## 1. Cloud Deployment Architecture

Causara is architected for native deployment on **Microsoft Azure**, combining managed platform services with serverless background compute:

```mermaid
flowchart TD
    subgraph Clients["Clients"]
        Browser["Customer / Seller Browser"]
        CourierWebhook["External Courier Webhook"]
    end

    subgraph AzureFrontend["Frontend Hosting"]
        StaticWebApp["Azure Static Web Apps\n(React + TypeScript SPA)"]
    end

    subgraph AzureCompute["Backend & Background Compute (Azure PaaS & Serverless)"]
        AppService["Azure App Service (Linux)\nFlask REST API (Gunicorn / Docker)"]
        
        subgraph FunctionApp["Azure Functions (Python 3.14 Flex Consumption)"]
            OutboxFunc["Timer-Triggered Function\n'outbox-dispatcher' (every 10s)"]
            WorkerFunc["Queue-Triggered Function\n'queue-processor' (on message)"]
        end
    end

    subgraph AzureQueues["Messaging & Orchestration"]
        StorageQueue["Azure Storage Queue\n('analysis-jobs' & 'verification-jobs')"]
    end

    subgraph AzureData["Azure Data Services"]
        AzureSQL["Azure SQL Database\n(Transactional 18 Tables)"]
        CosmosDB["Azure Cosmos DB\n(Scenario JSON Documents)"]
        BlobStorage["Azure Blob Storage\n('evidence-files' Container)"]
    end

    subgraph AzureGovernance["Security & Observability"]
        KeyVault["Azure Key Vault\n(Managed Secrets & Keys)"]
        AppInsights["Azure Application Insights\n(Telemetry, Tracing & Metrics)"]
    end

    Browser -->|HTTPS / CDN| StaticWebApp
    Browser -->|REST API Calls| AppService
    CourierWebhook -->|POST Webhooks| AppService

    AppService -->|Read / Write SQL| AzureSQL
    AppService -->|Generate SAS URLs| BlobStorage
    AppService -->|Insert Outbox & Job Records| AzureSQL

    OutboxFunc -->|1. Poll PENDING outbox_events| AzureSQL
    OutboxFunc -->|2. Push {job_id, order_id} message| StorageQueue
    OutboxFunc -->|3. Update outbox_events to PUBLISHED| AzureSQL

    StorageQueue -->|QueueTrigger| WorkerFunc
    WorkerFunc -->|Update analysis_jobs to RUNNING| AzureSQL
    WorkerFunc -->|Reconstruct timeline / scenarios| AzureSQL
    WorkerFunc -->|Idempotent Scenario JSON Upsert| CosmosDB
    WorkerFunc -->|Update analysis_jobs to COMPLETED| AzureSQL

    KeyVault -.->|Managed Identity Secret Injection| AppService
    KeyVault -.->|Managed Identity Secret Injection| FunctionApp
    AppService -.->|Telemetry & Logs| AppInsights
    FunctionApp -.->|Function Execution Traces| AppInsights
```

---

## 2. Infrastructure Component Allocation

| Azure Resource | Service SKU / Tier | Purpose in Causara |
|---|---|---|
| **Frontend Web App** | Azure Static Web Apps (Free / Standard) | Globally distributed hosting of compiled React SPA assets with automated GitHub Actions deployment. |
| **Backend REST API** | Azure App Service (B1 / P1v2 Linux) | Hosts containerized Flask REST API powered by Gunicorn WSGI. |
| **Background Processing** | Azure Functions (Flex Consumption Plan, Python 3.14) | Serverless execution on Linux runtime v4 (`FUNCTIONS_WORKER_RUNTIME=python`, `host.json` configuration schema `"version": "2.0"`). Note: Flex Consumption natively executes runtime v4 and does not support or require the legacy `FUNCTIONS_EXTENSION_VERSION` app setting. (1) `outbox-dispatcher` (TimerTrigger polling SQL outbox), (2) `queue-processor` (QueueTrigger executing delay reconstruction, scenario generation, and verification). |
| **Relational Database** | Azure SQL Database (Serverless / General Purpose) | Relational source of truth for 18 tables, stored procedures, views, and ACID transactions. |
| **Document Database** | Azure Cosmos DB (Serverless) | Document store for rich scenario alternatives, model graphs, and unstructured analytic payloads. |
| **Object Storage** | Azure Blob Storage (Standard Hot / Cool) | Secure, private storage for photographic evidence, delivery slips, and raw payloads. |
| **Message Broker** | Azure Storage Queue | Durable message queue for asynchronous job decoupling and outbox polling. |
| **Secrets Management** | Azure Key Vault | Stores database connection strings, JWT signing keys, and external courier credentials. |
| **Monitoring & Telemetry**| Azure Application Insights & Log Analytics | Distributed transaction tracing, API latency tracking, and error alert aggregation. |

---

## 3. Packaging & Serverless Structure

### 3.1 Backend Dockerfile (`Dockerfile.api`)
A multi-stage, non-root Docker build designed for minimal image surface and rapid startup on Azure App Service:

```dockerfile
# Stage 1: Build & Dependency Resolution
FROM python:3.14-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Final Minimal Runtime
FROM python:3.14-slim
WORKDIR /app

# Create non-root system user
RUN groupadd -r causara && useradd -r -g causara -s /bin/false causara

COPY --from=builder /root/.local /home/causara/.local
COPY app/ ./app/
COPY run.py .

ENV PATH=/home/causara/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PORT=5000

USER causara

EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "3", "--threads", "2", "--timeout", "60", "run:app"]
```

### 3.2 Azure Functions App Structure (`functions/`)
Serverless Python functions managing the outbox lifecycle and queue message handling, deployed on **Azure Functions Flex Consumption** running **Python 3.14** on the Functions v4 runtime (configured with `FUNCTIONS_WORKER_RUNTIME=python`; note that `FUNCTIONS_EXTENSION_VERSION` is neither supported nor configured on Flex Consumption, and `"version": "2.0"` in `host.json` specifies the configuration schema version, not runtime version):

```
functions/
├── host.json               # Configured with schema "version": "2.0" (schema version, not runtime version)
├── local.settings.json     # Local debug settings (FUNCTIONS_WORKER_RUNTIME: "python")
├── requirements.txt        # Function-level dependencies for Python 3.14
├── outbox_dispatcher/
│   ├── __init__.py         # Polls outbox_events, pushes to Storage Queue, marks PUBLISHED
│   └── function.json       # TimerTrigger (Schedule: "*/10 * * * * *")
└── queue_processor/
    ├── __init__.py         # Reads Storage Queue message, executes job, updates analysis_jobs
    └── function.json       # QueueTrigger (QueueName: "analysis-jobs")
```

---

## 4. Continuous Integration & Continuous Deployment (CI/CD)

The GitHub Actions workflow automates testing, container image building, and multi-service deployment across App Service, Azure Functions, and Static Web Apps.

### 4.1 CI/CD Pipeline Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Causara CI/CD Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test-and-lint:
    name: Backend & Frontend Validation
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Set up Python 3.14
        uses: actions/setup-python@v5
        with:
          python-version: '3.14'

      - name: Install Backend Dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
          pip install pytest flake8

      - name: Run Python Linting & PEP 8
        run: flake8 app tests --max-line-length=100

      - name: Execute Backend Tests (Pytest)
        run: pytest tests/ --junitxml=junit.xml

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Build & Test Frontend (React / TypeScript)
        run: |
          cd frontend
          npm ci
          npm run lint
          npm run test -- --watchAll=false
          npm run build

  build-and-deploy:
    name: Build & Deploy to Azure
    needs: test-and-lint
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Source Code
        uses: actions/checkout@v4

      - name: Log in to Azure Container Registry (ACR)
        uses: azure/docker-login@v2
        with:
          login-server: ${{ secrets.ACR_LOGIN_SERVER }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and Push API Container Image
        run: |
          docker build -t ${{ secrets.ACR_LOGIN_SERVER }}/causara-api:${{ github.sha }} .
          docker push ${{ secrets.ACR_LOGIN_SERVER }}/causara-api:${{ github.sha }}

      - name: Deploy API to Azure App Service
        uses: azure/webapps-deploy@v3
        with:
          app-name: 'causara-api'
          images: '${{ secrets.ACR_LOGIN_SERVER }}/causara-api:${{ github.sha }}'

      - name: Deploy Azure Functions App
        uses: Azure/functions-action@v1
        with:
          app-name: 'causara-functions'
          package: 'functions'

      - name: Deploy Frontend to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: 'upload'
          app_location: 'frontend'
          output_location: 'dist'
```

---

## 5. Configuration & Environment Isolation

Causara maintains strict configuration separation across development, staging, and production environments:

### 5.1 Python Runtime Baseline & Local Environment
- **Project Minor Version**: Python 3.14.
- **Preferred Local Patch Baseline**: Python 3.14.10 (official Python 3.14 maintenance release).
- **Local Developer Coexistence**: Existing installed local versions (such as Python 3.14.2) can remain installed without modification; virtual environments (`.venv`) maintain dependency isolation without touching global interpreter packages.
- **Cloud Runtime**: Azure App Service Linux container (`python:3.14-slim`) and Azure Functions Flex Consumption (Linux, Python 3.14 on Functions runtime v4).

### 5.2 Environment Topology
```
[Local Development] 
  ├── .env.development (Local environment variables)
  ├── SQLite / Local SQL Server Express
  ├── Azurite (Local Azure Storage & Queue Emulator)
  └── Azure Functions Core Tools (Local function execution)

[Azure Production]
  ├── Azure App Service Application Settings (Linked to Key Vault)
  ├── Azure Functions Flex Consumption Configuration (Linked to Key Vault)
  ├── Azure SQL Database (Serverless Production)
  ├── Azure Cosmos DB (Serverless Container)
  └── Azure Blob Storage & Storage Queues
```
