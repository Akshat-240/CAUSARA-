-- ============================================================================
-- Causara Database Migration: V005__outbox_exponential_backoff.sql
-- Description: Adds next_retry_at column to dbo.outbox_events to support
--              exponential retry backoff with bounded delays.
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

IF COL_LENGTH('dbo.outbox_events', 'next_retry_at') IS NULL
BEGIN
    ALTER TABLE dbo.outbox_events
    ADD next_retry_at DATETIME2 NULL;
END;
GO
