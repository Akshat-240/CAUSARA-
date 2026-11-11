"""Comprehensive database integration test suite for Causara.

Executed against a live Microsoft SQL Server engine (LocalDB / Azure SQL Database)
verifying all 18 tables, composite constraints, multi-row triggers, computed columns,
views, stored procedures, and migration operations.
"""

from datetime import datetime, timedelta, timezone
import uuid
import pyodbc
import pytest
from database.migration_runner import MigrationRunner, get_default_connection_string


@pytest.fixture(scope="session")
def db_conn():
    """Session-scoped connection ensuring migrations and seed data are applied."""
    runner = MigrationRunner()
    runner.migrate()
    runner.seed()

    conn_str = get_default_connection_string()
    conn = pyodbc.connect(conn_str, autocommit=False)
    yield conn
    conn.close()


@pytest.fixture
def cursor(db_conn):
    """Function-scoped cursor that rolls back any mutations made during the test."""
    cur = db_conn.cursor()
    yield cur
    db_conn.rollback()


def create_test_seed_hierarchy(cursor):
    """Helper creating a valid base order with two sequential stages and an open case."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)

    # 1. User (Seller owner)
    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Seller User {uid}", f"seller_{uid}@test.com", "hash_pw"
    )
    seller_user_id = cursor.fetchone()[0]

    # 2. User (Customer)
    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Customer User {uid}", f"customer_{uid}@test.com", "hash_pw"
    )
    customer_user_id = cursor.fetchone()[0]

    # 3. Seller
    cursor.execute(
        "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
        seller_user_id, f"Biz {uid}"
    )
    seller_id = cursor.fetchone()[0]

    # 4. Order
    cursor.execute(
        """
        INSERT INTO dbo.orders (
            seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
        )
        OUTPUT INSERTED.order_id
        VALUES (?, ?, ?, ?, ?, 'PROCESSING');
        """,
        seller_id, customer_user_id, f"ORD-{uid}", now, now + timedelta(days=3)
    )
    order_id = cursor.fetchone()[0]

    # 5. Stages
    cursor.execute(
        """
        INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status, actual_start_at, actual_end_at)
        OUTPUT INSERTED.stage_id
        VALUES (?, 'SELLER_PROCESSING', 1, 'COMPLETED', ?, ?);
        """,
        order_id, now, now + timedelta(hours=6)
    )
    stage1_id = cursor.fetchone()[0]

    cursor.execute(
        """
        INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status, actual_start_at, actual_end_at)
        OUTPUT INSERTED.stage_id
        VALUES (?, 'DISPATCH', 2, 'IN_PROGRESS', ?, ?);
        """,
        order_id, now + timedelta(hours=6), now + timedelta(hours=10)
    )
    stage2_id = cursor.fetchone()[0]

    # 6. Decision Case
    cursor.execute(
        """
        INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status)
        OUTPUT INSERTED.case_id
        VALUES (?, ?, 'Delay Investigation', 'OPEN');
        """,
        order_id, seller_user_id
    )
    case_id = cursor.fetchone()[0]

    return {
        "seller_user_id": seller_user_id,
        "customer_user_id": customer_user_id,
        "seller_id": seller_id,
        "order_id": order_id,
        "stage1_id": stage1_id,
        "stage2_id": stage2_id,
        "case_id": case_id,
    }


# ============================================================================
# 1. All 18 Relational Tables Creation
# ============================================================================
def test_all_18_tables_exist(cursor):
    """Requirement 1: Verify all 18 tables exist in Microsoft SQL Server."""
    expected_tables = {
        "users", "roles", "user_roles", "sellers", "orders",
        "order_stages", "order_events", "evidence", "decision_cases",
        "delay_edges", "interventions", "scenarios", "scenario_interventions",
        "decisions", "verifications", "audit_log", "outbox_events", "analysis_jobs"
    }
    cursor.execute("SELECT name FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo');")
    found_tables = {row[0] for row in cursor.fetchall()}
    missing = expected_tables - found_tables
    assert not missing, f"Missing tables in SQL Server: {missing}"


# ============================================================================
# 2. Primary Key Enforcement
# ============================================================================
def test_primary_key_enforcement(cursor):
    """Requirement 2: Verify duplicate primary key insertion is strictly rejected."""
    cursor.execute("SELECT TOP 1 role_id, role_name FROM dbo.roles;")
    existing = cursor.fetchone()
    assert existing is not None

    with pytest.raises(pyodbc.IntegrityError):
        # Attempt inserting explicit duplicate identity / PK
        cursor.execute("SET IDENTITY_INSERT dbo.roles ON;")
        cursor.execute("INSERT INTO dbo.roles (role_id, role_name) VALUES (?, 'DUPLICATE_ROLE');", existing[0])


# ============================================================================
# 3. Foreign Key Enforcement
# ============================================================================
def test_foreign_key_enforcement(cursor):
    """Requirement 3: Verify foreign key enforcement rejects invalid references."""
    non_existent_seller_id = 999999999
    now = datetime.now(timezone.utc)
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.orders (seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at)
            VALUES (?, 1, 'ORD-INVALID-FK', ?, ?);
            """,
            non_existent_seller_id, now, now + timedelta(days=2)
        )
    assert "FK_orders_seller" in str(exc_info.value)


# ============================================================================
# 4. Composite Foreign Key Integrity
# ============================================================================
def test_composite_foreign_key_integrity(cursor):
    """Requirement 4: Verify composite foreign key on order_events enforces (order_id, stage_id)."""
    h = create_test_seed_hierarchy(cursor)
    now = datetime.now(timezone.utc)

    # Valid composite reference
    cursor.execute(
        """
        INSERT INTO dbo.order_events (order_id, stage_id, event_type, occurred_at, source_type, idempotency_key)
        VALUES (?, ?, 'PACKAGE_SCANNED', ?, 'SYSTEM', 'valid-event-key-1');
        """,
        h["order_id"], h["stage1_id"], now
    )
    assert cursor.rowcount == 1

    # Invalid composite reference: stage1_id with an arbitrary mismatched order_id
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.order_events (order_id, stage_id, event_type, occurred_at, source_type, idempotency_key)
            VALUES (?, ?, 'PACKAGE_SCANNED', ?, 'SYSTEM', 'invalid-event-key-2');
            """,
            h["order_id"] + 999, h["stage1_id"], now
        )
    assert "FK_order_events_order_stage" in str(exc_info.value) or "FK_order_events_order" in str(exc_info.value)


# ============================================================================
# 5. NOT NULL Constraints
# ============================================================================
def test_not_null_constraints(cursor):
    """Requirement 5: Verify NOT NULL constraint enforcement."""
    with pytest.raises(pyodbc.IntegrityError):
        cursor.execute("INSERT INTO dbo.users (full_name, email, password_hash) VALUES (NULL, 'null@test.com', 'p');")


# ============================================================================
# 6. UNIQUE Constraints
# ============================================================================
def test_unique_constraints(cursor):
    """Requirement 6: Verify UNIQUE constraint enforcement on users(email)."""
    uid = uuid.uuid4().hex[:8]
    email = f"uniq_{uid}@test.com"
    cursor.execute("INSERT INTO dbo.users (full_name, email, password_hash) VALUES ('User 1', ?, 'p');", email)

    with pytest.raises(pyodbc.IntegrityError):
        cursor.execute("INSERT INTO dbo.users (full_name, email, password_hash) VALUES ('User 2', ?, 'p');", email)


# ============================================================================
# 7. CHECK Constraints
# ============================================================================
def test_check_constraints(cursor):
    """Requirement 7: Verify CHECK constraint rejects delivery window where expected <= placed."""
    h = create_test_seed_hierarchy(cursor)
    now = datetime.now(timezone.utc)
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.orders (seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at)
            VALUES (?, ?, 'ORD-BAD-WINDOW', ?, ?);
            """,
            h["seller_id"], h["customer_user_id"], now, now - timedelta(hours=1)
        )
    assert "CK_orders_delivery_window" in str(exc_info.value)


# ============================================================================
# 8. Analysis Job Type Combinations (CK_analysis_jobs_type_deps)
# ============================================================================
def test_analysis_job_type_combinations(cursor):
    """Requirement 8: Verify analysis_jobs CHECK constraint dependencies."""
    h = create_test_seed_hierarchy(cursor)
    uid = uuid.uuid4().hex[:6]

    # Valid: TIMELINE_RECONSTRUCTION requires case_id NULL and decision_id NULL
    cursor.execute(
        """
        INSERT INTO dbo.analysis_jobs (order_id, case_id, decision_id, job_type, status, idempotency_key)
        VALUES (?, NULL, NULL, 'TIMELINE_RECONSTRUCTION', 'QUEUED', ?);
        """,
        h["order_id"], f"valid-job-timeline-{uid}"
    )
    assert cursor.rowcount == 1

    # Invalid: TIMELINE_RECONSTRUCTION with case_id specified
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.analysis_jobs (order_id, case_id, decision_id, job_type, status, idempotency_key)
            VALUES (?, ?, NULL, 'TIMELINE_RECONSTRUCTION', 'QUEUED', ?);
            """,
            h["order_id"], h["case_id"], f"invalid-job-timeline-{uid}"
        )
    assert "CK_analysis_jobs_type_deps" in str(exc_info.value)

    # Valid: SCENARIO_SIMULATION requires case_id NOT NULL and decision_id NULL
    cursor.execute(
        """
        INSERT INTO dbo.analysis_jobs (order_id, case_id, decision_id, job_type, status, idempotency_key)
        VALUES (?, ?, NULL, 'SCENARIO_SIMULATION', 'QUEUED', ?);
        """,
        h["order_id"], h["case_id"], f"valid-job-sim-{uid}"
    )
    assert cursor.rowcount == 1


# ============================================================================
# 9. Cross-Order Reference Rejection (Evidence)
# ============================================================================
def test_cross_order_reference_rejection(cursor):
    """Requirement 9: Verify evidence composite FK rejects linking event belonging to another order."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)
    now = datetime.now(timezone.utc)

    # Create event belonging strictly to Order 2
    cursor.execute(
        """
        INSERT INTO dbo.order_events (order_id, stage_id, event_type, occurred_at, source_type, idempotency_key)
        OUTPUT INSERTED.event_id
        VALUES (?, ?, 'DISPATCH_CONFIRMED', ?, 'COURIER_API', ?);
        """,
        h2["order_id"], h2["stage1_id"], now, f"order2-event-{uuid.uuid4().hex[:6]}"
    )
    event_order2 = cursor.fetchone()[0]

    # Attempt inserting evidence on Order 1 referencing Order 2's event
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.evidence (
                order_id, event_id, case_id, uploaded_by, blob_uri, file_name, content_type,
                sha256_hash, upload_expires_at
            )
            VALUES (?, ?, NULL, ?, 'https://blob/leak.jpg', 'leak.jpg', 'image/jpeg', 'abcd', ?);
            """,
            h1["order_id"], event_order2, h1["seller_user_id"], now + timedelta(hours=1)
        )
    assert "FK_evidence_order_event" in str(exc_info.value)


# ============================================================================
# 10. Delay Edge Self-Loop Rejection (Trigger trg_delay_edges_order_stage_integrity)
# ============================================================================
def test_delay_edge_self_loop_rejection(cursor):
    """Requirement 10: Verify delay_edges trigger throws 50010 on self-loops (from_stage == to_stage)."""
    h = create_test_seed_hierarchy(cursor)

    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.delay_edges (case_id, from_stage_id, to_stage_id, edge_type, evidence_class)
            VALUES (?, ?, ?, 'STAGE_TRANSITION', 'FACT');
            """,
            h["case_id"], h["stage1_id"], h["stage1_id"]
        )
    assert "50010" in str(exc_info.value)
    assert "cannot be identical" in str(exc_info.value)


# ============================================================================
# 11. Delay Edge Cross-Order Rejection (Trigger trg_delay_edges_order_stage_integrity)
# ============================================================================
def test_delay_edge_cross_order_rejection(cursor):
    """Requirement 11: Verify delay_edges trigger throws 50011 when stage belongs to another order."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)

    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.delay_edges (case_id, from_stage_id, to_stage_id, edge_type, evidence_class)
            VALUES (?, ?, ?, 'BOTTLENECK_PROPAGATION', 'HYPOTHESIS');
            """,
            h1["case_id"], h1["stage1_id"], h2["stage1_id"]
        )
    assert "50011" in str(exc_info.value)
    assert "Cross-order integrity violation" in str(exc_info.value)


# ============================================================================
# 12. Multi-Row Trigger Behavior
# ============================================================================
def test_multi_row_trigger_behavior(cursor):
    """Requirement 12: Verify trigger correctly validates multi-row INSERT operations."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)

    # Valid multi-row edge insertion
    cursor.execute(
        """
        INSERT INTO dbo.delay_edges (case_id, from_stage_id, to_stage_id, edge_type, evidence_class)
        VALUES
            (?, ?, ?, 'STAGE_TRANSITION', 'FACT'),
            (?, ?, ?, 'BOTTLENECK_PROPAGATION', 'ESTIMATE');
        """,
        h1["case_id"], h1["stage1_id"], h1["stage2_id"],
        h2["case_id"], h2["stage1_id"], h2["stage2_id"]
    )
    assert cursor.rowcount == 2

    # Mixed multi-row insert where 1 of 2 rows violates cross-order integrity
    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.delay_edges (case_id, from_stage_id, to_stage_id, edge_type, evidence_class)
            VALUES
                (?, ?, ?, 'STAGE_TRANSITION', 'FACT'),
                (?, ?, ?, 'BOTTLENECK_PROPAGATION', 'HYPOTHESIS');
            """,
            h1["case_id"], h1["stage1_id"], h1["stage2_id"],
            h1["case_id"], h1["stage1_id"], h2["stage1_id"]  # VIOLATION
        )
    assert "50011" in str(exc_info.value)


# ============================================================================
# 13. Immutable Parent Order References (Triggers 50012 & 50013)
# ============================================================================
def test_immutable_order_stages_parent_reference(cursor):
    """Requirement 13a: Verify trigger 50012 prevents changing order_stages.order_id."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)

    cursor.execute(
        """
        INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status)
        OUTPUT INSERTED.stage_id
        VALUES (?, 'DELIVERED', 99, 'PENDING');
        """,
        h1["order_id"]
    )
    special_stage_id = cursor.fetchone()[0]

    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            "UPDATE dbo.order_stages SET order_id = ? WHERE stage_id = ?;",
            h2["order_id"], special_stage_id
        )
    assert "50012" in str(exc_info.value)
    assert "order_stages.order_id cannot be modified" in str(exc_info.value)


def test_immutable_decision_cases_parent_reference(cursor):
    """Requirement 13b: Verify trigger 50013 prevents changing decision_cases.order_id."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)

    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            "UPDATE dbo.decision_cases SET order_id = ? WHERE case_id = ?;",
            h2["order_id"], h1["case_id"]
        )
    assert "50013" in str(exc_info.value)
    assert "decision_cases.order_id cannot be modified" in str(exc_info.value)


# ============================================================================
# 14. Computed Column Correctness (verifications)
# ============================================================================
def test_computed_column_correctness(cursor):
    """Requirement 14: Verify SQL Server PERSISTED computed columns in verifications."""
    h = create_test_seed_hierarchy(cursor)

    # Create Scenario
    cursor.execute(
        """
        INSERT INTO dbo.scenarios (case_id, scenario_name, risk_level, predicted_time_saved_minutes)
        OUTPUT INSERTED.scenario_id
        VALUES (?, 'Test Scenario', 'LOW', 120);
        """,
        h["case_id"]
    )
    scenario_id = cursor.fetchone()[0]

    # Create Decision
    cursor.execute(
        """
        INSERT INTO dbo.decisions (case_id, scenario_id, decided_by, decision_status)
        OUTPUT INSERTED.decision_id
        VALUES (?, ?, ?, 'APPROVED');
        """,
        h["case_id"], scenario_id, h["seller_user_id"]
    )
    decision_id = cursor.fetchone()[0]

    original_expected = datetime(2026, 11, 10, 12, 0, 0)
    predicted_delivery = datetime(2026, 11, 10, 10, 0, 0)  # 2 hours early
    actual_delivery = datetime(2026, 11, 10, 13, 0, 0)     # 3 hours late vs predicted, 1 hour late vs expected

    cursor.execute(
        """
        INSERT INTO dbo.verifications (
            decision_id, original_expected_delivery_at, predicted_delivery_at, actual_delivery_at
        )
        OUTPUT
            INSERTED.signed_prediction_error_minutes,
            INSERTED.absolute_prediction_error_minutes,
            INSERTED.delivery_variance_minutes
        VALUES (?, ?, ?, ?);
        """,
        decision_id, original_expected, predicted_delivery, actual_delivery
    )
    signed_err, abs_err, delivery_var = cursor.fetchone()

    # DATEDIFF(MINUTE, 10:00, 13:00) = +180 minutes
    assert signed_err == 180
    assert abs_err == 180
    # DATEDIFF(MINUTE, 12:00, 13:00) = +60 minutes
    assert delivery_var == 60


# ============================================================================
# 15. Verification Uniqueness (1:0..1 Cardinality)
# ============================================================================
def test_verification_uniqueness(cursor):
    """Requirement 15: Verify UQ_verifications_decision enforces 1:0..1 cardinality per decision."""
    h = create_test_seed_hierarchy(cursor)

    cursor.execute(
        """
        INSERT INTO dbo.scenarios (case_id, scenario_name, risk_level)
        OUTPUT INSERTED.scenario_id
        VALUES (?, 'Uniq Scenario', 'LOW');
        """,
        h["case_id"]
    )
    scenario_id = cursor.fetchone()[0]

    cursor.execute(
        """
        INSERT INTO dbo.decisions (case_id, scenario_id, decided_by)
        OUTPUT INSERTED.decision_id
        VALUES (?, ?, ?);
        """,
        h["case_id"], scenario_id, h["seller_user_id"]
    )
    decision_id = cursor.fetchone()[0]
    now = datetime.now(timezone.utc)

    # Insert first verification
    cursor.execute(
        """
        INSERT INTO dbo.verifications (
            decision_id, original_expected_delivery_at, predicted_delivery_at, actual_delivery_at
        )
        VALUES (?, ?, ?, ?);
        """,
        decision_id, now, now, now
    )

    # Attempt inserting second verification for identical decision_id
    with pytest.raises(pyodbc.IntegrityError) as exc_info:
        cursor.execute(
            """
            INSERT INTO dbo.verifications (
                decision_id, original_expected_delivery_at, predicted_delivery_at, actual_delivery_at
            )
            VALUES (?, ?, ?, ?);
            """,
            decision_id, now, now, now
        )
    assert "UQ_verifications_decision" in str(exc_info.value)


# ============================================================================
# 16. Migration Upgrade & Status
# ============================================================================
def test_migration_upgrade_and_status(cursor):
    """Requirement 16: Verify migration runner accurately ledgered all applied migrations."""
    runner = MigrationRunner()
    status_list = runner.status()
    versions = {item["version"]: item["status"] for item in status_list}
    assert versions.get("V001") == "APPLIED"
    assert versions.get("V002") == "APPLIED"
    assert versions.get("V003") == "APPLIED"
    assert versions.get("V004") == "APPLIED"
    assert versions.get("V005") == "APPLIED"


# ============================================================================
# 17. Migration Rollback and Re-Application
# ============================================================================
def test_migration_rollback_and_reapply():
    """Requirement 17: Verify latest migration rollback and re-application operations execute cleanly."""
    runner = MigrationRunner()

    # Roll back latest migration
    rolled_back = runner.rollback()
    assert rolled_back in ("V003", "V004", "V005")

    # Re-apply latest migration
    applied = runner.migrate()
    assert rolled_back in applied


# ============================================================================
# 19. Stored Procedures & Analytical Views
# ============================================================================
def test_stored_procedures_workflow(cursor):
    """Requirement 19: Verify stored procedures execution workflow."""
    h = create_test_seed_hierarchy(cursor)

    # 1. usp_CreateDecisionCase
    cursor.execute(
        """
        DECLARE @NewCaseId BIGINT;
        EXEC dbo.usp_CreateDecisionCase
            @OrderId = ?,
            @CreatedBy = ?,
            @CaseTitle = 'Automated SP Case',
            @NewCaseId = @NewCaseId OUTPUT;
        SELECT @NewCaseId;
        """,
        h["order_id"], h["seller_user_id"]
    )
    new_case_id = cursor.fetchone()[0]
    assert new_case_id is not None

    # Verify outbox event was generated by procedure
    cursor.execute("SELECT COUNT(*) FROM dbo.outbox_events WHERE aggregate_type = 'ANALYSIS_JOB';")
    assert cursor.fetchone()[0] >= 1

    # Insert scenario
    cursor.execute(
        """
        INSERT INTO dbo.scenarios (case_id, scenario_name, risk_level, predicted_time_saved_minutes)
        OUTPUT INSERTED.scenario_id
        VALUES (?, 'SP Scenario', 'LOW', 60);
        """,
        new_case_id
    )
    scenario_id = cursor.fetchone()[0]

    # 2. usp_RecordDecision
    cursor.execute(
        """
        DECLARE @NewDecisionId BIGINT;
        EXEC dbo.usp_RecordDecision
            @CaseId = ?,
            @ScenarioId = ?,
            @DecidedBy = ?,
            @Rationale = 'Test Decision',
            @NewDecisionId = @NewDecisionId OUTPUT;
        SELECT @NewDecisionId;
        """,
        new_case_id, scenario_id, h["seller_user_id"]
    )
    new_decision_id = cursor.fetchone()[0]
    assert new_decision_id is not None

    # 3. usp_ApproveDecision
    cursor.execute(
        "EXEC dbo.usp_ApproveDecision @DecisionId = ?, @ManagerUserId = ?;",
        new_decision_id, h["seller_user_id"]
    )
    cursor.execute("SELECT decision_status, approved_by FROM dbo.decisions WHERE decision_id = ?;", new_decision_id)
    status, approver = cursor.fetchone()
    assert status == "APPROVED"
    assert approver == h["seller_user_id"]

    # 4. usp_VerifyPrediction
    actual_delivery = datetime.now(timezone.utc) + timedelta(days=2)
    cursor.execute(
        "EXEC dbo.usp_VerifyPrediction @DecisionId = ?, @ActualDeliveryAt = ?, @OutcomeNotes = 'Delivered early';",
        new_decision_id, actual_delivery
    )
    cursor.execute("SELECT decision_status FROM dbo.decisions WHERE decision_id = ?;", new_decision_id)
    assert cursor.fetchone()[0] == "EXECUTED"

    cursor.execute("SELECT COUNT(*) FROM dbo.verifications WHERE decision_id = ?;", new_decision_id)
    assert cursor.fetchone()[0] == 1


def test_analytical_views(cursor):
    """Requirement 20: Verify analytical views return valid records without error."""
    create_test_seed_hierarchy(cursor)

    cursor.execute("SELECT COUNT(*) FROM dbo.vw_SellerDelaySummary;")
    assert cursor.fetchone()[0] >= 1

    cursor.execute("SELECT COUNT(*) FROM dbo.vw_OrderStageDelayBreakdown;")
    assert cursor.fetchone()[0] >= 1


# ============================================================================
# 21. Analytical View Enhancements (M1-02 & M1-03)
# ============================================================================
def test_seller_delay_summary_column_naming(cursor):
    """M1-02: Verify vw_SellerDelaySummary exposes the approved column avg_excess_delay_hours."""
    cursor.execute("SELECT TOP 1 avg_excess_delay_hours FROM dbo.vw_SellerDelaySummary;")
    # Successfully executing the query confirms the column exists
    assert True


def test_seller_zero_orders_returns_null_delay(cursor):
    """M1-03: Verify seller with zero order records returns NULL for avg_excess_delay_hours."""
    uid = uuid.uuid4().hex[:8]
    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Seller Zero {uid}", f"zero_{uid}@test.com", "hash_pw"
    )
    user_id = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
        user_id, f"Zero Orders Biz {uid}"
    )
    seller_id = cursor.fetchone()[0]

    cursor.execute(
        """
        SELECT total_orders, delayed_orders, avg_fulfillment_hours, avg_excess_delay_hours
        FROM dbo.vw_SellerDelaySummary
        WHERE seller_id = ?;
        """,
        seller_id
    )
    row = cursor.fetchone()
    assert row is not None
    total_orders, delayed_orders, avg_fulfillment, avg_excess_delay = row
    assert total_orders == 0
    assert delayed_orders == 0
    assert avg_fulfillment is None
    assert avg_excess_delay is None


def test_seller_on_time_orders_returns_zero_delay(cursor):
    """M1-03: Verify seller with on-time delivered orders returns genuine 0.00 excess delay."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)

    # 1. User & Seller
    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Seller OnTime {uid}", f"ontime_{uid}@test.com", "hash_pw"
    )
    user_id = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
        user_id, f"OnTime Biz {uid}"
    )
    seller_id = cursor.fetchone()[0]

    # 2. Customer
    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Cust OnTime {uid}", f"cust_ontime_{uid}@test.com", "hash_pw"
    )
    cust_id = cursor.fetchone()[0]

    # 3. Order delivered 2 hours BEFORE expected delivery time (genuine zero excess delay)
    expected = now + timedelta(days=2)
    actual = expected - timedelta(hours=2)
    cursor.execute(
        """
        INSERT INTO dbo.orders (
            seller_id, customer_user_id, external_order_ref, placed_at,
            expected_delivery_at, actual_delivery_at, status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'DELIVERED');
        """,
        seller_id, cust_id, f"ORD-ONTIME-{uid}", now, expected, actual
    )

    cursor.execute(
        """
        SELECT total_orders, delayed_orders, avg_excess_delay_hours
        FROM dbo.vw_SellerDelaySummary
        WHERE seller_id = ?;
        """,
        seller_id
    )
    row = cursor.fetchone()
    assert row is not None
    total_orders, delayed_orders, avg_excess = row
    assert total_orders == 1
    assert delayed_orders == 0
    assert float(avg_excess) == 0.00


def test_seller_delayed_orders_returns_positive_delay(cursor):
    """M1-03: Verify seller with delayed orders accurately calculates positive excess delay."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)

    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Seller Late {uid}", f"late_{uid}@test.com", "hash_pw"
    )
    user_id = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
        user_id, f"Late Biz {uid}"
    )
    seller_id = cursor.fetchone()[0]

    cursor.execute(
        "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
        f"Cust Late {uid}", f"cust_late_{uid}@test.com", "hash_pw"
    )
    cust_id = cursor.fetchone()[0]

    # Order delivered 3 hours AFTER expected delivery time (180 minutes excess delay = 3.00 hours)
    expected = now + timedelta(days=2)
    actual = expected + timedelta(hours=3)
    cursor.execute(
        """
        INSERT INTO dbo.orders (
            seller_id, customer_user_id, external_order_ref, placed_at,
            expected_delivery_at, actual_delivery_at, status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'DELAYED');
        """,
        seller_id, cust_id, f"ORD-LATE-{uid}", now, expected, actual
    )

    cursor.execute(
        """
        SELECT total_orders, delayed_orders, avg_excess_delay_hours
        FROM dbo.vw_SellerDelaySummary
        WHERE seller_id = ?;
        """,
        seller_id
    )
    row = cursor.fetchone()
    assert row is not None
    total_orders, delayed_orders, avg_excess = row
    assert total_orders == 1
    assert delayed_orders == 1
    assert float(avg_excess) == 3.00


# ============================================================================
# 22. Stored Procedure Negative / Error Code Tests (M1-04)
# ============================================================================
def test_usp_create_decision_case_invalid_order_50001(cursor):
    """M1-04: Verify usp_CreateDecisionCase throws 50001 when order_id does not exist."""
    invalid_order_id = 999999999
    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            """
            DECLARE @NewCaseId BIGINT;
            EXEC dbo.usp_CreateDecisionCase
                @OrderId = ?,
                @CreatedBy = 1,
                @CaseTitle = 'Invalid Order Case',
                @NewCaseId = @NewCaseId OUTPUT;
            """,
            invalid_order_id
        )
    assert "50001" in str(exc_info.value)
    assert "Invalid order_id specified" in str(exc_info.value)

    # Verify no partial rows created in decision_cases or outbox_events
    cursor.execute("SELECT COUNT(*) FROM dbo.decision_cases WHERE case_title = 'Invalid Order Case';")
    assert cursor.fetchone()[0] == 0


def test_usp_approve_decision_non_pending_50003(cursor):
    """M1-04: Verify usp_ApproveDecision throws 50003 when decision is not in PENDING status."""
    h = create_test_seed_hierarchy(cursor)

    # Create Scenario and Decision
    cursor.execute(
        """
        INSERT INTO dbo.scenarios (case_id, scenario_name, risk_level)
        OUTPUT INSERTED.scenario_id
        VALUES (?, 'Approval Test Scenario', 'LOW');
        """,
        h["case_id"]
    )
    scenario_id = cursor.fetchone()[0]

    cursor.execute(
        """
        INSERT INTO dbo.decisions (case_id, scenario_id, decided_by, decision_status)
        OUTPUT INSERTED.decision_id
        VALUES (?, ?, ?, 'APPROVED');
        """,
        h["case_id"], scenario_id, h["seller_user_id"]
    )
    already_approved_decision_id = cursor.fetchone()[0]

    # Attempt to approve already approved decision
    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            "EXEC dbo.usp_ApproveDecision @DecisionId = ?, @ManagerUserId = ?;",
            already_approved_decision_id, h["seller_user_id"]
        )
    assert "50003" in str(exc_info.value)
    assert "Decision not in PENDING state or does not exist" in str(exc_info.value)

    # Attempt to approve non-existent decision
    non_existent_decision_id = 999999999
    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            "EXEC dbo.usp_ApproveDecision @DecisionId = ?, @ManagerUserId = ?;",
            non_existent_decision_id, h["seller_user_id"]
        )
    assert "50003" in str(exc_info.value)


def test_usp_record_decision_mismatched_scenario_50004(cursor):
    """M1-04: Verify usp_RecordDecision throws 50004 when scenario does not belong to case."""
    h1 = create_test_seed_hierarchy(cursor)
    h2 = create_test_seed_hierarchy(cursor)

    # Create Scenario under Case 2
    cursor.execute(
        """
        INSERT INTO dbo.scenarios (case_id, scenario_name, risk_level)
        OUTPUT INSERTED.scenario_id
        VALUES (?, 'Scenario Belonging to Case 2', 'MEDIUM');
        """,
        h2["case_id"]
    )
    scenario_case2_id = cursor.fetchone()[0]

    # Attempt to record decision for Case 1 using Scenario 2
    with pytest.raises(pyodbc.ProgrammingError) as exc_info:
        cursor.execute(
            """
            DECLARE @NewDecisionId BIGINT;
            EXEC dbo.usp_RecordDecision
                @CaseId = ?,
                @ScenarioId = ?,
                @DecidedBy = ?,
                @Rationale = 'Cross-case assignment test',
                @NewDecisionId = @NewDecisionId OUTPUT;
            """,
            h1["case_id"], scenario_case2_id, h1["seller_user_id"]
        )
    assert "50004" in str(exc_info.value)
    assert "Scenario does not belong to the specified decision case" in str(exc_info.value)

    # Verify no partial decision row created
    cursor.execute(
        "SELECT COUNT(*) FROM dbo.decisions WHERE case_id = ? AND scenario_id = ?;",
        h1["case_id"], scenario_case2_id
    )
    assert cursor.fetchone()[0] == 0
