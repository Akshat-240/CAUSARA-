"""Tests for Intervention Discovery & Scenario Simulation Engine."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.database.connection import get_db_connection
from app.services.intervention_service import InterventionService
from app.services.scenario_service import ScenarioService


@pytest.fixture
def seed_scenario_order():
    """Create test order hierarchy with decision case for scenario testing."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=2)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # Users
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller {uid}", f"seller_{uid}@scen-test.com", "hash_pw",
        )
        seller_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer {uid}", f"cust_{uid}@scen-test.com", "hash_pw",
        )
        customer_user_id = cur.fetchone()[0]

        # Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Scenario Biz {uid}",
        )
        seller_id = cur.fetchone()[0]

        # Order
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, f"ORD-SCEN-{uid}", now, now + timedelta(days=3),
        )
        order_id = cur.fetchone()[0]

        stages = [
            ("SELLER_PROCESSING", 1, now, now + timedelta(hours=8)),
            ("DISPATCH", 2, now + timedelta(hours=8), now + timedelta(hours=14)),
            ("LINEHAUL_TRANSPORT", 3, now + timedelta(hours=14), now + timedelta(hours=48)),
            ("LAST_MILE", 4, now + timedelta(hours=48), now + timedelta(hours=60)),
            ("DELIVERED", 5, now + timedelta(hours=60), now + timedelta(hours=72)),
        ]
        stage_ids = {}
        for code, seq, p_start, p_end in stages:
            cur.execute(
                """
                INSERT INTO dbo.order_stages (
                    order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status
                )
                OUTPUT INSERTED.stage_id
                VALUES (?, ?, ?, ?, ?, 'PENDING');
                """,
                order_id, code, seq, p_start, p_end,
            )
            stage_ids[code] = cur.fetchone()[0]

        # Create decision case
        cur.execute(
            """
            INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
            OUTPUT INSERTED.case_id
            VALUES (?, ?, ?, 'ANALYZING', SYSUTCDATETIME());
            """,
            order_id, seller_user_id, f"Case for #{order_id}",
        )
        case_id = cur.fetchone()[0]
        conn.commit()

    yield {
        "order_id": order_id,
        "case_id": case_id,
        "seller_id": seller_id,
        "seller_user_id": seller_user_id,
        "customer_user_id": customer_user_id,
        "stage_ids": stage_ids,
        "base_time": now,
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
        cur.execute("DELETE FROM dbo.audit_log WHERE actor_user_id IN (?, ?);", (seller_user_id, customer_user_id))
        cur.execute(
            """
            DELETE FROM dbo.scenario_interventions
            WHERE scenario_id IN (SELECT scenario_id FROM dbo.scenarios WHERE case_id = ?);
            """,
            case_id,
        )
        cur.execute("DELETE FROM dbo.decisions WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.scenarios WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.delay_edges WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.evidence WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.decision_cases WHERE case_id = ?;", case_id)
        cur.execute("DELETE FROM dbo.analysis_jobs WHERE order_id = ?;", order_id)
        cur.execute(
            """
            DELETE FROM dbo.outbox_events
            WHERE aggregate_type = 'ORDER_EVENT'
              AND aggregate_id IN (SELECT event_id FROM dbo.order_events WHERE order_id = ?);
            """,
            order_id,
        )
        cur.execute("DELETE FROM dbo.order_events WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.order_stages WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.orders WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", (seller_user_id, customer_user_id))
        conn.commit()


def _insert_event(order_id: int, stage_id: int, event_type: str, occurred_at: datetime):
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, source_type, occurred_at, received_at,
                idempotency_key, description
            )
            OUTPUT INSERTED.event_id
            VALUES (?, ?, ?, 'SYSTEM', ?, ?, ?, 'Test event');
            """,
            order_id, stage_id, event_type, occurred_at, occurred_at, uuid.uuid4().hex,
        )
        event_id = cur.fetchone()[0]
        conn.commit()
        return event_id


def test_intervention_discovery(seed_scenario_order):
    """Verify that delay points discover appropriate candidate interventions."""
    order_id = seed_scenario_order["order_id"]
    case_id = seed_scenario_order["case_id"]
    t0 = seed_scenario_order["base_time"]
    stage_ids = seed_scenario_order["stage_ids"]

    # Introduce a 20h delay in SELLER_PROCESSING (planned was 8h)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=28))
    # DISPATCH starts
    _insert_event(order_id, stage_ids["DISPATCH"], "DISPATCH_INITIATED", t0 + timedelta(hours=28))

    service = InterventionService()
    candidates = service.discover_candidate_interventions(case_id)

    assert len(candidates) >= 1
    codes = [c.intervention_code for c in candidates]
    assert "PRIORITY_PACKING" in codes
    assert "CUSTOMER_PROACTIVE_NOTICE" in codes

    packing_cand = next(c for c in candidates if c.intervention_code == "PRIORITY_PACKING")
    assert packing_cand.expected_time_saved_minutes > 0
    assert packing_cand.estimated_cost > 0
    assert packing_cand.risk_level == "LOW"


def test_simulate_scenario(seed_scenario_order):
    """Test custom scenario simulation with metrics calculations and intervention linking."""
    order_id = seed_scenario_order["order_id"]
    case_id = seed_scenario_order["case_id"]
    t0 = seed_scenario_order["base_time"]
    stage_ids = seed_scenario_order["stage_ids"]

    # Introduce delay in stage 1
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=28))
    _insert_event(order_id, stage_ids["DISPATCH"], "DISPATCH_INITIATED", t0 + timedelta(hours=28))

    service = ScenarioService()
    candidates = service.intervention_service.discover_candidate_interventions(case_id)
    candidate_ids = [c.intervention_id for c in candidates][:2] or [1, 5]

    scenario = service.simulate_scenario(
        case_id=case_id,
        scenario_name="Fast Track Priority Packaging",
        intervention_ids=candidate_ids,
        assumptions=["Staff assigned to priority packaging queue."],
    )

    assert scenario["scenario_id"] is not None
    assert scenario["case_id"] == case_id
    assert scenario["status"] == "READY"
    assert scenario["predicted_time_saved_minutes"] is not None
    assert scenario["estimated_cost"] >= 0.0
    assert scenario["risk_level"] in ("LOW", "MEDIUM", "HIGH")
    assert 0.0 <= scenario["confidence_score"] <= 1.0
    assert len(scenario["interventions"]) == len(candidate_ids)


def test_auto_generate_scenarios(seed_scenario_order):
    """Test automatic multi-scenario generation for side-by-side evaluation."""
    order_id = seed_scenario_order["order_id"]
    case_id = seed_scenario_order["case_id"]
    t0 = seed_scenario_order["base_time"]
    stage_ids = seed_scenario_order["stage_ids"]

    # Cause linehaul delay (>12h excess duration)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=8))
    _insert_event(order_id, stage_ids["DISPATCH"], "CARRIER_RECEIVED", t0 + timedelta(hours=14))
    _insert_event(order_id, stage_ids["LINEHAUL_TRANSPORT"], "IN_TRANSIT", t0 + timedelta(hours=14))
    _insert_event(order_id, stage_ids["LINEHAUL_TRANSPORT"], "ARRIVED_AT_HUB", t0 + timedelta(hours=70))

    service = ScenarioService()
    scenarios = service.auto_generate_scenarios_for_case(case_id)

    assert len(scenarios) >= 1
    for sc in scenarios:
        assert sc["case_id"] == case_id
        assert sc["predicted_time_saved_minutes"] is not None
        assert sc["risk_level"] in ("LOW", "MEDIUM", "HIGH")


def test_scenario_api_endpoints(client, seed_scenario_order):
    """Test scenario REST API routes."""
    case_id = seed_scenario_order["case_id"]

    # 1. GET /cases/<case_id>/interventions
    res_cand = client.get(f"/api/v1/cases/{case_id}/interventions")
    assert res_cand.status_code == 200
    cand_data = res_cand.get_json()["data"]
    assert cand_data["case_id"] == case_id

    # 2. POST /cases/<case_id>/scenarios
    post_payload = {
        "scenario_name": "API Test Scenario",
        "intervention_ids": [1, 5],
        "assumptions": ["API simulation test"],
    }
    res_post = client.post(f"/api/v1/cases/{case_id}/scenarios", json=post_payload)
    assert res_post.status_code == 201
    sc_data = res_post.get_json()["data"]
    scenario_id = sc_data["scenario_id"]
    assert scenario_id is not None
    assert sc_data["scenario_name"] == "API Test Scenario"

    # 3. GET /scenarios/<scenario_id>
    res_get = client.get(f"/api/v1/scenarios/{scenario_id}")
    assert res_get.status_code == 200
    assert res_get.get_json()["data"]["scenario_id"] == scenario_id

    # 4. GET /cases/<case_id>/scenarios
    res_list = client.get(f"/api/v1/cases/{case_id}/scenarios")
    assert res_list.status_code == 200
    assert res_list.get_json()["data"]["scenario_count"] >= 1
