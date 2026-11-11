-- ============================================================================
-- Causara Rollback Migration: U004__outbox_processing_enhancements_down.sql
-- Description: Drops locked_at and error_message columns from dbo.outbox_events.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'error_message') IS NOT NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    DROP COLUMN error_message;
END;
GO

IF COL_LENGTH('dbo.outbox_events', 'locked_at') IS NOT NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    DROP COLUMN locked_at;
END;
GO
