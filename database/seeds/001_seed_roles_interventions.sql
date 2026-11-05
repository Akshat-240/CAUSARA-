-- ============================================================================
-- Causara Seed Data: 001_seed_roles_interventions.sql
-- Description: Idempotently populates catalog tables (roles and interventions).
-- ============================================================================

-- Roles catalog
MERGE INTO dbo.roles AS target
USING (VALUES 
    ('CUSTOMER', 'Track orders and view simplified delay explanations'),
    ('SELLER', 'Investigate delayed orders, evaluate scenarios, and select interventions'),
    ('MANAGER', 'Operations governance, high-cost approval, and performance oversight'),
    ('ANALYST', 'Historical delay pattern analytics and intervention efficacy modeling'),
    ('AUDITOR', 'Audit trail inspection and cryptographic evidence validation'),
    ('ADMIN', 'Platform configuration, user identity, and webhook management')
) AS source (role_name, description)
ON target.role_name = source.role_name
WHEN NOT MATCHED THEN
    INSERT (role_name, description)
    VALUES (source.role_name, source.description);

-- Interventions catalog
MERGE INTO dbo.interventions AS target
USING (VALUES
    ('PRIORITY_PACKING', 'Expedited warehouse picking and priority queue packaging', 'WAREHOUSE', 1),
    ('CARRIER_REROUTE', 'Reroute consignment to alternative linehaul freight partner', 'CARRIER', 1),
    ('AIR_FREIGHT_UPGRADE', 'Upgrade regional ground transport to next-flight-out air cargo', 'CARRIER', 1),
    ('HUB_EXPEDITE', 'Priority sorting dock handover at distribution hub', 'WAREHOUSE', 1),
    ('CUSTOMER_PROACTIVE_NOTICE', 'Automated proactive communication with revised delivery commitment', 'COMMUNICATION', 1)
) AS source (intervention_code, name, intervention_type, is_active)
ON target.intervention_code = source.intervention_code
WHEN NOT MATCHED THEN
    INSERT (intervention_code, name, intervention_type, is_active)
    VALUES (source.intervention_code, source.name, source.intervention_type, source.is_active);
