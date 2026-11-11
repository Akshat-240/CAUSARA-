"""Deterministic, rerunnable demonstration seed script for Causara Backend MVP.

Populates the database with 4 complete orders showcasing:
1. ORD-DEMO-ONTIME-001: On-time delivery meeting SLA.
2. ORD-DEMO-WAREHOUSE-002: Warehouse picking delay with evidence, delay graph,
   scenarios, and approved decision.
3. ORD-DEMO-TRANSPORT-003: Linehaul transit delay with air-freight upgrade scenario,
   decision approval, and verified outcome prediction metrics.
4. ORD-DEMO-CANCELLED-004: Clean customer cancellation during seller processing.
"""

from datetime import datetime, timedelta, timezone
import logging
import os
import sys
from typing import Optional

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database.connection import get_db_connection  # noqa: E402
from app.services.delay_service import DelayAnalysisService  # noqa: E402
from app.services.decision_service import DecisionService  # noqa: E402
from app.services.evidence_service import EvidenceService  # noqa: E402
from app.services.scenario_service import ScenarioService  # noqa: E402
from app.services.timeline_service import TimelineService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

DEMO_REFS = [
    "ORD-DEMO-ONTIME-001",
    "ORD-DEMO-WAREHOUSE-002",
    "ORD-DEMO-TRANSPORT-003",
    "ORD-DEMO-CANCELLED-004",
]

DEMO_EMAILS = [
    "demo_seller@causara.com",
    "demo_customer@causara.com",
    "demo_analyst@causara.com",
    "demo_manager@causara.com",
]


def clean_demo_data() -> None:
    """Idempotently clear any existing demo entities before reseeding."""
    logger.info("Cleaning up prior demonstration data...")
    with get_db_connection() as conn:
        cur = conn.cursor()

        # Delete dependent data for demo orders using subqueries
        cur.execute(
            """
            DELETE FROM dbo.audit_log
            WHERE (entity_type = 'ORDER' AND entity_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            ))
            OR (entity_type = 'DECISION_CASE' AND entity_id IN (
                SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                    SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                )
            ))
            OR (entity_type = 'DECISION' AND entity_id IN (
                SELECT decision_id FROM dbo.decisions WHERE case_id IN (
                    SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                        SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                    )
                )
            ));
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.verifications
            WHERE decision_id IN (
                SELECT decision_id FROM dbo.decisions
                WHERE case_id IN (
                    SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                        SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                    )
                )
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.decisions
            WHERE case_id IN (
                SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                    SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                )
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.scenario_interventions
            WHERE scenario_id IN (
                SELECT scenario_id FROM dbo.scenarios
                WHERE case_id IN (
                    SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                        SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                    )
                )
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.scenarios
            WHERE case_id IN (
                SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                    SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                )
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.delay_edges
            WHERE case_id IN (
                SELECT case_id FROM dbo.decision_cases WHERE order_id IN (
                    SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                )
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.evidence
            WHERE order_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.decision_cases
            WHERE order_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.analysis_jobs
            WHERE order_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.outbox_events
            WHERE aggregate_type = 'ORDER_EVENT'
              AND aggregate_id IN (
                  SELECT event_id FROM dbo.order_events WHERE order_id IN (
                      SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
                  )
              );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.order_events
            WHERE order_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            );
            """
        )

        cur.execute(
            """
            DELETE FROM dbo.order_stages
            WHERE order_id IN (
                SELECT order_id FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%'
            );
            """
        )

        cur.execute("DELETE FROM dbo.orders WHERE external_order_ref LIKE 'ORD-DEMO-%';")

        # Clear demo users and sellers
        cur.execute(
            """
            DELETE FROM dbo.sellers
            WHERE owner_user_id IN (
                SELECT user_id FROM dbo.users WHERE email IN (
                    'demo_seller@causara.com', 'demo_customer@causara.com',
                    'demo_analyst@causara.com', 'demo_manager@causara.com'
                )
            );
            """
        )
        cur.execute(
            """
            DELETE FROM dbo.audit_log
            WHERE actor_user_id IN (
                SELECT user_id FROM dbo.users WHERE email IN (
                    'demo_seller@causara.com', 'demo_customer@causara.com',
                    'demo_analyst@causara.com', 'demo_manager@causara.com'
                )
            );
            """
        )
        cur.execute(
            """
            DELETE FROM dbo.users
            WHERE email IN (
                'demo_seller@causara.com', 'demo_customer@causara.com',
                'demo_analyst@causara.com', 'demo_manager@causara.com'
            );
            """
        )

        conn.commit()
    logger.info("Prior demo data cleaned successfully.")


def _insert_event(
    conn,
    order_id: int,
    stage_id: int,
    event_type: str,
    occurred_at: datetime,
    received_at: Optional[datetime] = None,
    description: Optional[str] = None,
) -> int:
    rec = received_at or occurred_at
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO dbo.order_events (
            order_id, stage_id, event_type, source_type, occurred_at, received_at,
            idempotency_key, description
        )
        OUTPUT INSERTED.event_id
        VALUES (?, ?, ?, 'SYSTEM', ?, ?, ?, ?);
        """,
        order_id, stage_id, event_type, occurred_at, rec,
        f"evt-{order_id}-{stage_id}-{event_type}-{occurred_at.strftime('%Y%m%d%H%M')}",
        description or f"Event {event_type}",
    )
    return int(cur.fetchone()[0])


def seed_demo_data() -> None:
    """Seed the Causara database with comprehensive demonstration data."""
    clean_demo_data()

    logger.info("Seeding Causara users and actors...")
    with get_db_connection() as conn:
        cur = conn.cursor()

        # 1. Users & Roles
        users = [
            ("Apex Retail Logistics", "demo_seller@causara.com", "SELLER"),
            ("Sarah Chen", "demo_customer@causara.com", "CUSTOMER"),
            ("Marcus Vance", "demo_analyst@causara.com", "ANALYST"),
            ("Elena Rostova", "demo_manager@causara.com", "MANAGER"),
        ]
        user_ids = {}
        for name, email, role in users:
            cur.execute(
                """
                INSERT INTO dbo.users (full_name, email, password_hash)
                OUTPUT INSERTED.user_id
                VALUES (?, ?, 'demo_argon2_hash');
                """,
                name, email,
            )
            u_id = int(cur.fetchone()[0])
            user_ids[email] = u_id

            cur.execute("SELECT role_id FROM dbo.roles WHERE role_name = ?;", role)
            r_row = cur.fetchone()
            if r_row:
                cur.execute(
                    """
                    INSERT INTO dbo.user_roles (user_id, role_id)
                    VALUES (?, ?);
                    """,
                    u_id, int(r_row[0]),
                )

        seller_user_id = user_ids["demo_seller@causara.com"]
        customer_user_id = user_ids["demo_customer@causara.com"]
        analyst_user_id = user_ids["demo_analyst@causara.com"]
        manager_user_id = user_ids["demo_manager@causara.com"]

        # 2. Seller
        cur.execute(
            """
            INSERT INTO dbo.sellers (owner_user_id, business_name)
            OUTPUT INSERTED.seller_id
            VALUES (?, 'Apex Retail Logistics LLC');
            """,
            seller_user_id,
        )
        seller_id = int(cur.fetchone()[0])

        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

        # ---------------------------------------------------------------------
        # ORDER 1: ORD-DEMO-ONTIME-001 (On-time, delivered)
        # ---------------------------------------------------------------------
        logger.info("Creating Order 1: ORD-DEMO-ONTIME-001 (On-Time Delivery)...")
        placed_1 = now_utc - timedelta(days=4)
        expected_1 = placed_1 + timedelta(hours=72)
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at,
                expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, 'ORD-DEMO-ONTIME-001', ?, ?, 'DELIVERED');
            """,
            seller_id, customer_user_id, placed_1, expected_1,
        )
        ord1_id = int(cur.fetchone()[0])

        stages_ord1 = [
            ("SELLER_PROCESSING", 1, placed_1, placed_1 + timedelta(hours=8)),
            ("DISPATCH", 2, placed_1 + timedelta(hours=8), placed_1 + timedelta(hours=14)),
            ("LINEHAUL_TRANSPORT", 3, placed_1 + timedelta(hours=14), placed_1 + timedelta(hours=48)),
            ("LAST_MILE", 4, placed_1 + timedelta(hours=48), placed_1 + timedelta(hours=64)),
            ("DELIVERED", 5, placed_1 + timedelta(hours=64), placed_1 + timedelta(hours=72)),
        ]
        s1_ids = {}
        for scode, seq, pstart, pend in stages_ord1:
            cur.execute(
                """
                INSERT INTO dbo.order_stages (
                    order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status
                )
                OUTPUT INSERTED.stage_id
                VALUES (?, ?, ?, ?, ?, 'COMPLETED');
                """,
                ord1_id, scode, seq, pstart, pend,
            )
            s1_ids[scode] = int(cur.fetchone()[0])

        # Events for Ord 1 (all on schedule)
        _insert_event(conn, ord1_id, s1_ids["SELLER_PROCESSING"], "ORDER_PLACED", placed_1)
        _insert_event(conn, ord1_id, s1_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", placed_1 + timedelta(hours=6))
        _insert_event(conn, ord1_id, s1_ids["DISPATCH"], "DISPATCH_INITIATED", placed_1 + timedelta(hours=6))
        _insert_event(conn, ord1_id, s1_ids["DISPATCH"], "CARRIER_RECEIVED", placed_1 + timedelta(hours=10))
        _insert_event(conn, ord1_id, s1_ids["LINEHAUL_TRANSPORT"], "IN_TRANSIT", placed_1 + timedelta(hours=10))
        _insert_event(conn, ord1_id, s1_ids["LINEHAUL_TRANSPORT"], "ARRIVED_AT_HUB", placed_1 + timedelta(hours=42))
        _insert_event(conn, ord1_id, s1_ids["LAST_MILE"], "OUT_FOR_DELIVERY", placed_1 + timedelta(hours=48))
        _insert_event(conn, ord1_id, s1_ids["DELIVERED"], "DELIVERED", placed_1 + timedelta(hours=60))

        # Reconstruct timeline to finalize stage actuals
        conn.commit()

    timeline_service = TimelineService()
    timeline_service.reconstruct_order_timeline(ord1_id, persist_stage_actuals=True)

    # ---------------------------------------------------------------------
    # ORDER 2: ORD-DEMO-WAREHOUSE-002 (Warehouse delayed + Scenario + Decision)
    # ---------------------------------------------------------------------
    logger.info("Creating Order 2: ORD-DEMO-WAREHOUSE-002 (Warehouse Delayed)...")
    placed_2 = now_utc - timedelta(days=2)
    expected_2 = placed_2 + timedelta(hours=72)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at,
                expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, 'ORD-DEMO-WAREHOUSE-002', ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, placed_2, expected_2,
        )
        ord2_id = int(cur.fetchone()[0])

        stages_ord2 = [
            ("SELLER_PROCESSING", 1, placed_2, placed_2 + timedelta(hours=8)),
            ("DISPATCH", 2, placed_2 + timedelta(hours=8), placed_2 + timedelta(hours=14)),
            ("LINEHAUL_TRANSPORT", 3, placed_2 + timedelta(hours=14), placed_2 + timedelta(hours=48)),
            ("LAST_MILE", 4, placed_2 + timedelta(hours=48), placed_2 + timedelta(hours=64)),
            ("DELIVERED", 5, placed_2 + timedelta(hours=64), placed_2 + timedelta(hours=72)),
        ]
        s2_ids = {}
        for scode, seq, pstart, pend in stages_ord2:
            cur.execute(
                """
                INSERT INTO dbo.order_stages (
                    order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status
                )
                OUTPUT INSERTED.stage_id
                VALUES (?, ?, ?, ?, ?, 'PENDING');
                """,
                ord2_id, scode, seq, pstart, pend,
            )
            s2_ids[scode] = int(cur.fetchone()[0])

        # Stage 1 delayed by 26 hours (planned 8h, took 34h)
        _insert_event(conn, ord2_id, s2_ids["SELLER_PROCESSING"], "ORDER_PLACED", placed_2)
        evt_pack = _insert_event(
            conn, ord2_id, s2_ids["SELLER_PROCESSING"], "PACKING_DELAYED",
            placed_2 + timedelta(hours=16), description="High volume inventory pick backlog",
        )
        _insert_event(conn, ord2_id, s2_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", placed_2 + timedelta(hours=34))
        _insert_event(conn, ord2_id, s2_ids["DISPATCH"], "DISPATCH_INITIATED", placed_2 + timedelta(hours=34))

        conn.commit()

    # Reconstruct factual timeline
    timeline_service.reconstruct_order_timeline(ord2_id, persist_stage_actuals=True)

    # Delay analysis and case creation
    delay_service = DelayAnalysisService()
    report2 = delay_service.analyze_order_delay(ord2_id, creator_user_id=analyst_user_id, persist_edges=True)
    case2_id = int(report2.case_id)

    # Upload evidence file
    evidence_service = EvidenceService()
    evidence_service.register_evidence(
        order_id=ord2_id,
        uploaded_by=analyst_user_id,
        file_name="warehouse_picking_incident_log.pdf",
        content_type="application/pdf",
        file_bytes=b"%PDF-1.4 Mock Warehouse Incident Report for Order 2 picking delay...",
        event_id=evt_pack,
        case_id=case2_id,
    )

    # Simulate and record scenario
    scenario_service = ScenarioService()
    active_ints = scenario_service.scenario_repo.list_active_interventions()
    packing_int = next(i for i in active_ints if i["intervention_code"] == "PRIORITY_PACKING")
    notice_int = next(i for i in active_ints if i["intervention_code"] == "CUSTOMER_PROACTIVE_NOTICE")

    scen2 = scenario_service.simulate_scenario(
        case_id=case2_id,
        scenario_name="Priority Packaging & Dispatch Acceleration",
        intervention_ids=[int(packing_int["intervention_id"]), int(notice_int["intervention_id"])],
        assumptions=[
            "Direct express loading dock assignment at dispatch.",
            "SMS notification dispatched with revised buyer SLA.",
        ],
    )
    scen2_id = int(scen2["scenario_id"])

    decision_service = DecisionService()
    dec2 = decision_service.record_decision(
        case_id=case2_id,
        scenario_id=scen2_id,
        decided_by=analyst_user_id,
        rationale="Expedited packing queue deployment and proactive notification to buyer.",
    )
    dec2_id = int(dec2["decision_id"])
    decision_service.approve_decision(decision_id=dec2_id, manager_user_id=manager_user_id)

    # ---------------------------------------------------------------------
    # ORDER 3: ORD-DEMO-TRANSPORT-003 (Transport delayed + Verified Outcome)
    # ---------------------------------------------------------------------
    logger.info("Creating Order 3: ORD-DEMO-TRANSPORT-003 (Transport Delay & Outcome Verification)...")
    placed_3 = now_utc - timedelta(days=6)
    expected_3 = placed_3 + timedelta(hours=72)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at,
                expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, 'ORD-DEMO-TRANSPORT-003', ?, ?, 'DELIVERED');
            """,
            seller_id, customer_user_id, placed_3, expected_3,
        )
        ord3_id = int(cur.fetchone()[0])

        stages_ord3 = [
            ("SELLER_PROCESSING", 1, placed_3, placed_3 + timedelta(hours=8)),
            ("DISPATCH", 2, placed_3 + timedelta(hours=8), placed_3 + timedelta(hours=14)),
            ("LINEHAUL_TRANSPORT", 3, placed_3 + timedelta(hours=14), placed_3 + timedelta(hours=48)),
            ("LAST_MILE", 4, placed_3 + timedelta(hours=48), placed_3 + timedelta(hours=64)),
            ("DELIVERED", 5, placed_3 + timedelta(hours=64), placed_3 + timedelta(hours=72)),
        ]
        s3_ids = {}
        for scode, seq, pstart, pend in stages_ord3:
            cur.execute(
                """
                INSERT INTO dbo.order_stages (
                    order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status
                )
                OUTPUT INSERTED.stage_id
                VALUES (?, ?, ?, ?, ?, 'COMPLETED');
                """,
                ord3_id, scode, seq, pstart, pend,
            )
            s3_ids[scode] = int(cur.fetchone()[0])

        # Stage 1 & 2 on time, Stage 3 had a 40h transit delay
        _insert_event(conn, ord3_id, s3_ids["SELLER_PROCESSING"], "ORDER_PLACED", placed_3)
        _insert_event(conn, ord3_id, s3_ids["SELLER_PROCESSING"], "PACKING_COMPLETED", placed_3 + timedelta(hours=8))
        _insert_event(conn, ord3_id, s3_ids["DISPATCH"], "CARRIER_RECEIVED", placed_3 + timedelta(hours=14))
        _insert_event(conn, ord3_id, s3_ids["LINEHAUL_TRANSPORT"], "IN_TRANSIT", placed_3 + timedelta(hours=14))
        _insert_event(
            conn, ord3_id, s3_ids["LINEHAUL_TRANSPORT"], "FREIGHT_DELAYED",
            placed_3 + timedelta(hours=30), description="Interstate highway winter weather road closure",
        )
        _insert_event(conn, ord3_id, s3_ids["LINEHAUL_TRANSPORT"], "ARRIVED_AT_HUB", placed_3 + timedelta(hours=74))
        _insert_event(conn, ord3_id, s3_ids["LAST_MILE"], "OUT_FOR_DELIVERY", placed_3 + timedelta(hours=78))

        # Delivered at +82 hours (10 hours past original 72h SLA, but 14 hours saved vs projected 96h delay)
        actual_deliv_3 = placed_3 + timedelta(hours=82)
        _insert_event(conn, ord3_id, s3_ids["DELIVERED"], "DELIVERED", actual_deliv_3)

        conn.commit()

    timeline_service.reconstruct_order_timeline(ord3_id, persist_stage_actuals=True)
    report3 = delay_service.analyze_order_delay(ord3_id, creator_user_id=analyst_user_id, persist_edges=True)
    case3_id = int(report3.case_id)

    # Simulate scenario: Air freight upgrade
    air_int = next(i for i in active_ints if i["intervention_code"] == "AIR_FREIGHT_UPGRADE")
    scen3 = scenario_service.simulate_scenario(
        case_id=case3_id,
        scenario_name="Linehaul Air Freight Upgrade",
        intervention_ids=[int(air_int["intervention_id"])],
        assumptions=["Air freight booking executed for remaining corridor."],
    )
    scen3_id = int(scen3["scenario_id"])

    dec3 = decision_service.record_decision(
        case_id=case3_id,
        scenario_id=scen3_id,
        decided_by=analyst_user_id,
        rationale="Approved commercial air freight reroute to recover linehaul transit buffer.",
    )
    dec3_id = int(dec3["decision_id"])
    decision_service.approve_decision(decision_id=dec3_id, manager_user_id=manager_user_id)

    # Outcome Verification
    decision_service.verify_prediction(
        decision_id=dec3_id,
        actual_delivery_at=actual_deliv_3,
        outcome_notes=(
            "Commercial air freight successfully mitigated delay. "
            "Order delivered with calculated SLA variance."
        ),
    )

    # ---------------------------------------------------------------------
    # ORDER 4: ORD-DEMO-CANCELLED-004 (Cancelled order, clean terminal status)
    # ---------------------------------------------------------------------
    logger.info("Creating Order 4: ORD-DEMO-CANCELLED-004 (Clean Cancellation)...")
    placed_4 = now_utc - timedelta(days=1)
    expected_4 = placed_4 + timedelta(hours=72)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at,
                expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, 'ORD-DEMO-CANCELLED-004', ?, ?, 'CANCELLED');
            """,
            seller_id, customer_user_id, placed_4, expected_4,
        )
        ord4_id = int(cur.fetchone()[0])

        stages_ord4 = [
            ("SELLER_PROCESSING", 1, placed_4, placed_4 + timedelta(hours=8)),
            ("DISPATCH", 2, placed_4 + timedelta(hours=8), placed_4 + timedelta(hours=14)),
            ("LINEHAUL_TRANSPORT", 3, placed_4 + timedelta(hours=14), placed_4 + timedelta(hours=48)),
            ("LAST_MILE", 4, placed_4 + timedelta(hours=48), placed_4 + timedelta(hours=64)),
            ("DELIVERED", 5, placed_4 + timedelta(hours=64), placed_4 + timedelta(hours=72)),
        ]
        s4_ids = {}
        for scode, seq, pstart, pend in stages_ord4:
            cur.execute(
                """
                INSERT INTO dbo.order_stages (
                    order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status
                )
                OUTPUT INSERTED.stage_id
                VALUES (?, ?, ?, ?, ?, 'PENDING');
                """,
                ord4_id, scode, seq, pstart, pend,
            )
            s4_ids[scode] = int(cur.fetchone()[0])

        _insert_event(conn, ord4_id, s4_ids["SELLER_PROCESSING"], "ORDER_PLACED", placed_4)
        _insert_event(
            conn, ord4_id, s4_ids["SELLER_PROCESSING"], "ORDER_CANCELLED",
            placed_4 + timedelta(hours=3), description="Buyer cancelled item prior to shipment",
        )
        conn.commit()

    timeline_service.reconstruct_order_timeline(ord4_id, persist_stage_actuals=True)

    logger.info("==================================================================")
    logger.info("Causara Demonstration Data Seeded Successfully!")
    logger.info(f"  1. Order ORD-DEMO-ONTIME-001 (ID: {ord1_id}) -> DELIVERED (On-Time)")
    logger.info(f"  2. Order ORD-DEMO-WAREHOUSE-002 (ID: {ord2_id}) -> IN_TRANSIT (Case: {case2_id}, Dec: {dec2_id})")
    logger.info(f"  3. Order ORD-DEMO-TRANSPORT-003 (ID: {ord3_id}) -> DELIVERED (Verified, Dec: {dec3_id})")
    logger.info(f"  4. Order ORD-DEMO-CANCELLED-004 (ID: {ord4_id}) -> CANCELLED (Terminal Event)")
    logger.info("==================================================================")


if __name__ == "__main__":
    seed_demo_data()
