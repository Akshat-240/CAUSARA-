-- ============================================================================
-- Causara Database Migration: V004__outbox_processing_enhancements.sql
-- Description: Adds locked_at and error_message columns to dbo.outbox_events
--              to support atomic worker claiming, lease expiry, and failure diagnostics.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'locked_at') IS NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    ADD locked_at DATETIME2 NULL;
END;
GO

IF COL_LENGTH('dbo.outbox_events', 'error_message') IS NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    ADD error_message NVARCHAR(1000) NULL;
END;
GO
