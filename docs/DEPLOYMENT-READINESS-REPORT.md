# CAUSARA v0.1.0 — DEPLOYMENT READINESS ASSESSMENT

**Project:** Causara  
**Assessment Target:** Pre-Redesign MVP Staging Deployment  
**Current Stable Commit:** `aa6b06f`  
**GitHub Repository:** `https://github.com/Akshat-240/CAUSARA-`  
**Evaluation Date:** November 12, 2026  

---

## Executive Summary

This assessment evaluates the architectural and operational readiness of Causara v0.1.0 (commit `aa6b06f`) for a private staging deployment to Microsoft Azure before proceeding with the planned frontend redesign.

The target cloud architecture comprises:
- **Frontend SPA**: Azure Static Web Apps (React + TypeScript + Vite)
- **Backend REST API**: Azure App Service on Linux (Python 3.12+ Flask)
- **Relational Store**: Azure SQL Database (General Purpose Serverless or Basic DTU)
- **Object / Evidence Store**: Azure Blob Storage (General Purpose v2)
- **Secret Management**: Azure Key Vault

### Readiness Verdict Summary

| Area # | Evaluated Area | Readiness Status | Summary |
|:---:|---|:---:|---|
| **1** | LocalDB-to-Azure-SQL Migration | **REQUIRES CHANGES** | Runner supports Azure SQL, but firewall, provisioning, and seed execution are required. |
| **2** | SQL Schema, Triggers, Views & Procedures | **READY** | 100% ANSI/T-SQL compliant with Azure SQL; zero unsupported constructs. |
| **3** | Python Dependencies & Startup Config | **BLOCKER** | Lacks production WSGI server (`gunicorn`), custom startup command, and blob SDK. |
| **4** | ODBC Driver Requirements | **REQUIRES CHANGES** | Linux container requires `ODBC Driver 18 for SQL Server` with SSL encryption configs. |
| **5** | Local Evidence Storage Migration | **BLOCKER** | `EvidenceService` only supports local filesystem; Azure Blob Storage provider is missing. |
| **6** | Environment Variables & Secrets | **REQUIRES CHANGES** | Configuration structure ready, but Key Vault references and production secrets need setup. |
| **7** | CORS & API URL Configuration | **REQUIRES CHANGES** | Missing `staticwebapp.config.json` for SPA routing; build-time `VITE_API_BASE_URL` required. |
| **8** | Background Worker & Outbox Processing | **REQUIRES CHANGES** | `OutboxProcessor` code is complete, but no scheduler/runner (Azure Function/WebJob) exists. |
| **9** | Private Staging Access Restrictions | **BLOCKER** | Application lacks user auth (M3 deferred); requires Azure Easy Auth / IP whitelist. |
| **10** | Expected Azure Resources & Costs | **READY** | Low-cost tier allocation defined (~$18–$25/month for basic staging). |

---

## 1. LocalDB-to-Azure-SQL Migration Requirements

**Status:** `REQUIRES CHANGES`

### Current State
- The application currently connects to Microsoft SQL Server LocalDB (`(localdb)\CausaraDB`) via Windows Trusted Authentication (`DB_TRUSTED_CONNECTION=yes`).
- Connection management in `app/database/connection.py` and `database/migration_runner.py` already supports `AZURE_SQL_CONNECTION_STRING` or structured `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` parameters.

### Migration Requirements
1. **Azure SQL Logical Server & Database Provisioning**:
   - Provision an Azure SQL logical server (e.g. `causara-sql.database.windows.net`) and database (`causara-db`).
   - Configure Server Collation to `SQL_Latin1_General_CP1_CI_AS` (matches SQL Server standard).
2. **Firewall & Network Configuration**:
   - Enable *"Allow Azure services and resources to access this server"* so Azure App Service can reach the database.
   - Add the administrator/deployer client IP address to the firewall rules to permit running migrations from the local developer workstation or deployment runner.
3. **Connection Security**:
   - Enforce TLS 1.2+ encryption (`Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;`).
4. **Migration Execution**:
   - Run `python -m database.migration_runner` with `AZURE_SQL_CONNECTION_STRING` set.
   - Run `python -m database.seed_demo_data` to populate baseline demonstration cases (Orders #191153–#191156, stages, baseline scenarios, and decisions).

---

## 2. SQL Schema, Triggers, Procedures, Views & Migration Compatibility

**Status:** `READY`

### Current State
The migration sequence consists of 5 forward migrations and 5 rollback migrations:
- `V001__initial_schema.sql` (Tables, Foreign Keys, Primary Keys, Constraints)
- `V002__triggers_views_procedures.sql` (Integrity Triggers, Analytical Views, Stored Procedures)
- `V003__update_seller_delay_summary_view.sql` (Analytical View adjustment)
- `V004__outbox_processing_enhancements.sql` (Concurrency index & locked_until column)
- `V005__outbox_exponential_backoff.sql` (Retry backoff interval schema)

### Compatibility Audit
- **Zero Unsupported Azure SQL Constructs**: An exhaustive audit confirmed no `USE [database]` statements, no cross-database queries, no `xp_cmdshell` references, and no server-level system catalog dependencies.
- **T-SQL Concurrency & JSON Primitives**:
  - `FOR JSON PATH, WITHOUT_ARRAY_WRAPPER` used in stored procedures (`usp_OpenDecisionCase`, `usp_ApproveDecision`) is fully supported.
  - Table locking hints `WITH (UPDLOCK, READPAST)` used by the Outbox processor in `app/repositories/outbox_repository.py` are natively supported in Azure SQL Database.
  - Date functions `SYSUTCDATETIME()` and `DATEDIFF(MINUTE, ...)` are standard.
- **Transaction & Migration Safety**:
  - `database/migration_runner.py` executes each migration inside explicit transactions with SHA-256 checksum auditing in `dbo.schema_migrations`.

---

## 3. Python Dependencies and App Service Startup Configuration

**Status:** `BLOCKER`

### Current State
`requirements.txt` contains only 4 direct dependencies:
```text
Flask>=3.1.0
flask-cors>=5.0.0
python-dotenv>=1.0.1
pyodbc>=5.3.0
```
Application startup locally is handled by `python run.py`, which invokes Flask’s built-in development server (`app.run()`).

### Deficiencies & Blockers
1. **Missing Production WSGI Server**:
   - Flask’s built-in server is explicitly single-threaded and not designed for production hosting.
   - `gunicorn` is **missing** from `requirements.txt`.
2. **Missing Storage SDK**:
   - `azure-storage-blob` is **missing** from `requirements.txt`.
3. **App Service Linux Startup Command**:
   - Azure App Service on Linux requires an explicit startup script or command. Without configuration, it may fail to discover the application factory.
   - Required startup command:
     ```bash
     gunicorn --bind=0.0.0.0:8000 --workers=4 --timeout=600 "run:app"
     ```
   - Alternatively, a standard entry point `wsgi.py` should be provided at the repository root.

---

## 4. ODBC Driver Requirements

**Status:** `REQUIRES CHANGES`

### Current State
Local development on Windows relies on `ODBC Driver 17 for SQL Server`. The default in `app/database/connection.py` is:
```python
driver = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")
```

### Linux App Service Compatibility
- Azure App Service on Linux uses Debian/Ubuntu-based container images with `unixODBC` and Microsoft's Linux ODBC drivers pre-installed.
- Modern App Service Python runtime images typically provide **`ODBC Driver 18 for SQL Server`**.
- `ODBC Driver 18` introduces breaking default changes compared to Driver 17:
  - `Encrypt` defaults to `yes`.
  - `TrustServerCertificate` defaults to `no`.
- **Requirement**: Set the App Service configuration setting `DB_DRIVER` to `"ODBC Driver 18 for SQL Server"` (or verify image driver via `odbcinst -q -d`).
- Connection strings must explicitly configure `Encrypt=yes;TrustServerCertificate=no;` to prevent SSL handshake errors against Azure SQL Database.

---

## 5. Local Evidence Storage Migration Requirements

**Status:** `BLOCKER`

### Current State
- `app/services/evidence_service.py` currently implements only `LocalStorageProvider`.
- Files are saved to the local directory:
  ```text
  storage/evidence/{order_id}/{sha256[:16]}_{file_name}
  ```
- Blobs are assigned pseudo-URIs: `local://evidence/{order_id}/{safe_name}`.

### Deficiencies & Blockers
1. **Container Ephemerality**:
   - Azure App Service Linux containers have ephemeral local file storage outside the `/home` directory. Files uploaded to the container filesystem are wiped during scaling events, container recycles, or new deployments.
2. **Missing Cloud Provider Implementation**:
   - While `LocalStorageProvider` was designed to be pluggable, `AzureBlobStorageProvider` is **not implemented**.
   - Methods `store_file(order_id, file_name, file_bytes)` and `read_file(blob_uri)` must be implemented using `BlobServiceClient` from the `azure-storage-blob` package.
3. **Dual Provider Selection**:
   - `EvidenceService` must dynamically instantiate `AzureBlobStorageProvider` when `AZURE_STORAGE_CONNECTION_STRING` or Managed Identity credentials are present, falling back to `LocalStorageProvider` only in local test environments.

---

## 6. Environment Variables and Secrets Management

**Status:** `REQUIRES CHANGES`

### Current State
Configuration is centralized in `app/config.py` with three environment classes: `DevelopmentConfig`, `TestingConfig`, and `ProductionConfig`.

`ProductionConfig` correctly enforces that `SECRET_KEY` is not the development default:
```python
if not secret or secret == "causara-dev-secret-key-insecure":
    raise ValueError("SECRET_KEY must be set to a secure value in production environment.")
```

### Staging Configuration Requirements
The following environment variables must be configured in Azure App Service Application Settings:

| Environment Variable | Recommended Value / Source | Purpose |
|---|---|---|
| `FLASK_ENV` | `production` | Enforces production mode and strict security checks |
| `SECRET_KEY` | Key Vault Reference: `@Microsoft.KeyVault(...)` | Session encryption entropy |
| `AZURE_SQL_CONNECTION_STRING` | Key Vault Reference: `@Microsoft.KeyVault(...)` | Connection string for Azure SQL |
| `INTERNAL_API_KEY` | Key Vault Reference: `@Microsoft.KeyVault(...)` | Internal operational endpoint security |
| `AZURE_STORAGE_CONNECTION_STRING` | Key Vault Reference: `@Microsoft.KeyVault(...)` | Azure Blob Storage access |
| `AZURE_STORAGE_CONTAINER` | `evidence` | Blob container name |
| `CORS_ORIGINS` | `https://<swa-app-name>.azurestaticapps.net` | Whitelisted cross-origin domains |
| `PORT` | `8000` | HTTP port exposed by App Service container |
| `DB_DRIVER` | `ODBC Driver 18 for SQL Server` | Linux container ODBC driver |

> [!IMPORTANT]
> Use Azure App Service **System-Assigned Managed Identity** granted the *Key Vault Secrets User* role on the Key Vault instance. This eliminates hardcoded credentials in App Service configuration.

---

## 7. CORS and Frontend API Base URL Requirements

**Status:** `REQUIRES CHANGES`

### Current State
- Backend CORS in `app/__init__.py` uses `flask-cors` matching `CORS_ORIGINS`.
- Frontend API client in `frontend/src/services/api.ts` uses:
  ```typescript
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
  ```
- In local development, Vite proxies `/api` calls to `http://127.0.0.1:5000`.

### Staging Requirements
1. **Missing `staticwebapp.config.json`**:
   - In React Single Page Applications on Azure Static Web Apps, refreshing routes like `/orders` or `/timeline` causes Azure Static Web Apps to return HTTP 404 unless a fallback rewrite rule exists.
   - **Requirement**: Add `frontend/staticwebapp.config.json`:
     ```json
     {
       "navigationFallback": {
         "rewrite": "/index.html",
         "exclude": ["/assets/*.{png,jpg,jpeg,gif,svg,css,js}"]
       }
     }
     ```
2. **Build-Time `VITE_API_BASE_URL`**:
   - In Vite, `import.meta.env` values are static replacements embedded into JavaScript bundles during `npm run build`.
   - The GitHub Actions workflow building the Static Web App must inject:
     ```yaml
     env:
       VITE_API_BASE_URL: "https://<app-service-name>.azurewebsites.net/api/v1"
     ```
3. **Backend CORS Whitelist**:
   - The App Service `CORS_ORIGINS` must include the generated Static Web App URL:
     ```text
     https://<app-name>.azurestaticapps.net
     ```

---

## 8. Background Worker and Outbox Deployment Requirements

**Status:** `REQUIRES CHANGES`

### Current State
- `app/services/outbox_processor.py` implements a robust transaction-safe processor (`OutboxProcessor`) supporting atomic row claiming (`UPDLOCK, READPAST`), lease expiration, retry backoffs, and dead-letter handling.
- However, `OutboxProcessor` is currently only invoked programmatically during automated unit tests (`tests/test_outbox_processing.py`). There is **no background loop or daemon** running in the application.

### Staging Requirements
When events are created (e.g. `ANALYSIS_JOB_QUEUED`, `DECISION_APPROVED`), rows are inserted into `dbo.outbox_events` with `status = 'PENDING'`. Without an active runner, messages remain unprocessed.

Choose one of two staging deployment patterns:
1. **Azure Functions Timer Trigger (Recommended)**:
   - A lightweight serverless function running every 30–60 seconds invoking `OutboxProcessor().process_batch(batch_size=10)`.
2. **In-Process Background Thread / App Service WebJob**:
   - A lightweight background thread or continuous WebJob script in App Service executing:
     ```python
     while True:
         processor.process_batch()
         time.sleep(15)
     ```

---

## 9. Authentication and Access Restrictions for Private Staging

**Status:** `BLOCKER`

### Current State
- Causara v0.1.0 MVP has **no user authentication** implemented (Milestone M3 is scheduled for subsequent development).
- The frontend features an "Actor Switcher" dropdown in the Header that allows simulating different actors (`User #192174 - Operations Manager`, `User #192175 - Delay Analyst`, etc.).
- All backend REST API endpoints under `/api/v1/` (`/orders`, `/events`, `/timeline`, `/evidence`, `/delay`, `/scenarios`, `/decisions`) are completely unauthenticated.

### Security Risk
If deployed directly to public Azure App Service and Azure Static Web Apps endpoints without perimeter access control, **anyone with the URL can inspect order data, upload evidence, simulate scenarios, and alter decision records.**

### Mandatory Staging Protections
Because application-level authentication is deferred to M3, perimeter security **must** be enforced at the Azure infrastructure layer:
1. **App Service Built-in Authentication (Easy Auth)**:
   - Enable Easy Auth on App Service using Microsoft Entra ID (Azure AD). Restrict access exclusively to the engineer's tenant or user account.
2. **App Service Access Restrictions (IP Whitelist)**:
   - Restrict incoming HTTP traffic on App Service to:
     - The engineer's personal public IP address.
     - The Azure Static Web Apps outbound IP range.
   - Deny all other incoming traffic with HTTP 403.
3. **Static Web Apps Password Protection or Entra ID**:
   - Enable password protection on the Static Web App (supported on Standard tier) or configure Microsoft Entra ID authentication in `staticwebapp.config.json`.

---

## 10. Expected Azure Resources and Cost Categories

**Status:** `READY`

### Provisioning Specification for Minimal Staging

| Azure Service | Recommended Tier | Justification | Estimated Monthly Cost |
|---|---|---|:---:|
| **Azure Static Web Apps** | Free tier (or Standard if password protection needed) | Global CDN distribution for React Vite SPA | **$0.00** (Free) / **$9.00** (Standard) |
| **Azure App Service (Linux)** | **B1 Basic** (1 Core, 1.75 GB RAM) | Dedicated compute, Always-On support (prevents cold start delays) | **~$13.00** |
| **Azure SQL Database** | **General Purpose Serverless** (0.5 vCore min, auto-pause after 1h) or **Basic DTU (5 DTU)** | Relational transactional source of truth; low staging load | **~$5.00 – $12.00** |
| **Azure Blob Storage** | Standard General Purpose v2 (LRS, Hot tier) | Storage for uploaded evidence documents | **< $0.50** |
| **Azure Key Vault** | Standard tier | Secure secret and connection string storage | **< $0.20** |
| **Azure Functions** | Consumption Plan (Y1) | Timer trigger for Outbox processing (if selected) | **$0.00** (First 1M executions free) |
| **Total Estimated Staging Cost** | | | **~$18.00 – $25.00 / month** |

---

## 11. Pre-Deployment Remediation Checklist

Before any Azure resources are provisioned or deployment pipelines are triggered, the following code and configuration items must be resolved:

- [ ] **WSGI Server**: Add `gunicorn>=23.0.0` to `requirements.txt`.
- [ ] **Azure Blob Storage SDK**: Add `azure-storage-blob>=12.24.0` to `requirements.txt`.
- [ ] **Blob Storage Provider**: Implement `AzureBlobStorageProvider` in `app/services/evidence_service.py` to store and retrieve files from Azure Blob Storage.
- [ ] **SPA Routing Fallback**: Create `frontend/staticwebapp.config.json` with `navigationFallback: { rewrite: "/index.html" }`.
- [ ] **Production Entry Point**: Verify App Service startup command (`gunicorn --bind=0.0.0.0:8000 --workers=4 "run:app"`).
- [ ] **Infrastructure Access Control**: Configure App Service Easy Auth / IP restrictions to guard unauthenticated endpoints.
- [ ] **Outbox Scheduler**: Deploy a background worker mechanism for `OutboxProcessor`.
- [ ] **Build Pipeline**: Configure GitHub Actions to inject `VITE_API_BASE_URL` during Vite build.

---

## 12. Verification and Safe Invariants

- **No Azure resources have been created or modified.**
- **No cloud charges have been incurred.**
- **Existing working MVP code and tests remain 100% operational and unchanged.**
- **LocalDB databases and local evidence storage files remain intact.**
