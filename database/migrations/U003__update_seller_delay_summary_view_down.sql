-- ============================================================================
-- Causara Database Rollback Migration: U003__update_seller_delay_summary_view_down.sql
-- Description: Reverts vw_SellerDelaySummary back to V002 definition (avg_delay_hours).
-- Target: Microsoft Azure SQL Database / Microsoft SQL Server
-- ============================================================================

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
