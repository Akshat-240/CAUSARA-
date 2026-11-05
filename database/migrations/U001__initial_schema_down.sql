-- ============================================================================
-- Causara Database Rollback Migration: U001__initial_schema_down.sql
-- Description: Drops all 18 relational tables in reverse dependency order.
-- ============================================================================

DROP TABLE IF EXISTS dbo.analysis_jobs;
DROP TABLE IF EXISTS dbo.outbox_events;
DROP TABLE IF EXISTS dbo.audit_log;
DROP TABLE IF EXISTS dbo.verifications;
DROP TABLE IF EXISTS dbo.decisions;
DROP TABLE IF EXISTS dbo.scenario_interventions;
DROP TABLE IF EXISTS dbo.scenarios;
DROP TABLE IF EXISTS dbo.interventions;
DROP TABLE IF EXISTS dbo.delay_edges;
DROP TABLE IF EXISTS dbo.evidence;
DROP TABLE IF EXISTS dbo.decision_cases;
DROP TABLE IF EXISTS dbo.order_events;
DROP TABLE IF EXISTS dbo.order_stages;
DROP TABLE IF EXISTS dbo.orders;
DROP TABLE IF EXISTS dbo.sellers;
DROP TABLE IF EXISTS dbo.user_roles;
DROP TABLE IF EXISTS dbo.roles;
DROP TABLE IF EXISTS dbo.users;
