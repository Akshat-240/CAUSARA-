-- ============================================================================
-- Causara Database Migration: V001__initial_schema.sql
-- Description: Creates the 18-table 3NF relational schema, primary keys,
--              candidate keys, foreign keys, check constraints, and performance indexes.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

-- 1. users
IF OBJECT_ID('dbo.users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.users (
        user_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        full_name NVARCHAR(100) NOT NULL,
        email NVARCHAR(254) NOT NULL UNIQUE,
        password_hash NVARCHAR(255) NOT NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END;

-- 2. roles
IF OBJECT_ID('dbo.roles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.roles (
        role_id SMALLINT IDENTITY(1,1) PRIMARY KEY,
        role_name NVARCHAR(40) NOT NULL UNIQUE, -- 'CUSTOMER', 'SELLER', 'MANAGER', 'ANALYST', 'AUDITOR', 'ADMIN'
        description NVARCHAR(255) NULL
    );
END;

-- 3. user_roles
IF OBJECT_ID('dbo.user_roles', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_roles (
        user_id BIGINT NOT NULL,
        role_id SMALLINT NOT NULL,
        assigned_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        assigned_by BIGINT NULL,
        CONSTRAINT PK_user_roles PRIMARY KEY (user_id, role_id),
        CONSTRAINT FK_user_roles_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id) ON DELETE CASCADE,
        CONSTRAINT FK_user_roles_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id),
        CONSTRAINT FK_user_roles_assigned_by FOREIGN KEY (assigned_by) REFERENCES dbo.users(user_id)
    );
END;

-- 4. sellers
IF OBJECT_ID('dbo.sellers', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.sellers (
        seller_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        owner_user_id BIGINT NOT NULL UNIQUE,
        business_name NVARCHAR(150) NOT NULL,
        contact_number NVARCHAR(20) NULL,
        business_status NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED', 'UNDER_REVIEW'
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_sellers_owner FOREIGN KEY (owner_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_sellers_status CHECK (business_status IN ('ACTIVE', 'SUSPENDED', 'UNDER_REVIEW'))
    );
END;

-- 5. orders
IF OBJECT_ID('dbo.orders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.orders (
        order_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        seller_id BIGINT NOT NULL,
        customer_user_id BIGINT NOT NULL,
        external_order_ref NVARCHAR(100) NOT NULL,
        placed_at DATETIME2 NOT NULL,
        expected_delivery_at DATETIME2 NOT NULL,
        actual_delivery_at DATETIME2 NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'PLACED', -- 'PLACED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED'
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_orders_seller FOREIGN KEY (seller_id) REFERENCES dbo.sellers(seller_id),
        CONSTRAINT FK_orders_customer FOREIGN KEY (customer_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_orders_seller_ref UNIQUE (seller_id, external_order_ref),
        CONSTRAINT CK_orders_status CHECK (status IN ('PLACED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'DELAYED', 'CANCELLED')),
        CONSTRAINT CK_orders_delivery_window CHECK (expected_delivery_at > placed_at)
    );
END;

-- 6. order_stages
IF OBJECT_ID('dbo.order_stages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.order_stages (
        stage_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        order_id BIGINT NOT NULL,
        stage_code NVARCHAR(40) NOT NULL, -- 'SELLER_PROCESSING', 'DISPATCH', 'LINEHAUL_TRANSPORT', 'LAST_MILE', 'DELIVERED'
        sequence_no INT NOT NULL,
        planned_start_at DATETIME2 NULL,
        planned_end_at DATETIME2 NULL,
        actual_start_at DATETIME2 NULL,
        actual_end_at DATETIME2 NULL,
        status NVARCHAR(25) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'
        CONSTRAINT FK_order_stages_order FOREIGN KEY (order_id) REFERENCES dbo.orders(order_id) ON DELETE CASCADE,
        CONSTRAINT UQ_order_stages_seq UNIQUE (order_id, sequence_no),
        CONSTRAINT UQ_order_stages_order_stage UNIQUE (order_id, stage_id),
        CONSTRAINT CK_order_stages_status CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'))
    );
END;

-- 7. order_events
IF OBJECT_ID('dbo.order_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.order_events (
        event_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        order_id BIGINT NOT NULL,
        stage_id BIGINT NULL,
        event_type NVARCHAR(50) NOT NULL,
        occurred_at DATETIME2 NOT NULL,
        received_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        source_type NVARCHAR(20) NOT NULL, -- 'MANUAL_DASHBOARD', 'COURIER_API', 'OMS_WEBHOOK', 'SYSTEM'
        source_provider NVARCHAR(100) NULL,
        source_event_id NVARCHAR(150) NULL,
        idempotency_key NVARCHAR(200) NOT NULL UNIQUE,
        location NVARCHAR(200) NULL,
        description NVARCHAR(500) NULL,
        raw_payload NVARCHAR(MAX) NULL,
        CONSTRAINT FK_order_events_order FOREIGN KEY (order_id) REFERENCES dbo.orders(order_id),
        CONSTRAINT FK_order_events_order_stage FOREIGN KEY (order_id, stage_id) REFERENCES dbo.order_stages(order_id, stage_id),
        CONSTRAINT UQ_order_events_order_event UNIQUE (order_id, event_id),
        CONSTRAINT CK_order_events_source CHECK (source_type IN ('MANUAL_DASHBOARD', 'COURIER_API', 'OMS_WEBHOOK', 'SYSTEM'))
    );
END;

-- 8. decision_cases
IF OBJECT_ID('dbo.decision_cases', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.decision_cases (
        case_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        order_id BIGINT NOT NULL,
        created_by BIGINT NOT NULL,
        case_title NVARCHAR(150) NOT NULL,
        status NVARCHAR(25) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'ANALYZING', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED'
        opened_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        closed_at DATETIME2 NULL,
        CONSTRAINT FK_decision_cases_order FOREIGN KEY (order_id) REFERENCES dbo.orders(order_id),
        CONSTRAINT FK_decision_cases_creator FOREIGN KEY (created_by) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_decision_cases_order_case UNIQUE (order_id, case_id),
        CONSTRAINT CK_decision_cases_status CHECK (status IN ('OPEN', 'ANALYZING', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED'))
    );
END;

-- 9. evidence
IF OBJECT_ID('dbo.evidence', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.evidence (
        evidence_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        order_id BIGINT NOT NULL,
        event_id BIGINT NULL,
        case_id BIGINT NULL,
        uploaded_by BIGINT NOT NULL,
        blob_uri NVARCHAR(500) NOT NULL UNIQUE,
        file_name NVARCHAR(255) NOT NULL,
        content_type NVARCHAR(100) NOT NULL,
        sha256_hash CHAR(64) NOT NULL,
        status NVARCHAR(25) NOT NULL DEFAULT 'PENDING_UPLOAD',
        upload_expires_at DATETIME2 NOT NULL,
        completed_at DATETIME2 NULL,
        uploaded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_evidence_order FOREIGN KEY (order_id) REFERENCES dbo.orders(order_id),
        CONSTRAINT FK_evidence_order_event FOREIGN KEY (order_id, event_id) REFERENCES dbo.order_events(order_id, event_id),
        CONSTRAINT FK_evidence_order_case FOREIGN KEY (order_id, case_id) REFERENCES dbo.decision_cases(order_id, case_id),
        CONSTRAINT FK_evidence_uploader FOREIGN KEY (uploaded_by) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_evidence_status CHECK (status IN ('PENDING_UPLOAD', 'ACTIVE', 'FAILED', 'DELETED'))
    );
END;

-- 10. delay_edges
IF OBJECT_ID('dbo.delay_edges', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.delay_edges (
        edge_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        case_id BIGINT NOT NULL,
        from_stage_id BIGINT NOT NULL,
        to_stage_id BIGINT NOT NULL,
        edge_type NVARCHAR(30) NOT NULL, -- 'STAGE_TRANSITION', 'BOTTLENECK_PROPAGATION', 'CORRELATION'
        evidence_class NVARCHAR(20) NOT NULL, -- 'FACT', 'HYPOTHESIS', 'ESTIMATE'
        estimated_delay_minutes BIGINT NULL,
        explanation NVARCHAR(1000) NULL,
        CONSTRAINT FK_delay_edges_case FOREIGN KEY (case_id) REFERENCES dbo.decision_cases(case_id) ON DELETE CASCADE,
        CONSTRAINT FK_delay_edges_from FOREIGN KEY (from_stage_id) REFERENCES dbo.order_stages(stage_id),
        CONSTRAINT FK_delay_edges_to FOREIGN KEY (to_stage_id) REFERENCES dbo.order_stages(stage_id),
        CONSTRAINT CK_delay_edges_type CHECK (edge_type IN ('STAGE_TRANSITION', 'BOTTLENECK_PROPAGATION', 'CORRELATION')),
        CONSTRAINT CK_delay_edges_class CHECK (evidence_class IN ('FACT', 'HYPOTHESIS', 'ESTIMATE'))
    );
END;

-- 11. interventions
IF OBJECT_ID('dbo.interventions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.interventions (
        intervention_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        intervention_code NVARCHAR(50) NOT NULL UNIQUE, -- 'PRIORITY_PACKING', 'CARRIER_REROUTE', 'AIR_FREIGHT_UPGRADE'
        name NVARCHAR(150) NOT NULL,
        description NVARCHAR(500) NULL,
        intervention_type NVARCHAR(50) NOT NULL, -- 'WAREHOUSE', 'CARRIER', 'NOTIFICATION', 'COMMUNICATION'
        is_active BIT NOT NULL DEFAULT 1
    );
END;

-- 12. scenarios
IF OBJECT_ID('dbo.scenarios', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.scenarios (
        scenario_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        case_id BIGINT NOT NULL,
        scenario_name NVARCHAR(150) NOT NULL,
        status NVARCHAR(25) NOT NULL DEFAULT 'PENDING_PERSISTENCE',
        predicted_time_saved_minutes BIGINT NULL,
        estimated_cost DECIMAL(12,2) NULL,
        risk_level NVARCHAR(20) NOT NULL, -- 'LOW', 'MEDIUM', 'HIGH'
        confidence_score DECIMAL(5,4) NULL,
        cosmos_document_id NVARCHAR(150) NULL,
        model_version NVARCHAR(50) NULL,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_scenarios_case FOREIGN KEY (case_id) REFERENCES dbo.decision_cases(case_id) ON DELETE CASCADE,
        CONSTRAINT UQ_scenarios_case_scenario UNIQUE (case_id, scenario_id),
        CONSTRAINT CK_scenarios_status CHECK (status IN ('PENDING_PERSISTENCE', 'READY', 'FAILED')),
        CONSTRAINT CK_scenarios_risk CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
        CONSTRAINT CK_scenarios_confidence CHECK (confidence_score BETWEEN 0.0 AND 1.0),
        CONSTRAINT CK_scenarios_cost CHECK (estimated_cost >= 0.0)
    );
END;

-- 13. scenario_interventions
IF OBJECT_ID('dbo.scenario_interventions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.scenario_interventions (
        scenario_id BIGINT NOT NULL,
        intervention_id BIGINT NOT NULL,
        estimated_cost_contribution DECIMAL(12,2) NULL,
        CONSTRAINT PK_scenario_interventions PRIMARY KEY (scenario_id, intervention_id),
        CONSTRAINT FK_scenario_interventions_scenario FOREIGN KEY (scenario_id) REFERENCES dbo.scenarios(scenario_id) ON DELETE CASCADE,
        CONSTRAINT FK_scenario_interventions_intervention FOREIGN KEY (intervention_id) REFERENCES dbo.interventions(intervention_id)
    );
END;

-- 14. decisions
IF OBJECT_ID('dbo.decisions', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.decisions (
        decision_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        case_id BIGINT NOT NULL,
        scenario_id BIGINT NOT NULL,
        decided_by BIGINT NOT NULL,
        approved_by BIGINT NULL,
        decision_status NVARCHAR(25) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'
        rationale NVARCHAR(1000) NULL,
        selected_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        approved_at DATETIME2 NULL,
        CONSTRAINT FK_decisions_case FOREIGN KEY (case_id) REFERENCES dbo.decision_cases(case_id),
        CONSTRAINT FK_decisions_case_scenario FOREIGN KEY (case_id, scenario_id) REFERENCES dbo.scenarios(case_id, scenario_id),
        CONSTRAINT FK_decisions_decider FOREIGN KEY (decided_by) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_decisions_approver FOREIGN KEY (approved_by) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_decisions_case_decision UNIQUE (case_id, decision_id),
        CONSTRAINT CK_decisions_status CHECK (decision_status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'))
    );
END;

-- 15. verifications
IF OBJECT_ID('dbo.verifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.verifications (
        verification_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        decision_id BIGINT NOT NULL,
        measured_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        original_expected_delivery_at DATETIME2 NOT NULL,
        baseline_estimated_delivery_at DATETIME2 NULL,
        predicted_delivery_at DATETIME2 NOT NULL,
        actual_delivery_at DATETIME2 NOT NULL,
        signed_prediction_error_minutes AS (DATEDIFF(MINUTE, predicted_delivery_at, actual_delivery_at)) PERSISTED,
        absolute_prediction_error_minutes AS (ABS(DATEDIFF(MINUTE, predicted_delivery_at, actual_delivery_at))) PERSISTED,
        delivery_variance_minutes AS (DATEDIFF(MINUTE, original_expected_delivery_at, actual_delivery_at)) PERSISTED,
        outcome_notes NVARCHAR(1000) NULL,
        CONSTRAINT FK_verifications_decision FOREIGN KEY (decision_id) REFERENCES dbo.decisions(decision_id),
        CONSTRAINT UQ_verifications_decision UNIQUE (decision_id)
    );
END;

-- 16. audit_log
IF OBJECT_ID('dbo.audit_log', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_log (
        audit_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        actor_user_id BIGINT NULL,
        action NVARCHAR(100) NOT NULL,
        entity_type NVARCHAR(50) NOT NULL,
        entity_id BIGINT NOT NULL,
        occurred_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        metadata_json NVARCHAR(MAX) NULL,
        CONSTRAINT FK_audit_log_user FOREIGN KEY (actor_user_id) REFERENCES dbo.users(user_id)
    );
END;

-- 17. outbox_events
IF OBJECT_ID('dbo.outbox_events', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.outbox_events (
        outbox_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        event_type NVARCHAR(100) NOT NULL,
        aggregate_type NVARCHAR(50) NOT NULL,
        aggregate_id BIGINT NOT NULL,
        payload_json NVARCHAR(MAX) NOT NULL,
        status NVARCHAR(20) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'
        retry_count INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        published_at DATETIME2 NULL,
        CONSTRAINT CK_outbox_events_status CHECK (status IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED'))
    );
END;

-- 18. analysis_jobs
IF OBJECT_ID('dbo.analysis_jobs', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.analysis_jobs (
        job_id BIGINT IDENTITY(1,1) PRIMARY KEY,
        order_id BIGINT NOT NULL,
        case_id BIGINT NULL,
        decision_id BIGINT NULL,
        job_type NVARCHAR(50) NOT NULL, -- 'TIMELINE_RECONSTRUCTION', 'SCENARIO_SIMULATION', 'OUTCOME_VERIFICATION'
        status NVARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'
        idempotency_key NVARCHAR(200) NOT NULL UNIQUE,
        retry_count INT NOT NULL DEFAULT 0,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        started_at DATETIME2 NULL,
        completed_at DATETIME2 NULL,
        error_message NVARCHAR(1000) NULL,
        CONSTRAINT FK_analysis_jobs_order FOREIGN KEY (order_id) REFERENCES dbo.orders(order_id),
        CONSTRAINT FK_analysis_jobs_order_case FOREIGN KEY (order_id, case_id) REFERENCES dbo.decision_cases(order_id, case_id),
        CONSTRAINT FK_analysis_jobs_case_decision FOREIGN KEY (case_id, decision_id) REFERENCES dbo.decisions(case_id, decision_id),
        CONSTRAINT CK_analysis_jobs_status CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
        CONSTRAINT CK_analysis_jobs_type CHECK (job_type IN ('TIMELINE_RECONSTRUCTION', 'SCENARIO_SIMULATION', 'OUTCOME_VERIFICATION')),
        CONSTRAINT CK_analysis_jobs_type_deps CHECK (
            (job_type = 'TIMELINE_RECONSTRUCTION' AND case_id IS NULL AND decision_id IS NULL) OR
            (job_type = 'SCENARIO_SIMULATION' AND case_id IS NOT NULL AND decision_id IS NULL) OR
            (job_type = 'OUTCOME_VERIFICATION' AND case_id IS NOT NULL AND decision_id IS NOT NULL)
        )
    );
END;

-- Performance Indexes
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_users_email' AND object_id = OBJECT_ID('dbo.users'))
    CREATE NONCLUSTERED INDEX IX_users_email ON dbo.users(email);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_orders_seller_placed' AND object_id = OBJECT_ID('dbo.orders'))
    CREATE NONCLUSTERED INDEX IX_orders_seller_placed ON dbo.orders(seller_id, placed_at DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_orders_customer' AND object_id = OBJECT_ID('dbo.orders'))
    CREATE NONCLUSTERED INDEX IX_orders_customer ON dbo.orders(customer_user_id, placed_at DESC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_order_events_timeline' AND object_id = OBJECT_ID('dbo.order_events'))
    CREATE NONCLUSTERED INDEX IX_order_events_timeline ON dbo.order_events(order_id, occurred_at ASC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_order_stages_seq' AND object_id = OBJECT_ID('dbo.order_stages'))
    CREATE NONCLUSTERED INDEX IX_order_stages_seq ON dbo.order_stages(order_id, sequence_no ASC);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_decision_cases_order_status' AND object_id = OBJECT_ID('dbo.decision_cases'))
    CREATE NONCLUSTERED INDEX IX_decision_cases_order_status ON dbo.decision_cases(order_id, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_scenarios_case' AND object_id = OBJECT_ID('dbo.scenarios'))
    CREATE NONCLUSTERED INDEX IX_scenarios_case ON dbo.scenarios(case_id, scenario_id);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_outbox_events_pending' AND object_id = OBJECT_ID('dbo.outbox_events'))
    CREATE NONCLUSTERED INDEX IX_outbox_events_pending ON dbo.outbox_events(status, created_at ASC)
    WHERE status IN ('PENDING', 'PROCESSING');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_analysis_jobs_order_status' AND object_id = OBJECT_ID('dbo.analysis_jobs'))
    CREATE NONCLUSTERED INDEX IX_analysis_jobs_order_status ON dbo.analysis_jobs(order_id, status);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_analysis_jobs_case' AND object_id = OBJECT_ID('dbo.analysis_jobs'))
    CREATE NONCLUSTERED INDEX IX_analysis_jobs_case ON dbo.analysis_jobs(case_id) 
    WHERE case_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_analysis_jobs_decision' AND object_id = OBJECT_ID('dbo.analysis_jobs'))
    CREATE NONCLUSTERED INDEX IX_analysis_jobs_decision ON dbo.analysis_jobs(decision_id) 
    WHERE decision_id IS NOT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_audit_log_entity_time' AND object_id = OBJECT_ID('dbo.audit_log'))
    CREATE NONCLUSTERED INDEX IX_audit_log_entity_time ON dbo.audit_log(entity_type, entity_id, occurred_at DESC);
