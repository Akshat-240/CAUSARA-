"""Tests for Phase 3: Delay-Chain Reconstruction and Investigation Engine."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.database.connection import get_db_connection
from app.services.delay_service import DelayAnalysisService


@pytest.fixture
def seed_delay_order():
    """Create test order with planned stages and user accounts."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=3)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # Users
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller {uid}", f"seller_{uid}@delay-test.com", "hash_pw",
        )
        seller_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer {uid}", f"cust_{uid}@delay-test.com", "hash_pw",
        )
        customer_user_id = cur.fetchone()[0]

        # Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Delay Biz {uid}",
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
            seller_id, customer_user_id, f"ORD-DELAY-{uid}", now, now + timedelta(days=3),
        )
        order_id = cur.fetchone()[0]

        # Planned Stages:
        # Stage 1: SELLER_PROCESSING (planned 8h)
        # Stage 2: DISPATCH (planned 6h)
        # Stage 3: LINEHAUL_TRANSPORT (planned 34h)
        # Stage 4: LAST_MILE (planned 12h)
        # Stage 5: DELIVERED (planned 12h)
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

        conn.commit()

    yield {
        "order_id": order_id,
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
            "DELETE FROM dbo.audit_log WHERE entity_type IN ('ORDER', 'DECISION_CASE') AND entity_id = ?;",
            order_id,
        )
        cur.execute("DELETE FROM dbo.audit_log WHERE actor_user_id IN (?, ?);", (seller_user_id, customer_user_id))
        cur.execute(
            "DELETE FROM dbo.delay_edges WHERE case_id IN (SELECT case_id FROM dbo.decision_cases WHERE order_id = ?);",
            order_id,
        )
        cur.execute("DELETE FROM dbo.evidence WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.decision_cases WHERE order_id = ?;", order_id)
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


def test_delay_analysis_on_time_order(seed_delay_order):
    """Test delay analysis on an order that meets its planned schedule."""
    order_id = seed_delay_order["order_id"]
    t0 = seed_delay_order["base_time"]
    stage_ids = seed_delay_order["stage_ids"]

    # Stage 1: planned 8h, took 6h
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=6))

    # Stage 2: planned 6h, took 4h
    _insert_event(order_id, stage_ids["DISPATCH"], "DISPATCH_INITIATED", t0 + timedelta(hours=6))
    _insert_event(order_id, stage_ids["DISPATCH"], "CARRIER_RECEIVED", t0 + timedelta(hours=10))

    service = DelayAnalysisService()
    report = service.analyze_order_delay(order_id, persist_edges=True)

    assert report.order_id == order_id
    assert report.case_id is not None
    assert report.is_delayed is False
    assert report.disclaimer == DelayAnalysisService.DISCLAIMER
    assert len(report.stage_metrics) >= 2


def test_delay_analysis_delayed_stage_and_epistemological_separation(seed_delay_order):
    """Test that delayed stages create excess duration, hypothesis edges, and strictly partitioned reporting."""
    order_id = seed_delay_order["order_id"]
    t0 = seed_delay_order["base_time"]
    stage_ids = seed_delay_order["stage_ids"]

    # Stage 1: planned 8h (480 mins), takes 30h (1800 mins) -> 22h (1320 mins) excess
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=30))

    # Stage 2: planned 6h (360 mins), takes 6h
    _insert_event(order_id, stage_ids["DISPATCH"], "DISPATCH_INITIATED", t0 + timedelta(hours=30))
    _insert_event(order_id, stage_ids["DISPATCH"], "CARRIER_RECEIVED", t0 + timedelta(hours=36))

    # Stage 3 starts at t0 + 36h, completing Stage 2
    _insert_event(order_id, stage_ids["LINEHAUL_TRANSPORT"], "IN_TRANSIT", t0 + timedelta(hours=36))

    service = DelayAnalysisService()
    report = service.analyze_order_delay(order_id, persist_edges=True)

    assert report.is_delayed is True
    assert report.primary_delay_stage_code == "SELLER_PROCESSING"

    # Epistemological breakdown check
    ep = report.epistemological_breakdown
    assert "facts" in ep and ep["facts"]["observed_stages_count"] >= 2
    assert "variances" in ep and ep["variances"]["stages_with_variance_count"] >= 2
    assert "hypotheses" in ep and ep["hypotheses"]["candidate_edges_count"] >= 1
    assert "estimates" in ep and ep["estimates"]["total_estimated_delay_minutes"] >= 1320

    # Verify graph edges
    edges = report.delay_graph
    # Must have stage transition (FACT) and bottleneck propagation (HYPOTHESIS)
    fact_edges = [e for e in edges if e.evidence_class == "FACT" and e.edge_type == "STAGE_TRANSITION"]
    hyp_edges = [e for e in edges if e.evidence_class == "HYPOTHESIS" and e.edge_type == "BOTTLENECK_PROPAGATION"]

    assert len(fact_edges) >= 1
    assert len(hyp_edges) >= 1
    assert hyp_edges[0].from_stage_code == "SELLER_PROCESSING"
    assert hyp_edges[0].to_stage_code == "DISPATCH"
    assert hyp_edges[0].estimated_delay_minutes == 1320

    # Ensure no self-loops exist
    for edge in edges:
        assert edge.from_stage_id != edge.to_stage_id


def test_delay_analysis_missing_data_warnings(seed_delay_order):
    """Test that skipped stages generate missing data warnings rather than fabricated explanations."""
    order_id = seed_delay_order["order_id"]
    t0 = seed_delay_order["base_time"]
    stage_ids = seed_delay_order["stage_ids"]

    # Skip DISPATCH directly from SELLER_PROCESSING to LINEHAUL_TRANSPORT
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=8))
    _insert_event(order_id, stage_ids["LINEHAUL_TRANSPORT"], "ARRIVED_AT_HUB", t0 + timedelta(hours=20))

    service = DelayAnalysisService()
    report = service.analyze_order_delay(order_id, persist_edges=False)

    assert any("DISPATCH" in w for w in report.missing_data_warnings)


def test_delay_analysis_api_endpoints(client, seed_delay_order):
    """Test REST API endpoints for delay analysis and case graph retrieval."""
    order_id = seed_delay_order["order_id"]
    t0 = seed_delay_order["base_time"]
    stage_ids = seed_delay_order["stage_ids"]

    # Provide events with a 10h delay in stage 1
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "ORDER_PLACED", t0)
    _insert_event(order_id, stage_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", t0 + timedelta(hours=18))
    _insert_event(order_id, stage_ids["DISPATCH"], "CARRIER_RECEIVED", t0 + timedelta(hours=22))

    # 1. POST /orders/<id>/delay-analysis
    res_post = client.post(f"/api/v1/orders/{order_id}/delay-analysis", json={"persist_edges": True})
    assert res_post.status_code == 200
    data_post = res_post.get_json()["data"]
    assert data_post["order_id"] == order_id
    assert data_post["is_delayed"] is True
    case_id = data_post["case_id"]
    assert case_id is not None

    # 2. GET /orders/<id>/delay-analysis
    res_get = client.get(f"/api/v1/orders/{order_id}/delay-analysis")
    assert res_get.status_code == 200
    data_get = res_get.get_json()["data"]
    assert data_get["order_id"] == order_id

    # 3. GET /cases/<case_id>/delay-report
    res_case_rep = client.get(f"/api/v1/cases/{case_id}/delay-report")
    assert res_case_rep.status_code == 200
    assert res_case_rep.get_json()["data"]["order_id"] == order_id

    # 4. GET /cases/<case_id>/delay-graph
    res_graph = client.get(f"/api/v1/cases/{case_id}/delay-graph")
    assert res_graph.status_code == 200
    graph_data = res_graph.get_json()["data"]
    assert graph_data["case_id"] == case_id
    assert graph_data["edge_count"] > 0
    assert len(graph_data["edges"]) == graph_data["edge_count"]
