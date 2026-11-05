-- ============================================================================
-- Causara Database Rollback Migration: U002__triggers_views_procedures_down.sql
-- Description: Drops triggers, views, and stored procedures created in V002.
-- ============================================================================

DROP PROCEDURE IF EXISTS dbo.usp_VerifyPrediction;
DROP PROCEDURE IF EXISTS dbo.usp_ApproveDecision;
DROP PROCEDURE IF EXISTS dbo.usp_RecordDecision;
DROP PROCEDURE IF EXISTS dbo.usp_CreateDecisionCase;

DROP TRIGGER IF EXISTS dbo.trg_decision_cases_immutable_order;
DROP TRIGGER IF EXISTS dbo.trg_order_stages_immutable_order;
DROP TRIGGER IF EXISTS dbo.trg_delay_edges_order_stage_integrity;

DROP VIEW IF EXISTS dbo.vw_OrderStageDelayBreakdown;
DROP VIEW IF EXISTS dbo.vw_SellerDelaySummary;
