"""Focused M2 business logic, integration, and data-integrity tests."""

from datetime import datetime, timedelta, timezone
import pytest

from app.api.errors import APIError
from app.api.orders import _format_datetime
from app.repositories.order_repository import OrderRepository
from app.services.decision_service import DecisionService
from app.services.delay_service import DelayAnalysisService
from app.services.intervention_service import InterventionService
from app.services.timeline_service import (
    ReconstructedStage,
    ReconstructedTimeline,
    TimelineEvent,
    TimelineService,
    TimelineSummary,
)


def _dummy_summary(text: str = "Summary") -> TimelineSummary:
    return TimelineSummary(
        is_complete=True,
        has_anomalies=False,
        total_events=1,
        valid_event_count=1,
        duplicate_count=0,
        conflict_count=0,
        out_of_order_count=0,
        customer_summary=text,
    )


def test_order_stats_query_counts_all_active_case_statuses():
    """Dashboard stats SQL must count OPEN, ANALYZING, and PENDING_APPROVAL cases and delayed orders."""
    captured_sql = []

    class _FakeCursor:
        description = [
            ("total_orders",),
            ("delivered_orders",),
            ("active_orders",),
            ("cancelled_orders",),
            ("delayed_orders",),
            ("open_cases_count",),
        ]

        def execute(self, query, params=None):
            captured_sql.append(query)

        def fetchone(self):
            return (7, 2, 4, 1, 3, 3)

        def close(self):
            pass

    class _FakeConn:
        def cursor(self):
            return _FakeCursor()

    repo = OrderRepository()
    stats = repo.get_order_stats(conn=_FakeConn())
    assert stats["delayed_orders"] == 3
    assert stats["open_cases_count"] == 3
    assert "'OPEN', 'ANALYZING', 'PENDING_APPROVAL'" in captured_sql[0]


def test_delay_analysis_reuses_active_case_on_get_without_duplicates():
    """GET delay analysis (persist_edges=False) must return existing active case_id instead of null."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    class _FakeTimelineRepo:
        def get_order(self, order_id):
            return {"order_id": order_id, "customer_user_id": 10, "status": "PROCESSING"}

    class _FakeTimelineService:
        def reconstruct_order_timeline(self, **kwargs):
            return ReconstructedTimeline(
                order_id=27,
                order_status="PROCESSING",
                external_order_ref="ORD-DEMO-WAREHOUSE-002",
                placed_at=(now - timedelta(hours=20)).isoformat() + "Z",
                expected_delivery_at=(now + timedelta(hours=28)).isoformat() + "Z",
                reconstructed_at=now.isoformat() + "Z",
                timeline=[],
                stage_progression=[
                    ReconstructedStage(
                        stage_id=1,
                        stage_code="SELLER_PROCESSING",
                        sequence_no=1,
                        status="IN_PROGRESS",
                        planned_start_at=(now - timedelta(hours=20)).isoformat() + "Z",
                        planned_end_at=(now - timedelta(hours=12)).isoformat() + "Z",
                        actual_start_at=(now - timedelta(hours=20)).isoformat() + "Z",
                        actual_end_at=None,
                        planned_duration_minutes=480,
                        actual_duration_minutes=1200,
                        variance_minutes=720,
                        time_lost_minutes=720,
                        time_recovered_minutes=0,
                        event_count=1,
                    ),
                    ReconstructedStage(
                        stage_id=2,
                        stage_code="DISPATCH",
                        sequence_no=2,
                        status="PENDING",
                        planned_start_at=(now - timedelta(hours=12)).isoformat() + "Z",
                        planned_end_at=(now - timedelta(hours=6)).isoformat() + "Z",
                        actual_start_at=None,
                        actual_end_at=None,
                        planned_duration_minutes=360,
                        actual_duration_minutes=None,
                        variance_minutes=None,
                        time_lost_minutes=0,
                        time_recovered_minutes=0,
                        event_count=0,
                    ),
                ],
                summary=_dummy_summary("Processing"),
            )

    class _FakeDelayRepo:
        def get_latest_case_for_order(self, order_id):
            return {"case_id": 25, "order_id": order_id, "status": "ANALYZING"}

    service = DelayAnalysisService(
        delay_repo=_FakeDelayRepo(),
        timeline_repo=_FakeTimelineRepo(),
        timeline_service=_FakeTimelineService(),
    )
    report = service.analyze_order_delay(order_id=27, persist_edges=False)
    assert report.case_id == 25
    assert report.is_delayed is True
    # Pending handover must NOT be labeled FACT
    assert report.delay_graph[0].evidence_class == "ESTIMATE"


def test_delivered_early_order_not_flagged_delayed():
    """Delivered order finishing ahead of total SLA (overall <= 0) must have is_delayed=False."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    class _FakeTimelineRepo:
        def get_order(self, order_id):
            return {"order_id": order_id, "customer_user_id": 10, "status": "DELIVERED"}

    class _FakeTimelineService:
        def reconstruct_order_timeline(self, **kwargs):
            return ReconstructedTimeline(
                order_id=26,
                order_status="DELIVERED",
                external_order_ref="ORD-DEMO-ONTIME-001",
                placed_at=(now - timedelta(hours=60)).isoformat() + "Z",
                expected_delivery_at=(now + timedelta(hours=12)).isoformat() + "Z",
                reconstructed_at=now.isoformat() + "Z",
                actual_delivery_at=now.isoformat() + "Z",
                timeline=[],
                stage_progression=[
                    ReconstructedStage(
                        stage_id=1,
                        stage_code="LINEHAUL_TRANSPORT",
                        sequence_no=1,
                        status="COMPLETED",
                        planned_start_at=now.isoformat() + "Z",
                        planned_end_at=now.isoformat() + "Z",
                        actual_start_at=now.isoformat() + "Z",
                        actual_end_at=now.isoformat() + "Z",
                        planned_duration_minutes=2040,
                        actual_duration_minutes=2280,
                        variance_minutes=240,
                        time_lost_minutes=240,
                        time_recovered_minutes=0,
                        event_count=2,
                    ),
                    ReconstructedStage(
                        stage_id=2,
                        stage_code="DELIVERED",
                        sequence_no=2,
                        status="COMPLETED",
                        planned_start_at=now.isoformat() + "Z",
                        planned_end_at=now.isoformat() + "Z",
                        actual_start_at=now.isoformat() + "Z",
                        actual_end_at=now.isoformat() + "Z",
                        planned_duration_minutes=1440,
                        actual_duration_minutes=480,
                        variance_minutes=-960,
                        time_lost_minutes=0,
                        time_recovered_minutes=960,
                        event_count=1,
                    ),
                ],
                summary=_dummy_summary("Delivered"),
            )

    class _FakeDelayRepo:
        def get_latest_case_for_order(self, order_id):
            return None

    service = DelayAnalysisService(
        delay_repo=_FakeDelayRepo(),
        timeline_repo=_FakeTimelineRepo(),
        timeline_service=_FakeTimelineService(),
    )
    report = service.analyze_order_delay(order_id=26, persist_edges=False)
    assert report.total_delivery_variance_minutes == -720
    assert report.is_delayed is False


def test_interventions_suppressed_for_delivered_orders():
    """Delivered or cancelled orders must not receive pre-delivery operational interventions."""
    class _FakeDelayRepo:
        def get_case_by_id(self, case_id):
            return {"case_id": case_id, "order_id": 28, "status": "OPEN"}

    class _FakeReport:
        order_status = "DELIVERED"
        stage_metrics = []

    class _FakeDelayService:
        def analyze_order_delay(self, order_id, persist_edges=False):
            return _FakeReport()

    service = InterventionService(
        delay_repo=_FakeDelayRepo(),
        delay_service=_FakeDelayService(),
    )
    assert service.discover_candidate_interventions(24) == []


def test_unverified_decision_returns_200_unverified_and_blocks_pending_verification():
    """Unverified decision returns explicit unverified payload; PENDING decisions cannot be verified."""
    class _FakeDecisionRepo:
        def get_decision_by_id(self, decision_id):
            return {"decision_id": decision_id, "case_id": 25, "decision_status": "PENDING"}

        def get_verification_by_decision_id(self, decision_id):
            return None

    service = DecisionService(decision_repo=_FakeDecisionRepo())

    # 1. GET verification for unverified decision does NOT raise 404
    res = service.get_decision_verification(7)
    assert res["verified"] is False
    assert res["decision_id"] == 7
    assert res["verification"] is None

    # 2. POST verify for PENDING decision raises 409 INVALID_DECISION_STATE
    with pytest.raises(APIError) as exc_info:
        service.verify_prediction(7, actual_delivery_at=datetime.now(timezone.utc))
    assert exc_info.value.status_code == 409
    assert exc_info.value.code == "INVALID_DECISION_STATE"


def test_timeline_summary_and_datetime_utc_formatting():
    """Naive DB datetimes serialize with 'Z' and customer summary formats delivery cleanly."""
    naive_dt = datetime(2026, 11, 25, 8, 31, 25)
    assert _format_datetime(naive_dt).endswith("Z")

    tl_service = TimelineService()
    summary = tl_service._generate_customer_summary(
        order_status="DELIVERED",
        stages=[],
        timeline_events=[
            TimelineEvent(
                event_id=1,
                order_id=28,
                stage_id=1,
                stage_code="DELIVERED",
                sequence_no=5,
                event_type="DELIVERED",
                occurred_at="2026-11-21T02:36:45.129206Z",
                received_at="2026-11-21T02:36:45.129206Z",
                source_type="SYSTEM",
                sequence_position=1,
                validation_status="VALID",
                evidence_classification="FACT",
                description="Delivered",
            )
        ],
        actual_delivery_at_str="2026-11-21T02:36:45.129206Z",
    )
    assert "2026-11-21T02:36:45.129206Z" not in summary
    assert "Nov 21, 2026 at 02:36 AM UTC" in summary
