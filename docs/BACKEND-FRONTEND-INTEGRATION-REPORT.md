# CAUSARA — BACKEND-FIRST FRONTEND INTEGRATION REPORT
**Integration Audit & Verification | Date: 11 November 2026**

---

### Executive Summary

The React frontend has been completely connected to the Flask REST API backend (`/api/v1`) running against the SQL Server database (`(localdb)\CausaraDB`).

In strict compliance with the project's non-negotiable rules, **every dynamic value displayed in the frontend originates from an actual backend API response**. All mock objects, static fallback arrays, placeholder IDs, hardcoded KPI values, and hardcoded demo identities have been audited and removed.

---

### 1. Endpoint-to-Page Integration Map

| Frontend View / Component | Backend API Endpoint | HTTP Method | Data Payload / Content-Type | Real Database Source |
| :--- | :--- | :--- | :--- | :--- |
| **System Shell (Header)** | `/api/v1/health` | `GET` | JSON | Liveness & live DB connectivity probe (`check_db_connectivity()`) |
| **System Shell (Actor Selector)** | `/api/v1/actors` | `GET` | JSON | Active operational actors from `dbo.users` + `dbo.user_roles` |
| **Overview (Dashboard)** | `/api/v1/orders/stats` | `GET` | JSON | Aggregate fulfillment counts from `dbo.orders` & `dbo.decision_cases` |
| **Overview (Recent Activity)** | `/api/v1/orders?limit=10` | `GET` | JSON | Live consignments joined with `dbo.sellers` and `dbo.users` |
| **Orders (Catalog & Filter)** | `/api/v1/orders?status=...&limit=50` | `GET` | JSON | Real order list with status, delivery dates, and stage metadata |
| **Orders (Detail Drawer)** | `/api/v1/orders/{id}` | `GET` | JSON | Order record with planned & actual timestamps |
| **Orders (Stage Breakdown)** | `/api/v1/orders/{id}/stages` | `GET` | JSON | Planned vs. observed stage records from `dbo.order_stages` |
| **Orders (Order Creation)** | `/api/v1/sellers`<br>`/api/v1/users?role=CUSTOMER`<br>`/api/v1/orders` | `GET`<br>`GET`<br>`POST` | JSON<br>JSON<br>JSON | Registered sellers from `dbo.sellers`<br>Customers from `dbo.users`<br>New order inserted with proportional baseline stages |
| **Order Timeline (Reconstruction)** | `/api/v1/orders/{id}/timeline`<br>`/api/v1/orders/{id}/timeline/reconstruct` | `GET`<br>`POST` | JSON | Normalized chronological events, validation status, and customer summary |
| **Evidence (Repository)** | `/api/v1/orders/{id}/evidence`<br>`/api/v1/orders/{id}/evidence`<br>`/api/v1/evidence/{id}` | `GET`<br>`POST`<br>`GET` | JSON<br>`multipart/form-data`<br>JSON | Metadata from `dbo.evidence`<br>Raw file upload with automatic SHA-256 computation<br>Cryptographic digest inspection |
| **Delay Analysis (Decomposition)**| `/api/v1/orders/{id}/delay-analysis`<br>`/api/v1/cases/{id}/delay-graph` | `GET` / `POST`<br>`GET` | JSON | Computed stage duration variances & synthesized propagation edges |
| **Interventions (Levers)** | `/api/v1/cases/{id}/interventions` | `GET` | JSON | Discovered mitigation candidates matching bottleneck delay points |
| **Scenario Simulator** | `/api/v1/cases/{id}/scenarios`<br>`/api/v1/cases/{id}/scenarios/auto-generate`<br>`/api/v1/cases/{id}/scenarios` | `GET`<br>`POST`<br>`POST` | JSON | Evaluated scenarios, predicted time savings, estimated costs, confidence gauges |
| **Decisions (Governance)** | `/api/v1/cases/{id}/decisions`<br>`/api/v1/cases/{id}/decisions`<br>`/api/v1/decisions/{id}/approve`<br>`/api/v1/decisions/{id}/reject` | `GET`<br>`POST`<br>`POST`<br>`POST` | JSON | Recorded operational decisions, analyst rationale, manager approval/rejection |
| **Outcome Verification** | `/api/v1/decisions/{id}/verification`<br>`/api/v1/decisions/{id}/verify` | `GET`<br>`POST` | JSON | Audited actual delivery timestamp against counterfactual predictions |

---

### 2. Environment Configuration

- **Frontend Configuration (`frontend/.env` / `frontend/.env.example`)**:
  ```env
  VITE_API_BASE_URL=/api/v1
  ```
  Uses Vite's local dev server reverse-proxy configuration targeting `http://localhost:5000` with `changeOrigin: true`. This prevents CORS issues during development while maintaining full cross-origin header support when deployed standalone.

- **Backend Configuration (`.env` / `app/config.py`)**:
  - `PORT=5000`
  - `FLASK_ENV=development`
  - `CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`
  - `DB_SERVER=(localdb)\CausaraDB`
  - `DB_NAME=CausaraDB`
  - `DB_DRIVER=ODBC Driver 17 for SQL Server`
  - `DB_TRUSTED_CONNECTION=yes`

- **Centralized API Client (`frontend/src/services/api.ts`)**:
  - Generic typed request handler supporting `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`.
  - Automatic `Content-Type: application/json` header setting for string payloads, while safely preserving standard multipart boundary headers for `FormData` file uploads.
  - Request cancellation through `AbortSignal`.
  - Centralized error envelope parsing (`{ error: { code, message } }`), throwing meaningful, user-readable errors on HTTP 4xx/5xx responses.
  - Network disconnection handling that produces an explicit `"Connection Error: ..."` message without falling back to mock or stale data.

---

### 3. Backend/Frontend Contract Mismatches Found and Resolved

| Identified Mismatch | Missing Backend Capability / Gap | Database-Backed Solution Implemented |
| :--- | :--- | :--- |
| **Hardcoded Demo Actor IDs (`1`, `2`, `3`, `4`)** | Frontend had hardcoded actor objects. Database identities use `IDENTITY(1,1)` (`user_id` values like `192171`, `192173`, etc.). | Added `GET /api/v1/actors` in `app/api/users.py` backed by `dbo.users` joined with `dbo.user_roles` and `dbo.roles`. Demo users in `database/seed_demo_data.py` are properly mapped to `SELLER`, `CUSTOMER`, `ANALYST`, and `MANAGER` roles. |
| **Hardcoded Seller and Customer IDs in Order Creation Form** | `OrdersPage` form defaulted to hardcoded `seller_id: 1` and `customer_user_id: 2`. | 1. Added `GET /api/v1/sellers` in `app/api/orders.py` returning registered sellers from `dbo.sellers`.<br>2. Added `GET /api/v1/users?role=CUSTOMER` in `app/api/users.py`.<br>3. Replaced text inputs with dynamic `<select>` dropdowns populated with real registered sellers and customer users. |
| **Hardcoded Manager ID (`2`) in Decision Approval/Rejection** | `DecisionsPage` defaulted to `managerId: 2` if active actor was not a manager. | Updated approval/rejection workflow to find an active user with role `MANAGER` from the live `/api/v1/actors` response. If no manager is available, an explicit error banner is rendered. |
| **Pagination Skew in Overview Dashboard KPIs** | Dashboard computed statistics by client-side filtering a paginated `limit=50` order list. | Implemented `GET /api/v1/orders/stats` in `app/api/orders.py` and `OrderRepository.get_order_stats()`. Returns aggregate counts (`total_orders`, `delivered_orders`, `active_orders`, `cancelled_orders`, `delayed_orders`, `open_cases_count`) computed across all database records via SQL `COUNT`/`SUM`. |
| **Superficial Health Check** | `GET /api/v1/health` previously returned a static `"status": "healthy"` without verifying database connectivity. | Enhanced `health_check()` in `app/api/health.py` to invoke `check_db_connectivity()` from `app.database.connection`. Health response now reports `"database": "connected"` or `"database": "disconnected"`. |
| **Offset-Aware vs Naive Datetime Comparison in Order Creation** | Ingesting ISO-8601 `expected_delivery_at` with UTC offset caused Python `TypeError: can't compare offset-naive and offset-aware datetimes` in `OrderService.create_order`. | Normalized both `placed` and `expected` to UTC naive datetimes in `OrderService.create_order` before comparison, duration subtraction, and database storage. |
| **Missing `active_case_id` in Order Catalog & Details** | `OrderRepository.list_orders()` omitted `active_case_id`, and `get_order_by_id()` joined only on `status IN ('OPEN', ...)`, causing closed or resolved cases (like demo order 191154 $\rightarrow$ case 110490) to be disconnected in downstream pages. | Added correlated subquery in `list_orders` and `get_order_by_id` prioritizing open cases and falling back to the latest case ID, seamlessly linking all downstream tabs (Interventions, Scenarios, Decisions, Verification). |

---

### 4. Pages Connected to Real APIs

Every page was verified against the running Flask backend and SQL Server instance:

1. **Overview Page**:
   - Live KPI cards render directly from `GET /api/v1/orders/stats` (`total_orders: 12`, `active_orders: 9`, `delivered_orders: 2`, `open_cases: 8`).
   - Recent orders table renders real database consignments from `GET /api/v1/orders?limit=10`.
2. **Orders Page**:
   - Order catalog loads live consignments from `GET /api/v1/orders`.
   - Stage progression panel inspects real timestamps from `GET /api/v1/orders/{id}/stages`.
   - New Order modal loads live sellers (`GET /api/v1/sellers`) and customer users (`GET /api/v1/users?role=CUSTOMER`).
3. **Order Timeline Page**:
   - Reconstructs real order event streams via `POST /api/v1/orders/{id}/timeline/reconstruct` or `GET /api/v1/orders/{id}/timeline`.
   - Displays real validation statuses (`VALID`, `OUT_OF_ORDER`, `DUPLICATE`, `CONFLICT`) and real plain-language customer summaries.
4. **Evidence Page**:
   - Loads real evidence records from `GET /api/v1/orders/{id}/evidence`.
   - File upload submits genuine `multipart/form-data` to `POST /api/v1/orders/{id}/evidence` with real uploading actor ID.
   - Integrity modal inspects actual SHA-256 cryptographic hashes computed by the backend.
5. **Delay Analysis Page**:
   - Triggers real delay analysis via `POST /api/v1/orders/{id}/delay-analysis`.
   - Renders 4-quadrant epistemology cards (Facts, Variances, Hypotheses, Estimates) derived from stage durations and graph propagation edges.
6. **Interventions Page**:
   - Discovers candidate levers from `GET /api/v1/cases/{id}/interventions` matching the active case's delay points.
7. **Scenario Simulator**:
   - Retrieves simulated scenarios via `GET /api/v1/cases/{id}/scenarios`.
   - Generates scenarios via `POST /api/v1/cases/{id}/scenarios/auto-generate` or custom simulation with selected interventions.
8. **Decisions Page**:
   - Lists real decision history from `GET /api/v1/cases/{id}/decisions`.
   - Commits new decision records (`POST /api/v1/cases/{id}/decisions`) with the active actor's real user ID.
   - Operations Manager approval (`POST /decisions/{id}/approve`) and rejection (`POST /decisions/{id}/reject`) use real manager IDs.
9. **Outcome Verification Page**:
   - Loads audited verifications via `GET /api/v1/decisions/{id}/verification`.
   - Records observed delivery times (`POST /api/v1/decisions/{id}/verify`) and renders real signed prediction errors and SLA variances.

---

### 5. Disconnected Endpoints & Remaining Hardcoded Data Audit

- **Disconnected Endpoints**: **ZERO**. All frontend views and actions are wired to functional backend routes.
- **Remaining Hardcoded Data**: **ZERO**. A recursive search across all `.ts` and `.tsx` source files confirmed no mock objects, sample arrays, placeholder order records, fake chart datasets, hardcoded KPI values, or static fallback responses exist.

---

### 6. Live Connectivity & Vite Proxy Verification Results

Live end-to-end verification was executed through the Vite dev server proxy (`http://localhost:5173/api/v1`) directly communicating with the Flask backend (`http://127.0.0.1:5000`) and the SQL Server LocalDB (`(localdb)\CausaraDB`):

#### A. Comprehensive 9-Page Proxy Verification (18/18 Read Requests Succeeded)
| Page | Endpoint Called via Proxy | HTTP Status | Response Verification |
| :--- | :--- | :--- | :--- |
| **System Shell** | `GET http://localhost:5173/api/v1/health` | `200 OK` | `"status": "healthy"`, `"database": "connected"` |
| **System Shell** | `GET http://localhost:5173/api/v1/actors` | `200 OK` | 4 operational actors returned from `dbo.users` + `dbo.user_roles` |
| **Overview** | `GET http://localhost:5173/api/v1/orders/stats` | `200 OK` | `total_orders: 13`, `delivered_orders: 2`, `active_orders: 10`, `open_cases_count: 8` |
| **Overview** | `GET http://localhost:5173/api/v1/orders?limit=10` | `200 OK` | Recent consignments joined with sellers and customers |
| **Orders** | `GET http://localhost:5173/api/v1/orders?status=ALL&limit=50` | `200 OK` | Complete order catalog with statuses and active case links |
| **Orders** | `GET http://localhost:5173/api/v1/orders/191154` | `200 OK` | Order details with `active_case_id: 110490` |
| **Orders** | `GET http://localhost:5173/api/v1/orders/191154/stages` | `200 OK` | 5 operational stages with planned and actual timestamps |
| **Orders** | `GET http://localhost:5173/api/v1/sellers` | `200 OK` | Registered business sellers from `dbo.sellers` |
| **Orders** | `GET http://localhost:5173/api/v1/users?role=CUSTOMER` | `200 OK` | Customer users for order placement dropdown |
| **Timeline** | `GET http://localhost:5173/api/v1/orders/191154/timeline` | `200 OK` | Normalized chronological events with validation status and plain-English summary |
| **Evidence** | `GET http://localhost:5173/api/v1/orders/191154/evidence` | `200 OK` | Uploaded evidence items with SHA-256 digests and uploader IDs |
| **Evidence** | `GET http://localhost:5173/api/v1/evidence/80054` | `200 OK` | Single evidence record with blob metadata |
| **Delay Analysis** | `GET http://localhost:5173/api/v1/orders/191154/delay-analysis` | `200 OK` | 4-quadrant epistemology, arithmetic variances (1560 min), propagation graph |
| **Delay Analysis** | `GET http://localhost:5173/api/v1/cases/110490/delay-graph` | `200 OK` | Bottleneck propagation graph edges |
| **Interventions** | `GET http://localhost:5173/api/v1/cases/110490/interventions` | `200 OK` | Candidate mitigation levers for active bottleneck |
| **Scenarios** | `GET http://localhost:5173/api/v1/cases/110490/scenarios` | `200 OK` | Evaluated scenarios with predicted time savings and costs |
| **Decisions** | `GET http://localhost:5173/api/v1/cases/110490/decisions` | `200 OK` | Recorded decisions with analyst rationale and manager approval |
| **Verification** | `GET http://localhost:5173/api/v1/decisions/80077/verification` | `200 OK` | Verified actual delivery against counterfactual prediction |

#### B. Live State Mutation & Workflow Tests via Proxy
1. **Order Creation (`POST /api/v1/orders`)**:
   - Consignment `ORD-PROXY-d2bde6af` successfully created with `seller_id: 191072` and `customer_user_id: 192172`.
   - Result: `order_id: 221338`, 5 baseline operational stages generated.
2. **Timeline Reconstruction (`POST /api/v1/orders/221338/timeline/reconstruct`)**:
   - Reconstruct job executed for new order.
   - Result: `job_id: 160127`, valid chronological event sequencing established.
3. **Multipart Evidence Upload (`POST /api/v1/orders/221338/evidence`)**:
   - Uploaded binary evidence file `proxy_test_evidence.txt` with `uploaded_by: 192173`.
   - Result: `evidence_id: 90066`, SHA-256 hash `c8ebe6e4d81e940b6c25f5dadc331e3cd68520754a55315a2b25e18ea9f5f7f7` computed and persisted in SQL Server.

#### C. Honest Error Handling via Proxy
- Querying non-existent entity `GET http://localhost:5173/api/v1/orders/9999999`:
  - Returns HTTP 404 with JSON envelope:
    ```json
    {
      "error": {
        "code": "RESOURCE_NOT_FOUND",
        "details": null,
        "message": "Order 9999999 does not exist."
      },
      "meta": { "request_id": "req_...", "timestamp": "..." },
      "success": false
    }
    ```
  - Frontend intercepts the response and renders an honest error alert: `"Order 9999999 does not exist."`.

#### D. Frontend Production Build
- `npm run build --prefix frontend`:
  - `tsc -b` and `vite build` completed with 0 errors.
  - Dist bundle: `dist/assets/index-B6uXTA-o.js` (245.60 kB).

---

### Conclusion

The Causara frontend is fully integrated with the Flask backend. All business and operational data is live, authentic, and sourced directly from the database through standard REST API endpoints.
