"""Tests for Decision Governance, Approval Lifecycle, and Prediction Verification Engine."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.database.connection import get_db_connection
from app.services.decision_service import DecisionService


@pytest.fixture
def seed_decision_env():
    """Create test environment with users, order, case, and scenario."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=2)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # Users
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Analyst {uid}", f"analyst_{uid}@decision-test.com", "hash_pw",
        )
        analyst_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Manager {uid}", f"mgr_{uid}@decision-test.com", "hash_pw",
        )
        manager_user_id = cur.fetchone()[0]

        # Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            analyst_user_id, f"Decision Biz {uid}",
        )
        seller_id = cur.fetchone()[0]

        # Order (expected delivery in 3 days)
        expected_delivery = now + timedelta(days=3)
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, analyst_user_id, f"ORD-DEC-{uid}", now, expected_delivery,
        )
        order_id = cur.fetchone()[0]

        # Decision Case
        cur.execute(
            """
            INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
            OUTPUT INSERTED.case_id
            VALUES (?, ?, ?, 'ANALYZING', SYSUTCDATETIME());
            """,
            order_id, analyst_user_id, f"Decision Case for #{order_id}",
        )
        case_id = cur.fetchone()[0]

        # Scenario
        cur.execute(
            """
            INSERT INTO dbo.scenarios (
                case_id, scenario_name, status, predicted_time_saved_minutes,
                estimated_cost, risk_level, confidence_score
            )
            OUTPUT INSERTED.scenario_id
            VALUES (?, ?, 'READY', 360, 45.00, 'MEDIUM', 0.7500);
            """,
            case_id, "Carrier Expedite Scenario",
        )
        scenario_id = cur.fetchone()[0]

        conn.commit()

    yield {
        "order_id": order_id,
        "case_id": case_id,
        "scenario_id": scenario_id,
        "analyst_user_id": analyst_user_id,
        "manager_user_id": manager_user_id,
        "expected_delivery_at": expected_delivery,
        "uid": uid,
    }

    # Teardown
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            DELETE FROM dbo.audit_log
            WHERE entity_type IN ('ORDER', 'DECISION_CASE', 'DECISION') AND entity_id IN (?, ?);
            """,
            (order_id, case_id),
        )
        cur.execute("DELETE FROM dbo.audit_log WHERE actor_user_id IN (?, ?);", (analyst_user_id, manager_user_id))
        cur.execute(
            """
            DELETE FROM dbo.verifications
            WHERE decision_id IN (SELECT decision_id FROM dbo.decisions WHERE case_id = ?);
            """,
            case_id,
        )
        cur.execute("DELETE FROM dbo.decisions WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.scenarios WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.decision_cases WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.orders WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", (analyst_user_id, manager_user_id))
        conn.commit()


def test_record_and_approve_decision(seed_decision_env):
    """Test recording a decision via stored procedure, followed by approval and case closure."""
    case_id = seed_decision_env["case_id"]
    scenario_id = seed_decision_env["scenario_id"]
    analyst_id = seed_decision_env["analyst_user_id"]
    manager_id = seed_decision_env["manager_user_id"]

    service = DecisionService()

    # 1. Record decision
    decision = service.record_decision(
        case_id=case_id,
        scenario_id=scenario_id,
        decided_by=analyst_id,
        rationale="Expedited ground transit recovers projected 6 hours of linehaul buffer.",
    )

    assert decision["decision_id"] is not None
    assert decision["decision_status"] == "PENDING"
    assert decision["case_id"] == case_id
    decision_id = decision["decision_id"]

    # Verify case status moved to PENDING_APPROVAL
    case = service.delay_repo.get_case_by_id(case_id)
    assert case["status"] == "PENDING_APPROVAL"

    # 2. Approve decision
    approved = service.approve_decision(decision_id=decision_id, manager_user_id=manager_id)
    assert approved["decision_status"] == "APPROVED"
    assert approved["approved_by"] == manager_id

    # Verify case closed
    closed_case = service.delay_repo.get_case_by_id(case_id)
    assert closed_case["status"] == "CLOSED"


def test_record_and_reject_decision(seed_decision_env):
    """Test recording a decision followed by manager rejection and case reopening."""
    case_id = seed_decision_env["case_id"]
    scenario_id = seed_decision_env["scenario_id"]
    analyst_id = seed_decision_env["analyst_user_id"]
    manager_id = seed_decision_env["manager_user_id"]

    service = DecisionService()
    decision = service.record_decision(
        case_id=case_id,
        scenario_id=scenario_id,
        decided_by=analyst_id,
        rationale="Proposed ground expedite.",
    )
    decision_id = decision["decision_id"]

    rejected = service.reject_decision(
        decision_id=decision_id,
        manager_user_id=manager_id,
        rejection_reason="Excessive cost relative to consignment margin.",
    )

    assert rejected["decision_status"] == "REJECTED"
    assert "Rejection" in rejected["rationale"]

    # Verify case returned to ANALYZING
    case = service.delay_repo.get_case_by_id(case_id)
    assert case["status"] == "ANALYZING"


def test_outcome_verification_and_variance_calculation(seed_decision_env):
    """Test outcome verification against actual delivery and mathematical variance computation."""
    case_id = seed_decision_env["case_id"]
    scenario_id = seed_decision_env["scenario_id"]
    analyst_id = seed_decision_env["analyst_user_id"]
    manager_id = seed_decision_env["manager_user_id"]
    expected_delivery = seed_decision_env["expected_delivery_at"]

    service = DecisionService()
    decision = service.record_decision(
        case_id=case_id,
        scenario_id=scenario_id,
        decided_by=analyst_id,
        rationale="Expedited freight.",
    )
    decision_id = decision["decision_id"]
    service.approve_decision(decision_id=decision_id, manager_user_id=manager_id)

    # Actual delivery occurred 2 hours later than predicted (120 minutes signed error)
    # Scenario predicted_time_saved_minutes was 360 (6 hours)
    actual_delivery = expected_delivery - timedelta(hours=4)  # Saved 4 hours instead of 6 hours

    verification = service.verify_prediction(
        decision_id=decision_id,
        actual_delivery_at=actual_delivery,
        outcome_notes="Consignment delivered with 4h net savings.",
    )

    assert verification["verification_id"] is not None
    assert verification["decision_id"] == decision_id
    assert verification["signed_prediction_error_minutes"] == 120
    assert verification["absolute_prediction_error_minutes"] == 120
    assert verification["delivery_variance_minutes"] == -240  # 4h early vs original SLA


def test_decisions_api_endpoints(client, seed_decision_env):
    """Test decisions REST API endpoints."""
    case_id = seed_decision_env["case_id"]
    scenario_id = seed_decision_env["scenario_id"]
    analyst_id = seed_decision_env["analyst_user_id"]
    manager_id = seed_decision_env["manager_user_id"]
    expected_delivery = seed_decision_env["expected_delivery_at"]

    # 1. POST /cases/<case_id>/decisions
    res_record = client.post(
        f"/api/v1/cases/{case_id}/decisions",
        json={
            "scenario_id": scenario_id,
            "decided_by": analyst_id,
            "rationale": "API test decision rationale.",
        },
    )
    assert res_record.status_code == 201
    dec_data = res_record.get_json()["data"]
    decision_id = dec_data["decision_id"]
    assert decision_id is not None
    assert dec_data["decision_status"] == "PENDING"

    # 2. GET /decisions/<id>
    res_get = client.get(f"/api/v1/decisions/{decision_id}")
    assert res_get.status_code == 200
    assert res_get.get_json()["data"]["decision_id"] == decision_id

    # 3. POST /decisions/<id>/approve
    res_app = client.post(
        f"/api/v1/decisions/{decision_id}/approve",
        json={"manager_user_id": manager_id},
    )
    assert res_app.status_code == 200
    assert res_app.get_json()["data"]["decision_status"] == "APPROVED"

    # 4. POST /decisions/<id>/verify
    actual_dt_str = (expected_delivery - timedelta(hours=3)).isoformat()
    res_ver = client.post(
        f"/api/v1/decisions/{decision_id}/verify",
        json={
            "actual_delivery_at": actual_dt_str,
            "outcome_notes": "Delivered successfully.",
        },
    )
    assert res_ver.status_code == 200
    ver_data = res_ver.get_json()["data"]
    assert ver_data["decision_id"] == decision_id
    assert ver_data["signed_prediction_error_minutes"] is not None

    # 5. GET /decisions/<id>/verification
    res_get_ver = client.get(f"/api/v1/decisions/{decision_id}/verification")
    assert res_get_ver.status_code == 200
    assert res_get_ver.get_json()["data"]["decision_id"] == decision_id
