-- ============================================================================
-- Causara Rollback Migration: U005__outbox_exponential_backoff_down.sql
-- Description: Drops next_retry_at column from dbo.outbox_events.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'next_retry_at') IS NOT NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    DROP COLUMN next_retry_at;
END;
GO
