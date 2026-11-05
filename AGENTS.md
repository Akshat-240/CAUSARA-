# CAUSARA - PROJECT AGENT INSTRUCTIONS

## 1. Project Identity

Project: Causara

Causara is an explainable e-commerce order delay
intelligence and intervention analysis platform.

It reconstructs order histories, identifies potential
delay causes, compares alternative interventions,
explains delays and verifies predicted outcomes
against actual observations.

This is a solo engineering project.

## 2. Technology Stack

Frontend:
- React
- TypeScript

Backend:
- Python
- Flask REST API

Database:
- Azure SQL Database
- Azure Cosmos DB
- Azure Blob Storage

Background Processing:
- Azure Storage Queue
- Azure Functions

Cloud:
- Azure App Service
- Azure Static Web Apps
- Azure Key Vault

Development:
- Git
- Docker
- GitHub Actions
- Pytest

## 3. Architecture Principles

- Follow modular monolith architecture.
- Maintain clear separation of concerns.
- Keep business logic independent of infrastructure.
- Use REST APIs for frontend-backend communication.
- Use Azure SQL as the transactional source of truth.
- Use asynchronous processing for expensive analysis.
- Avoid unnecessary microservices.
- Avoid unnecessary dependencies.

## 4. Causara Domain Rules

- Distinguish facts, hypotheses and estimates.
- Never present correlation as proven causation.
- Preserve original order event timestamps.
- Maintain occurred_at and received_at separately.
- Support manual and external event ingestion.
- Ensure event processing is idempotent.
- Keep predictions separate from actual outcomes.
- Maintain traceable intervention decisions.
- Never fabricate verification results.

## 5. Coding Standards

Python:
- Follow PEP 8.
- Use type hints.
- Use modular services and repositories.
- Handle errors explicitly.
- Write tests using Pytest.

TypeScript:
- Use functional React components.
- Enable strict TypeScript.
- Avoid unnecessary any types.
- Keep reusable components modular.
- Validate API responses and user inputs.

SQL:
- Use explicit primary and foreign keys.
- Maintain referential integrity.
- Follow 3NF where appropriate.
- Use parameterized queries.
- Maintain version-controlled migrations.
- Avoid destructive schema changes without approval.

## 6. Security Rules

- Never hardcode credentials.
- Never commit secrets or API keys.
- Use environment variables for configuration.
- Use Azure Key Vault for production secrets.
- Enforce server-side authorization.
- Validate all external inputs.
- Prevent SQL injection and XSS.
- Use secure password hashing.
- Restrict access to customer and seller data.

## 7. Database Rules

- Follow the approved database specification.
- Do not invent tables or relationships.
- Report schema inconsistencies before implementation.
- Use migrations for database changes.
- Preserve existing data during migrations.
- Do not execute destructive migrations without approval.

The final database schema must be reviewed before
implementation.

## 8. Agent Working Protocol

Before a significant implementation task:

1. Inspect relevant project files.
2. Read applicable documentation.
3. Understand existing architecture.
4. Identify affected components.
5. Propose a concise implementation plan.
6. Implement only the requested scope.
7. Run relevant tests.
8. Report changed files and test results.

Do not rewrite unrelated components.

Do not install dependencies without explaining
their purpose.

Do not provision Azure resources without approval.

Do not execute destructive operations without approval.

Do not begin application implementation merely
because the workspace has been opened.

## 9. Documentation

Keep architecture, database and API documentation
synchronized with implementation.

Report design conflicts instead of silently
choosing an alternative.

## 10. Final Reporting

After each task, report:

- What changed.
- Files created or modified.
- Dependencies introduced.
- Tests executed.
- Test results.
- Known limitations.
- Important decisions requiring approval.

