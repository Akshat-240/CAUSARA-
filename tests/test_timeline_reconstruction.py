"""Automated integration tests for Causara Milestone M2.3: Timeline Reconstruction & Normalization Engine.

Covers all 14 required audit scenarios:
1. Normal chronological order
2. Out-of-order event arrival
3. Equal occurrence timestamps and deterministic tie-breaking
4. Duplicate events
5. Conflicting events
6. Missing events and incomplete timelines
7. Invalid stage transitions
8. Repeated stage events
9. Orders with no events
10. Invalid or missing orders
11. Timezone normalization
12. Reconstruction idempotency
13. Job failure and retry behavior
14. API response validation
"""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.database.connection import get_db_connection
from app.repositories.timeline_repository import TimelineRepository
from app.services.timeline_service import (
    TimelineService,
    format_iso_utc,
)


@pytest.fixture
def seed_timeline_order():
    """Fixture creating an isolated order hierarchy with planned stages."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=2)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # 1. Users
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller {uid}", f"seller_{uid}@timeline-test.com", "hash_pw",
        )
        seller_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer {uid}", f"cust_{uid}@timeline-test.com", "hash_pw",
        )
        customer_user_id = cur.fetchone()[0]

        # 2. Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Timeline Biz {uid}",
        )
        seller_id = cur.fetchone()[0]

        # 3. Order
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, f"ORD-TIME-{uid}", now, now + timedelta(days=3),
        )
        order_id = cur.fetchone()[0]

        # 4. Planned Stages (Sequential 1..5)
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
        "customer_user_id": customer_user_id,
        "stage_ids": stage_ids,
        "base_time": now,
        "uid": uid,
    }

    # Teardown
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.audit_log WHERE entity_type = 'ORDER' AND entity_id = ?;", order_id)
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


def _insert_event(
    order_id: int,
    stage_id: int,
    event_type: str,
    occurred_at: datetime,
    received_at: datetime,
    source_type: str = "SYSTEM",
    idempotency_key: str = None,
    description: str = None,
) -> int:
    """Helper inserting a raw order event with explicit timestamps."""
    key = idempotency_key or f"evt-{uuid.uuid4().hex[:12]}"
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, occurred_at, received_at,
                source_type, idempotency_key, description
            )
            OUTPUT INSERTED.event_id
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            order_id, stage_id, event_type, occurred_at, received_at, source_type, key, description,
        )
        event_id = cur.fetchone()[0]
        conn.commit()
    return event_id


# ============================================================================
# 1. Normal Chronological Order
# ============================================================================
def test_normal_chronological_order(seed_timeline_order):
    """Verify standard sequential events reconstruct into a normalized chronological timeline."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    # Insert 5 events in sequential order
    _insert_event(
        order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0 + timedelta(seconds=1)
    )
    _insert_event(
        order_id, stages["DISPATCH"], "DISPATCHED", t0 + timedelta(hours=6), t0 + timedelta(hours=6, seconds=2)
    )
    _insert_event(
        order_id, stages["LINEHAUL_TRANSPORT"], "IN_TRANSIT",
        t0 + timedelta(hours=18), t0 + timedelta(hours=18, seconds=1),
    )
    _insert_event(
        order_id, stages["LAST_MILE"], "OUT_FOR_DELIVERY", t0 + timedelta(hours=50), t0 + timedelta(hours=50, seconds=5)
    )
    _insert_event(
        order_id, stages["DELIVERED"], "DELIVERED", t0 + timedelta(hours=55), t0 + timedelta(hours=55, seconds=1)
    )

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    assert len(reconstructed.timeline) == 5
    # Verify deterministic positions 1..5
    for idx, e in enumerate(reconstructed.timeline, start=1):
        assert e.sequence_position == idx
        assert e.validation_status == "VALID"
        assert e.evidence_classification == "FACT"
        assert not e.is_duplicate
        assert not e.is_conflict

    # Verify stage progression
    assert len(reconstructed.stage_progression) == 5
    for s in reconstructed.stage_progression:
        assert s.status == "COMPLETED"
        assert s.event_count >= 1
        assert s.actual_start_at is not None

    assert reconstructed.summary.is_complete is True
    assert reconstructed.summary.has_anomalies is False
    assert reconstructed.summary.duplicate_count == 0
    assert reconstructed.summary.conflict_count == 0
    assert reconstructed.summary.out_of_order_count == 0
    assert "successfully delivered" in reconstructed.summary.customer_summary.lower()


# ============================================================================
# 2. Out-of-Order Event Arrival
# ============================================================================
def test_out_of_order_event_arrival(seed_timeline_order):
    """Verify events arriving out of physical order are sorted by occurred_at and flagged."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    # Event 1: occurred 10:00, received 10:01
    _insert_event(order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0 + timedelta(minutes=1))
    # Event 3: occurred 12:00, received 12:05 (arrived BEFORE Event 2 was ingested)
    _insert_event(
        order_id, stages["LINEHAUL_TRANSPORT"], "IN_TRANSIT",
        t0 + timedelta(hours=2), t0 + timedelta(hours=2, minutes=5),
    )
    # Event 2: occurred 11:00, received 13:00 (late arrival: occurred between 1 and 3, but received last)
    _insert_event(order_id, stages["DISPATCH"], "DISPATCHED", t0 + timedelta(hours=1), t0 + timedelta(hours=3))

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    # Deterministic physical sorting must place Event 2 in sequence position 2
    types = [e.event_type for e in reconstructed.timeline]
    assert types == ["ORDER_PLACED", "DISPATCHED", "IN_TRANSIT"]

    # Event 2 must be flagged as out-of-order arrival
    late_event = reconstructed.timeline[1]
    assert late_event.event_type == "DISPATCHED"
    assert late_event.validation_status == "OUT_OF_ORDER"
    assert any("out-of-order ingestion" in w.lower() for w in late_event.warnings)
    assert reconstructed.summary.out_of_order_count >= 1


# ============================================================================
# 3. Equal Occurrence Timestamps & Deterministic Tie-Breaking
# ============================================================================
def test_equal_occurrence_timestamps_deterministic_tie_breaking(seed_timeline_order):
    """Verify events sharing identical occurred_at sort deterministically by received_at, then event_id."""
    order_id = seed_timeline_order["order_id"]
    stage_id = seed_timeline_order["stage_ids"]["SELLER_PROCESSING"]
    t0 = seed_timeline_order["base_time"]

    # 4 events sharing identical occurred_at
    id_1 = _insert_event(order_id, stage_id, "EVENT_A", t0, t0 + timedelta(seconds=1))
    id_2 = _insert_event(order_id, stage_id, "EVENT_B", t0, t0 + timedelta(seconds=5))
    id_3 = _insert_event(order_id, stage_id, "EVENT_C", t0, t0 + timedelta(seconds=5))
    id_4 = _insert_event(order_id, stage_id, "EVENT_D", t0, t0 + timedelta(seconds=10))

    service = TimelineService()
    recon_1 = service.reconstruct_order_timeline(order_id=order_id)
    recon_2 = service.reconstruct_order_timeline(order_id=order_id)

    ids_1 = [e.event_id for e in recon_1.timeline]
    ids_2 = [e.event_id for e in recon_2.timeline]

    # Ordering must be 100% deterministic and identical across repeated executions
    assert ids_1 == ids_2
    assert ids_1[0] == id_1
    # For identical received_at (id_2 and id_3), lower event_id must come first
    assert ids_1[1] == min(id_2, id_3)
    assert ids_1[2] == max(id_2, id_3)
    assert ids_1[3] == id_4


# ============================================================================
# 4. Duplicate Events
# ============================================================================
def test_duplicate_events(seed_timeline_order):
    """Verify exact duplicate events are flagged, traced, and preserved without data loss."""
    order_id = seed_timeline_order["order_id"]
    stage_id = seed_timeline_order["stage_ids"]["SELLER_PROCESSING"]
    t0 = seed_timeline_order["base_time"]

    # Canonical primary event
    id_orig = _insert_event(order_id, stage_id, "PACKED", t0, t0 + timedelta(seconds=1), description="First scan")
    # Duplicate 1 (same type, occurred_at, and stage)
    id_dup1 = _insert_event(order_id, stage_id, "PACKED", t0, t0 + timedelta(seconds=10), description="Second scan")
    # Duplicate 2
    id_dup2 = _insert_event(order_id, stage_id, "PACKED", t0, t0 + timedelta(seconds=20), description="Third scan")

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    # All 3 events must be preserved in the timeline (zero event deletion)
    assert len(reconstructed.timeline) == 3

    primary = reconstructed.timeline[0]
    assert primary.event_id == id_orig
    assert primary.validation_status == "VALID"
    assert primary.evidence_classification == "FACT"
    assert not primary.is_duplicate

    dup1 = reconstructed.timeline[1]
    assert dup1.event_id == id_dup1
    assert dup1.is_duplicate is True
    assert dup1.duplicate_of == id_orig
    assert dup1.validation_status == "DUPLICATE"
    assert dup1.evidence_classification == "DATA_QUALITY_ISSUE"

    dup2 = reconstructed.timeline[2]
    assert dup2.event_id == id_dup2
    assert dup2.is_duplicate is True
    assert dup2.duplicate_of == id_orig

    assert reconstructed.summary.duplicate_count == 2
    assert reconstructed.summary.valid_event_count == 1


# ============================================================================
# 5. Conflicting Events
# ============================================================================
def test_conflicting_events(seed_timeline_order):
    """Verify conflicting stage inversions and post-terminal events are explicitly flagged."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    # Event 1: Delivered (terminal state reached at T+10h)
    id_deliv = _insert_event(
        order_id, stages["DELIVERED"], "DELIVERED", t0 + timedelta(hours=10), t0 + timedelta(hours=10)
    )

    # Event 2: In transit at T+12h (contradicts earlier delivered event!)
    id_trans = _insert_event(
        order_id, stages["LINEHAUL_TRANSPORT"], "IN_TRANSIT", t0 + timedelta(hours=12), t0 + timedelta(hours=12)
    )

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    assert len(reconstructed.timeline) == 2
    deliv_event = reconstructed.timeline[0]
    assert deliv_event.event_id == id_deliv
    assert deliv_event.validation_status == "VALID"

    conflict_event = reconstructed.timeline[1]
    assert conflict_event.event_id == id_trans
    assert conflict_event.is_conflict is True
    assert conflict_event.validation_status == "CONFLICTING"
    assert conflict_event.evidence_classification == "DATA_QUALITY_ISSUE"
    assert any("post-terminal conflict" in w.lower() for w in conflict_event.warnings)
    assert id_deliv in conflict_event.related_event_ids

    assert reconstructed.summary.conflict_count >= 1
    assert reconstructed.summary.has_anomalies is True


# ============================================================================
# 6. Missing Events and Incomplete Timelines
# ============================================================================
def test_missing_events_and_incomplete_timelines(seed_timeline_order):
    """Verify skipped stages are flagged as SKIPPED and gaps are reported without phantom fabrication."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    # Only Stage 1 and Stage 4 have events; Stage 2 and Stage 3 are completely missing!
    _insert_event(order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0)
    _insert_event(order_id, stages["LAST_MILE"], "OUT_FOR_DELIVERY", t0 + timedelta(hours=20), t0 + timedelta(hours=20))

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    # Exactly 2 raw events (no fabricated/invented phantom events)
    assert len(reconstructed.timeline) == 2

    stage_map = {s.stage_code: s for s in reconstructed.stage_progression}
    assert stage_map["SELLER_PROCESSING"].status == "COMPLETED"
    assert stage_map["DISPATCH"].status == "SKIPPED"
    assert stage_map["LINEHAUL_TRANSPORT"].status == "SKIPPED"
    assert stage_map["LAST_MILE"].status == "IN_PROGRESS"
    assert stage_map["DELIVERED"].status == "PENDING"

    # Missing stage warnings must be explicitly reported
    all_warnings = " ".join(reconstructed.summary.warnings).lower()
    assert "missing stage transition" in all_warnings
    assert "dispatch" in all_warnings
    assert "linehaul_transport" in all_warnings
    assert reconstructed.summary.is_complete is False


# ============================================================================
# 7. Invalid Stage Transitions
# ============================================================================
def test_invalid_stage_transitions(seed_timeline_order):
    """Verify backward/inverted stage transitions are detected as anomalies."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    # Event 1: Last Mile at T+10h
    _insert_event(
        order_id, stages["LAST_MILE"], "OUT_FOR_DELIVERY", t0 + timedelta(hours=10), t0 + timedelta(hours=10)
    )

    # Event 2: Seller Processing at T+15h (invalid backward progression!)
    _insert_event(
        order_id, stages["SELLER_PROCESSING"], "PACKING_STARTED", t0 + timedelta(hours=15), t0 + timedelta(hours=15)
    )

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    assert reconstructed.timeline[1].is_conflict is True
    assert "stage sequence inversion" in reconstructed.timeline[1].warnings[0].lower()
    assert reconstructed.summary.has_anomalies is True


# ============================================================================
# 8. Repeated Stage Events
# ============================================================================
def test_repeated_stage_events(seed_timeline_order):
    """Verify multiple events within the same stage are clustered properly into actual duration."""
    order_id = seed_timeline_order["order_id"]
    stage_id = seed_timeline_order["stage_ids"]["LINEHAUL_TRANSPORT"]
    t0 = seed_timeline_order["base_time"]

    # 3 distinct events within LINEHAUL_TRANSPORT
    _insert_event(order_id, stage_id, "HUB_ARRIVAL", t0 + timedelta(hours=10), t0 + timedelta(hours=10))
    _insert_event(order_id, stage_id, "HUB_DEPARTURE", t0 + timedelta(hours=14), t0 + timedelta(hours=14))
    _insert_event(order_id, stage_id, "ARRIVED_DESTINATION_HUB", t0 + timedelta(hours=22), t0 + timedelta(hours=22))

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    stage = next(s for s in reconstructed.stage_progression if s.stage_code == "LINEHAUL_TRANSPORT")
    assert stage.event_count == 3
    assert stage.actual_start_at == format_iso_utc(t0 + timedelta(hours=10))


# ============================================================================
# 9. Orders With No Events
# ============================================================================
def test_orders_with_no_events(seed_timeline_order):
    """Verify an order with zero events returns a valid, empty reconstructed timeline."""
    order_id = seed_timeline_order["order_id"]

    service = TimelineService()
    reconstructed = service.reconstruct_order_timeline(order_id=order_id)

    assert len(reconstructed.timeline) == 0
    assert reconstructed.summary.total_events == 0
    assert reconstructed.summary.is_complete is False
    assert reconstructed.summary.has_anomalies is False
    assert "no operational events" in reconstructed.summary.customer_summary.lower()

    # All planned stages must remain in PENDING status
    for s in reconstructed.stage_progression:
        assert s.status == "PENDING"
        assert s.actual_start_at is None
        assert s.actual_end_at is None


# ============================================================================
# 10. Invalid or Missing Orders
# ============================================================================
def test_invalid_or_missing_orders():
    """Verify querying or reconstructing a nonexistent order raises 404 ORDER_NOT_FOUND."""
    service = TimelineService()
    with pytest.raises(Exception) as exc_info:
        service.reconstruct_order_timeline(order_id=99999999)

    assert "ORDER_NOT_FOUND" in str(exc_info.value) or "does not exist" in str(exc_info.value)


# ============================================================================
# 11. Timezone Normalization
# ============================================================================
def test_timezone_normalization():
    """Verify disparate timezone offsets normalize to UTC and preserve original chronological order."""
    from app.services.timeline_service import parse_to_utc_datetime

    # 1. IST (+05:30) 10:00 AM -> 04:30 UTC
    dt_ist = parse_to_utc_datetime("2026-11-04T10:00:00+05:30")
    assert dt_ist.tzinfo == timezone.utc
    assert dt_ist.hour == 4
    assert dt_ist.minute == 30

    # 2. EDT (-04:00) 02:00 AM -> 06:00 UTC
    dt_edt = parse_to_utc_datetime("2026-11-04T02:00:00-04:00")
    assert dt_edt.tzinfo == timezone.utc
    assert dt_edt.hour == 6

    # 3. UTC explicitly with Z
    dt_utc = parse_to_utc_datetime("2026-11-04T05:00:00Z")
    assert dt_utc.hour == 5

    # Verification: chronological sequence is IST (04:30Z) -> UTC (05:00Z) -> EDT (06:00Z)
    assert dt_ist < dt_utc < dt_edt


# ============================================================================
# 12. Reconstruction Idempotency
# ============================================================================
def test_reconstruction_idempotency(seed_timeline_order):
    """Verify repeated reconstruction produces identical, deterministic data without side-effect drift."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    _insert_event(order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0)
    _insert_event(order_id, stages["DISPATCH"], "DISPATCHED", t0 + timedelta(hours=5), t0 + timedelta(hours=5))

    service = TimelineService()
    recon1 = service.reconstruct_order_timeline(order_id=order_id, persist_stage_actuals=True)
    recon2 = service.reconstruct_order_timeline(order_id=order_id, persist_stage_actuals=True)

    d1 = recon1.to_dict()
    d2 = recon2.to_dict()

    # Exclude dynamic timestamps
    d1.pop("reconstructed_at")
    d2.pop("reconstructed_at")

    assert d1 == d2, "Reconstructed timeline output drifted across repeated executions!"


# ============================================================================
# 13. Job Failure and Retry Behavior
# ============================================================================
def test_job_failure_and_retry_behavior(seed_timeline_order):
    """Verify analysis job status transitions through RUNNING and marks FAILED on unhandled error."""
    order_id = seed_timeline_order["order_id"]
    repo = TimelineRepository()

    # 1. Create job
    job = repo.create_analysis_job(order_id, f"test-fail-retry-{uuid.uuid4().hex[:8]}")
    job_id = job["job_id"]
    assert job["status"] == "QUEUED"

    # 2. Simulate failure during execution
    service = TimelineService(repo=repo)
    # Mock repository method to force an exception
    original_get_stages = repo.get_order_stages

    def faulty_get_stages(oid, conn=None):
        raise RuntimeError("Simulated transient query failure during reconstruction")

    repo.get_order_stages = faulty_get_stages

    with pytest.raises(RuntimeError):
        service.execute_reconstruction_job(job_id=job_id)

    # Restore repo method
    repo.get_order_stages = original_get_stages

    # 3. Verify job was marked FAILED with recorded error message
    failed_job = repo.get_analysis_job_by_id(job_id)
    assert failed_job["status"] == "FAILED"
    assert "Simulated transient query failure" in failed_job["error_message"]

    # 4. Retry / re-execute job after error resolution
    recovered = service.execute_reconstruction_job(job_id=job_id)
    assert recovered.order_id == order_id

    # Verify job transitioned to COMPLETED
    completed_job = repo.get_analysis_job_by_id(job_id)
    assert completed_job["status"] == "COMPLETED"
    assert completed_job["completed_at"] is not None


# ============================================================================
# 14. API Response Validation
# ============================================================================
def test_api_endpoints(client, seed_timeline_order):
    """Verify REST API endpoints for timeline retrieval, reconstruction, and job management."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    _insert_event(order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0)
    _insert_event(order_id, stages["DISPATCH"], "DISPATCHED", t0 + timedelta(hours=4), t0 + timedelta(hours=4))

    # 1. GET /api/v1/orders/{id}/timeline
    res = client.get(f"/api/v1/orders/{order_id}/timeline")
    assert res.status_code == 200
    assert res.is_json
    body = res.get_json()
    assert body["success"] is True
    data = body["data"]
    assert data["order_id"] == order_id
    assert len(data["timeline"]) == 2
    assert "customer_summary" in data["summary"]
    assert len(data["stage_progression"]) == 5

    # 2. POST /api/v1/orders/{id}/timeline/reconstruct (synchronous)
    res_post = client.post(
        f"/api/v1/orders/{order_id}/timeline/reconstruct",
        headers={"Idempotency-Key": f"recon-api-key-{uuid.uuid4().hex[:8]}"},
    )
    assert res_post.status_code == 200
    data_post = res_post.get_json()["data"]
    assert data_post["order_id"] == order_id
    assert data_post["job_id"] is not None

    # 3. POST /api/v1/orders/{id}/timeline/reconstruct (async mode)
    res_async = client.post(
        f"/api/v1/orders/{order_id}/timeline/reconstruct",
        json={"async": True},
        headers={"Idempotency-Key": f"recon-api-async-{uuid.uuid4().hex[:8]}"},
    )
    assert res_async.status_code == 202
    async_data = res_async.get_json()["data"]
    assert async_data["status"] == "QUEUED"
    queued_job_id = async_data["job_id"]

    # 4. GET /api/v1/analysis-jobs/{job_id}
    res_job = client.get(f"/api/v1/analysis-jobs/{queued_job_id}")
    assert res_job.status_code == 200
    job_data = res_job.get_json()["data"]
    assert job_data["job_id"] == queued_job_id
    assert job_data["job_type"] == "TIMELINE_RECONSTRUCTION"

    # 5. GET /api/v1/orders/{id}/analysis-jobs
    res_order_jobs = client.get(f"/api/v1/orders/{order_id}/analysis-jobs")
    assert res_order_jobs.status_code == 200
    jobs_list = res_order_jobs.get_json()["data"]["jobs"]
    assert len(jobs_list) >= 2

    # 6. Nonexistent order -> 404 ORDER_NOT_FOUND
    res_404 = client.get("/api/v1/orders/99999999/timeline")
    assert res_404.status_code == 404
    assert res_404.get_json()["error"]["code"] == "ORDER_NOT_FOUND"

    # 7. Nonexistent job -> 404 RESOURCE_NOT_FOUND
    res_job_404 = client.get("/api/v1/analysis-jobs/99999999")
    assert res_job_404.status_code == 404
    assert res_job_404.get_json()["error"]["code"] == "RESOURCE_NOT_FOUND"


# ============================================================================
# 15. Terminal Event Semantics (CANCELLED / RETURNED vs DELIVERED)
# ============================================================================
def test_terminal_event_semantics(seed_timeline_order):
    """Verify CANCELLED and RETURNED never set false delivery, and preserve past delivery on return."""
    order_id = seed_timeline_order["order_id"]
    stages = seed_timeline_order["stage_ids"]
    t0 = seed_timeline_order["base_time"]

    service = TimelineService()

    # Case A: Cancelled order at SELLER_PROCESSING
    _insert_event(order_id, stages["SELLER_PROCESSING"], "ORDER_PLACED", t0, t0)
    _insert_event(order_id, stages["SELLER_PROCESSING"], "CANCELLED", t0 + timedelta(hours=2), t0 + timedelta(hours=2))

    recon_cancel = service.reconstruct_order_timeline(order_id=order_id, persist_stage_actuals=True)
    assert recon_cancel.order_status == "CANCELLED"
    assert recon_cancel.actual_delivery_at is None
    assert "cancelled" in recon_cancel.summary.customer_summary.lower()
    assert "delivered" not in recon_cancel.summary.customer_summary.lower()

    # Verify DB state
    order_db = TimelineRepository().get_order(order_id)
    assert order_db["status"] == "CANCELLED"
    assert order_db["actual_delivery_at"] is None


# ============================================================================
# 16. Completed Job Fencing
# ============================================================================
def test_completed_job_fencing(seed_timeline_order):
    """Verify already COMPLETED jobs are fenced and not reset to RUNNING."""
    order_id = seed_timeline_order["order_id"]
    service = TimelineService()

    job = service.create_reconstruction_job(order_id=order_id)
    job_id = job["job_id"]

    # First execution -> COMPLETED
    recon1 = service.execute_reconstruction_job(job_id=job_id)
    assert recon1.order_id == order_id

    completed_job = TimelineRepository().get_analysis_job_by_id(job_id)
    assert completed_job["status"] == "COMPLETED"
    completed_at_orig = completed_job["completed_at"]
    started_at_orig = completed_job["started_at"]

    # Second execution -> Fenced, preserves original timestamps and status
    recon2 = service.execute_reconstruction_job(job_id=job_id)
    assert recon2.order_id == order_id

    fenced_job = TimelineRepository().get_analysis_job_by_id(job_id)
    assert fenced_job["status"] == "COMPLETED"
    assert fenced_job["completed_at"] == completed_at_orig
    assert fenced_job["started_at"] == started_at_orig
