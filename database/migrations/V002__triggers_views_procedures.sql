-- ============================================================================
-- Causara Database Migration: V002__triggers_views_procedures.sql
-- Description: Creates database triggers, analytical views, and stored procedures.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

-- 1. Analytical View: vw_SellerDelaySummary
CREATE OR ALTER VIEW dbo.vw_SellerDelaySummary AS
SELECT 
    s.seller_id,
    s.business_name,
    COUNT(o.order_id) AS total_orders,
    SUM(CASE WHEN o.status = 'DELAYED' THEN 1 ELSE 0 END) AS delayed_orders,
    CAST(AVG(DATEDIFF(MINUTE, o.placed_at, ISNULL(o.actual_delivery_at, SYSUTCDATETIME()))) / 60.0 AS DECIMAL(10,2)) AS avg_fulfillment_hours,
    CAST(AVG(CASE WHEN o.actual_delivery_at > o.expected_delivery_at 
                  THEN DATEDIFF(MINUTE, o.expected_delivery_at, o.actual_delivery_at) 
                  ELSE 0 END) / 60.0 AS DECIMAL(10,2)) AS avg_delay_hours
FROM dbo.sellers s
LEFT JOIN dbo.orders o ON s.seller_id = o.seller_id
GROUP BY s.seller_id, s.business_name;
GO

-- 2. Analytical View: vw_OrderStageDelayBreakdown
CREATE OR ALTER VIEW dbo.vw_OrderStageDelayBreakdown AS
SELECT 
    os.order_id,
    os.stage_id,
    os.stage_code,
    os.sequence_no,
    DATEDIFF(MINUTE, os.planned_start_at, os.planned_end_at) AS planned_duration_minutes,
    DATEDIFF(MINUTE, os.actual_start_at, os.actual_end_at) AS actual_duration_minutes,
    (DATEDIFF(MINUTE, os.actual_start_at, os.actual_end_at) - 
     DATEDIFF(MINUTE, os.planned_start_at, os.planned_end_at)) AS variance_minutes
FROM dbo.order_stages os
WHERE os.actual_start_at IS NOT NULL AND os.actual_end_at IS NOT NULL;
GO

-- 3. Database Trigger: trg_delay_edges_order_stage_integrity
CREATE OR ALTER TRIGGER dbo.trg_delay_edges_order_stage_integrity
ON dbo.delay_edges
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- 1. Disallow self-loops (from_stage_id == to_stage_id)
    IF EXISTS (
        SELECT 1 
        FROM inserted 
        WHERE from_stage_id = to_stage_id
    )
    BEGIN
        THROW 50010, 'Invalid delay edge: from_stage_id and to_stage_id cannot be identical.', 1;
    END;

    -- 2. Verify case, from_stage, and to_stage all belong to the identical order_id (multi-row safe)
    IF EXISTS (
        SELECT 1
        FROM inserted i
        JOIN dbo.decision_cases dc ON i.case_id = dc.case_id
        JOIN dbo.order_stages fs ON i.from_stage_id = fs.stage_id
        JOIN dbo.order_stages ts ON i.to_stage_id = ts.stage_id
        WHERE dc.order_id <> fs.order_id 
           OR dc.order_id <> ts.order_id
    )
    BEGIN
        THROW 50011, 'Cross-order integrity violation: delay edge stages must belong to the exact order investigated by the decision case.', 1;
    END;
END;
GO

-- 4. Database Trigger: trg_order_stages_immutable_order
CREATE OR ALTER TRIGGER dbo.trg_order_stages_immutable_order
ON dbo.order_stages
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(order_id)
    BEGIN
        IF EXISTS (
            SELECT 1 
            FROM inserted i 
            JOIN deleted d ON i.stage_id = d.stage_id 
            WHERE i.order_id <> d.order_id
        )
        BEGIN
            THROW 50012, 'Order ownership immutability violation: order_stages.order_id cannot be modified after record creation.', 1;
        END;
    END;
END;
GO

-- 5. Database Trigger: trg_decision_cases_immutable_order
CREATE OR ALTER TRIGGER dbo.trg_decision_cases_immutable_order
ON dbo.decision_cases
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE(order_id)
    BEGIN
        IF EXISTS (
            SELECT 1 
            FROM inserted i 
            JOIN deleted d ON i.case_id = d.case_id 
            WHERE i.order_id <> d.order_id
        )
        BEGIN
            THROW 50013, 'Order ownership immutability violation: decision_cases.order_id cannot be modified after record creation.', 1;
        END;
    END;
END;
GO

-- 6. Stored Procedure: usp_CreateDecisionCase
CREATE OR ALTER PROCEDURE dbo.usp_CreateDecisionCase
    @OrderId BIGINT,
    @CreatedBy BIGINT,
    @CaseTitle NVARCHAR(150),
    @NewCaseId BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.orders WHERE order_id = @OrderId)
            THROW 50001, 'Invalid order_id specified.', 1;

        INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
        VALUES (@OrderId, @CreatedBy, @CaseTitle, 'OPEN', SYSUTCDATETIME());

        SET @NewCaseId = SCOPE_IDENTITY();

        -- Create tracked asynchronous job record
        DECLARE @JobId BIGINT;
        DECLARE @JobIdempotencyKey NVARCHAR(200) = CONCAT('case-init-', @NewCaseId, '-', CONVERT(NVARCHAR(36), NEWID()));

        INSERT INTO dbo.analysis_jobs (
            order_id, case_id, decision_id, job_type, status, idempotency_key, retry_count, created_at
        )
        VALUES (
            @OrderId, @NewCaseId, NULL, 'SCENARIO_SIMULATION', 'QUEUED', @JobIdempotencyKey, 0, SYSUTCDATETIME()
        );

        SET @JobId = SCOPE_IDENTITY();

        -- Insert outbox event for the Timer-Triggered Dispatcher
        DECLARE @Payload NVARCHAR(MAX) = (
            SELECT 
                @JobId AS job_id, 
                @OrderId AS order_id, 
                @NewCaseId AS case_id, 
                'SCENARIO_SIMULATION' AS job_type 
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        );

        INSERT INTO dbo.outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
        VALUES ('ANALYSIS_JOB_QUEUED', 'ANALYSIS_JOB', @JobId, @Payload);

        INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at)
        VALUES (@CreatedBy, 'CASE_OPENED', 'DECISION_CASE', @NewCaseId, SYSUTCDATETIME());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 7. Stored Procedure: usp_RecordDecision
CREATE OR ALTER PROCEDURE dbo.usp_RecordDecision
    @CaseId BIGINT,
    @ScenarioId BIGINT,
    @DecidedBy BIGINT,
    @Rationale NVARCHAR(1000),
    @NewDecisionId BIGINT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.scenarios WHERE case_id = @CaseId AND scenario_id = @ScenarioId)
            THROW 50004, 'Scenario does not belong to the specified decision case.', 1;

        INSERT INTO dbo.decisions (case_id, scenario_id, decided_by, decision_status, rationale, selected_at)
        VALUES (@CaseId, @ScenarioId, @DecidedBy, 'PENDING', @Rationale, SYSUTCDATETIME());

        SET @NewDecisionId = SCOPE_IDENTITY();

        INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at)
        VALUES (@DecidedBy, 'DECISION_RECORDED', 'DECISION', @NewDecisionId, SYSUTCDATETIME());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 8. Stored Procedure: usp_ApproveDecision
CREATE OR ALTER PROCEDURE dbo.usp_ApproveDecision
    @DecisionId BIGINT,
    @ManagerUserId BIGINT
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.decisions
        SET 
            decision_status = 'APPROVED',
            approved_by = @ManagerUserId,
            approved_at = SYSUTCDATETIME()
        WHERE decision_id = @DecisionId
          AND decision_status = 'PENDING';

        IF @@ROWCOUNT <> 1
            THROW 50003, 'Decision not in PENDING state or does not exist.', 1;

        INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at)
        VALUES (@ManagerUserId, 'DECISION_APPROVED', 'DECISION', @DecisionId, SYSUTCDATETIME());

        DECLARE @ApprovePayload NVARCHAR(MAX) = (
            SELECT @DecisionId AS decision_id, @ManagerUserId AS approved_by 
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        );

        INSERT INTO dbo.outbox_events (event_type, aggregate_type, aggregate_id, payload_json)
        VALUES ('DECISION_APPROVED', 'DECISION', @DecisionId, @ApprovePayload);

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO

-- 9. Stored Procedure: usp_VerifyPrediction
CREATE OR ALTER PROCEDURE dbo.usp_VerifyPrediction
    @DecisionId BIGINT,
    @ActualDeliveryAt DATETIME2,
    @OutcomeNotes NVARCHAR(1000)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @CaseId BIGINT, @ScenarioId BIGINT, @PredictedMinutes BIGINT, @OriginalExpectedAt DATETIME2;

        SELECT 
            @CaseId = d.case_id,
            @ScenarioId = d.scenario_id,
            @PredictedMinutes = ISNULL(s.predicted_time_saved_minutes, 0),
            @OriginalExpectedAt = o.expected_delivery_at
        FROM dbo.decisions d
        JOIN dbo.scenarios s ON d.scenario_id = s.scenario_id AND d.case_id = s.case_id
        JOIN dbo.decision_cases dc ON d.case_id = dc.case_id
        JOIN dbo.orders o ON dc.order_id = o.order_id
        WHERE d.decision_id = @DecisionId;

        IF @CaseId IS NULL
            THROW 50002, 'Decision record not found or inconsistent with case.', 1;

        -- Calculate predicted delivery timestamp based on predicted minutes saved
        DECLARE @PredictedDeliveryAt DATETIME2 = DATEADD(MINUTE, -@PredictedMinutes, @OriginalExpectedAt);

        -- Reconcile or Insert single verification record
        IF EXISTS (SELECT 1 FROM dbo.verifications WHERE decision_id = @DecisionId)
        BEGIN
            UPDATE dbo.verifications
            SET 
                measured_at = SYSUTCDATETIME(),
                original_expected_delivery_at = @OriginalExpectedAt,
                baseline_estimated_delivery_at = @OriginalExpectedAt,
                predicted_delivery_at = @PredictedDeliveryAt,
                actual_delivery_at = @ActualDeliveryAt,
                outcome_notes = @OutcomeNotes
            WHERE decision_id = @DecisionId;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.verifications (
                decision_id, measured_at, original_expected_delivery_at,
                baseline_estimated_delivery_at, predicted_delivery_at,
                actual_delivery_at, outcome_notes
            )
            VALUES (
                @DecisionId, SYSUTCDATETIME(), @OriginalExpectedAt,
                @OriginalExpectedAt, @PredictedDeliveryAt,
                @ActualDeliveryAt, @OutcomeNotes
            );
        END;

        UPDATE dbo.decisions SET decision_status = 'EXECUTED' WHERE decision_id = @DecisionId;

        INSERT INTO dbo.audit_log (actor_user_id, action, entity_type, entity_id, occurred_at)
        VALUES (NULL, 'PREDICTION_VERIFIED', 'DECISION', @DecisionId, SYSUTCDATETIME());

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH
END;
GO
