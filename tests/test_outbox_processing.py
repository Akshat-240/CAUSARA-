"""Automated integration tests for Causara transactional outbox engine and background processor."""

from datetime import datetime, timedelta, timezone
import json
import threading
import time
import uuid
import pyodbc
import pytest

from app.database.connection import get_db_connection
from app.repositories.outbox_repository import OutboxRepository
from app.services.event_service import EventService
from app.services.outbox_processor import OutboxProcessor


@pytest.fixture(autouse=True)
def clean_outbox_tables():
    """Ensure dbo.outbox_events is pristine before and after each outbox test."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.outbox_events;")
        cur.execute("DELETE FROM dbo.analysis_jobs WHERE idempotency_key LIKE 'job-timeline-recon-event-%';")
        conn.commit()
    yield
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.outbox_events;")
        cur.execute("DELETE FROM dbo.analysis_jobs WHERE idempotency_key LIKE 'job-timeline-recon-event-%';")
        conn.commit()


@pytest.fixture
def seed_order():
    """Fixture creating an isolated order hierarchy for outbox processing testing."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=2)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # 1. User (Seller owner)
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller Outbox {uid}", f"outbox_seller_{uid}@test.com", "hash_pw"
        )
        seller_user_id = cur.fetchone()[0]

        # 2. User (Customer)
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer Outbox {uid}", f"outbox_cust_{uid}@test.com", "hash_pw"
        )
        customer_user_id = cur.fetchone()[0]

        # 3. Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Outbox Biz {uid}"
        )
        seller_id = cur.fetchone()[0]

        # 4. Order
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, f"ORD-OUTBOX-{uid}", now, now + timedelta(days=3)
        )
        order_id = cur.fetchone()[0]

        # 5. Stage
        cur.execute(
            """
            INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status)
            OUTPUT INSERTED.stage_id
            VALUES (?, 'SELLER_PROCESSING', 1, 'IN_PROGRESS');
            """,
            order_id
        )
        stage_id = cur.fetchone()[0]
        conn.commit()

    yield {
        "order_id": order_id,
        "seller_id": seller_id,
        "seller_user_id": seller_user_id,
        "customer_user_id": customer_user_id,
        "stage_id": stage_id,
        "uid": uid,
    }

    # Teardown in reverse dependency order
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.analysis_jobs WHERE order_id = ?;", order_id)
        cur.execute(
            """
            DELETE FROM dbo.outbox_events
            WHERE aggregate_type = 'ORDER_EVENT'
              AND (
                  aggregate_id IN (SELECT event_id FROM dbo.order_events WHERE order_id = ?)
                  OR payload_json LIKE '%"order_id": ' + CAST(? AS VARCHAR(20)) + '%'
              );
            """,
            (order_id, order_id),
        )
        cur.execute(
            """
            DELETE FROM dbo.audit_log
            WHERE entity_type = 'ORDER_EVENT'
              AND entity_id IN (SELECT event_id FROM dbo.order_events WHERE order_id = ?);
            """,
            order_id,
        )
        cur.execute("DELETE FROM dbo.order_events WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.order_stages WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.orders WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", seller_user_id, customer_user_id)
        conn.commit()


# ============================================================================
# 1. Atomic Event & Outbox Ingestion
# ============================================================================
def test_atomic_event_and_outbox_insertion(client, seed_order):
    """Verify that event and outbox records are committed together in the same transaction."""
    order_id = seed_order["order_id"]
    key = f"outbox-atomic-{seed_order['uid']}"

    payload = {
        "event_type": "PACKAGE_SCANNED",
        "stage_id": seed_order["stage_id"],
        "occurred_at": "2026-11-09T10:00:00Z",
        "description": "Atomic outbox test",
        "source_type": "MANUAL_DASHBOARD",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": key},
        json=payload,
    )
    assert response.status_code == 201
    event_id = response.get_json()["data"]["event_id"]

    with get_db_connection() as conn:
        cur = conn.cursor()
        # Verify order_events
        cur.execute("SELECT COUNT(*) FROM dbo.order_events WHERE event_id = ?;", event_id)
        assert cur.fetchone()[0] == 1

        # Verify corresponding outbox_events record
        cur.execute(
            """
            SELECT outbox_id, event_type, aggregate_type, aggregate_id, payload_json, status, retry_count
            FROM dbo.outbox_events
            WHERE aggregate_type = 'ORDER_EVENT' AND aggregate_id = ?;
            """,
            event_id
        )
        row = cur.fetchone()
        assert row is not None
        outbox_id, event_type, agg_type, agg_id, payload_json, status, retries = row
        assert event_type == "ORDER_EVENT_INGESTED"
        assert agg_type == "ORDER_EVENT"
        assert agg_id == event_id
        assert status == "PENDING"
        assert retries == 0

        outbox_data = json.loads(payload_json)
        assert outbox_data["event_id"] == event_id
        assert outbox_data["order_id"] == order_id


def test_rollback_if_event_insertion_fails(seed_order, monkeypatch):
    """Verify that a failure during event insertion prevents outbox creation."""
    order_id = seed_order["order_id"]
    service = EventService()
    key = f"outbox-fail-evt-{seed_order['uid']}"

    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-09T10:00:00Z",
    }

    def faulty_insert_event(*args, **kwargs):
        raise RuntimeError("Simulated event insert database error")

    monkeypatch.setattr(service.repo, "insert_order_event", faulty_insert_event)

    with pytest.raises(RuntimeError) as exc:
        service.ingest_event(order_id, payload, idempotency_key=key)
    assert "Simulated event insert database error" in str(exc.value)

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.order_events WHERE idempotency_key = ?;", key)
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT COUNT(*) FROM dbo.outbox_events WHERE payload_json LIKE ?;", f"%{key}%")
        assert cur.fetchone()[0] == 0


def test_rollback_if_outbox_insertion_fails(seed_order, monkeypatch):
    """Verify that a failure during outbox insertion cleanly rolls back the event insertion."""
    order_id = seed_order["order_id"]
    service = EventService()
    key = f"outbox-fail-outbox-{seed_order['uid']}"

    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-09T10:00:00Z",
    }

    def faulty_insert_outbox(*args, **kwargs):
        raise RuntimeError("Simulated outbox insert database error")

    monkeypatch.setattr(service.outbox_repo, "insert_outbox_event", faulty_insert_outbox)

    with pytest.raises(RuntimeError) as exc:
        service.ingest_event(order_id, payload, idempotency_key=key)
    assert "Simulated outbox insert database error" in str(exc.value)

    # Crucial assertion: Event insertion was completely rolled back!
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.order_events WHERE idempotency_key = ?;", key)
        assert cur.fetchone()[0] == 0


def test_duplicate_ingestion_creates_no_additional_outbox(client, seed_order):
    """Verify that an idempotent duplicate replay does not produce an additional outbox record."""
    order_id = seed_order["order_id"]
    key = f"outbox-dup-{seed_order['uid']}"

    payload = {
        "event_type": "PACKAGE_SCANNED",
        "stage_id": seed_order["stage_id"],
        "occurred_at": "2026-11-09T10:00:00Z",
        "description": "Original scan",
    }

    # Initial request -> 201 Created
    res1 = client.post(f"/api/v1/orders/{order_id}/events", headers={"Idempotency-Key": key}, json=payload)
    assert res1.status_code == 201
    event_id = res1.get_json()["data"]["event_id"]

    # Replay request -> 200 OK
    res2 = client.post(f"/api/v1/orders/{order_id}/events", headers={"Idempotency-Key": key}, json=payload)
    assert res2.status_code == 200
    assert res2.get_json()["data"]["is_duplicate"] is True

    # Assert exactly 1 outbox record exists
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM dbo.outbox_events WHERE aggregate_type = 'ORDER_EVENT' AND aggregate_id = ?;",
            event_id
        )
        assert cur.fetchone()[0] == 1


# ============================================================================
# 2. Worker Processing Lifecycle (Success & Downstream Idempotency)
# ============================================================================
def test_successful_worker_processing(client, seed_order):
    """Verify background worker claims pending message, executes downstream effect, and marks PUBLISHED."""
    order_id = seed_order["order_id"]
    key = f"outbox-success-{seed_order['uid']}"

    payload = {
        "event_type": "PACKAGE_SCANNED",
        "stage_id": seed_order["stage_id"],
        "occurred_at": "2026-11-09T10:00:00Z",
    }
    res = client.post(f"/api/v1/orders/{order_id}/events", headers={"Idempotency-Key": key}, json=payload)
    event_id = res.get_json()["data"]["event_id"]

    # Run OutboxProcessor
    processor = OutboxProcessor(worker_id="test-worker-1", batch_size=5)
    summary = processor.process_batch()
    assert summary.claimed_count >= 1
    assert summary.published_count >= 1

    # Verify outbox record status in database
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT status, published_at, error_message, locked_at
            FROM dbo.outbox_events
            WHERE aggregate_type = 'ORDER_EVENT' AND aggregate_id = ?;
            """,
            event_id
        )
        status, published_at, error_msg, locked_at = cur.fetchone()
        assert status == "PUBLISHED"
        assert published_at is not None
        assert error_msg is None

        # Verify downstream effect: analysis_jobs record created for timeline reconstruction
        cur.execute(
            "SELECT job_type, status FROM dbo.analysis_jobs WHERE idempotency_key = ?;",
            f"job-timeline-recon-event-{event_id}"
        )
        job = cur.fetchone()
        assert job is not None
        assert job[0] == "TIMELINE_RECONSTRUCTION"
        assert job[1] == "QUEUED"


def test_duplicate_downstream_processing_after_simulated_worker_crash(seed_order):
    """Section 4 Inspection: Verify crash before acknowledgement does NOT duplicate downstream effects on retry."""
    order_id = seed_order["order_id"]
    repo = OutboxRepository()
    uid = seed_order["uid"]

    # 1. Create order event and outbox record directly
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, occurred_at, source_type, idempotency_key
            )
            OUTPUT INSERTED.event_id
            VALUES (?, ?, 'CRASH_TEST_EVENT', SYSUTCDATETIME(), 'SYSTEM', ?);
            """,
            order_id, seed_order["stage_id"], f"crash-key-{uid}"
        )
        event_id = cur.fetchone()[0]

        payload_json = json.dumps({"event_id": event_id, "order_id": order_id, "event_type": "CRASH_TEST_EVENT"})
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", event_id, payload_json)
        conn.commit()

    # 2. Worker 1 claims message with very short lease (1s)
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed = repo.claim_pending_messages(cur, batch_size=1, lease_seconds=1)
        target = [m for m in claimed if m["outbox_id"] == outbox_id]
        assert len(target) == 1
        conn.commit()

    # 3. Worker 1 executes downstream effect (creates analysis job), but CRASHES before marking PUBLISHED
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.analysis_jobs (
                order_id, case_id, decision_id, job_type, status, idempotency_key, retry_count
            )
            VALUES (?, NULL, NULL, 'TIMELINE_RECONSTRUCTION', 'QUEUED', ?, 0);
            """,
            order_id, f"job-timeline-recon-event-{event_id}"
        )
        conn.commit()

    # Wait for Worker 1's lease to expire
    time.sleep(1.5)

    # 4. Worker 2 runs recovery and reclaims the stranded message
    worker_2 = OutboxProcessor(worker_id="recovery-worker-2", lease_seconds=1)
    summary = worker_2.process_batch()
    assert summary.published_count >= 1

    # 5. VERIFY: Exactly 1 analysis_jobs record exists for this event (zero duplicate downstream side-effects)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM dbo.analysis_jobs WHERE idempotency_key = ?;",
            f"job-timeline-recon-event-{event_id}"
        )
        assert cur.fetchone()[0] == 1, "Duplicate downstream analysis_jobs record was created!"

        # Verify outbox status is cleanly PUBLISHED
        cur.execute("SELECT status FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        assert cur.fetchone()[0] == "PUBLISHED"


# ============================================================================
# 3. Retries, Transient, and Permanent Failure Handling
# ============================================================================
def test_transient_failure_and_retry(seed_order):
    """Verify that transient exceptions re-queue the message to PENDING and increment retry_count."""
    order_id = seed_order["order_id"]
    repo = OutboxRepository()

    # Insert outbox record
    payload_json = json.dumps({"event_id": 99999999, "order_id": order_id, "event_type": "TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 99999999, payload_json)
        conn.commit()

    # Faulty downstream handler simulating a transient database lock conflict
    def transient_failure_handler(payload, conn):
        raise pyodbc.OperationalError("Transient lock conflict during queue processing")

    processor = OutboxProcessor(
        worker_id="transient-worker",
        max_retries=3,
        downstream_handler=transient_failure_handler,
    )
    summary = processor.process_batch()
    assert summary.retried_count >= 1

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT status, retry_count, error_message, locked_at FROM dbo.outbox_events WHERE outbox_id = ?;",
            outbox_id,
        )
        status, retries, error_msg, locked_at = cur.fetchone()
        assert status == "PENDING"  # Re-queued for retry
        assert retries == 1
        assert "Transient lock conflict" in error_msg
        assert locked_at is None

        # Clean up record
        cur.execute("DELETE FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        conn.commit()


def test_permanent_failure_transitions_to_failed_without_retry(seed_order):
    """Verify that unrecoverable/validation errors immediately mark FAILED without re-queueing."""
    repo = OutboxRepository()

    # Insert outbox record with malformed JSON
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(
            cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 8888, "INVALID_NOT_JSON{["
        )
        conn.commit()

    processor = OutboxProcessor(worker_id="permanent-worker", max_retries=5)
    summary = processor.process_batch()
    assert summary.failed_count >= 1

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT status, retry_count, error_message FROM dbo.outbox_events WHERE outbox_id = ?;",
            outbox_id,
        )
        status, retries, error_msg = cur.fetchone()
        assert status == "FAILED"
        assert retries == 1
        assert "Malformed payload JSON" in error_msg

        # Clean up record
        cur.execute("DELETE FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        conn.commit()


def test_missing_event_reference_permanent_failure(seed_order):
    """Verify that an outbox event referencing a non-existent order event fails permanently."""
    order_id = seed_order["order_id"]
    repo = OutboxRepository()
    non_existent_event_id = 999999998

    payload_json = json.dumps({"event_id": non_existent_event_id, "order_id": order_id, "event_type": "TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(
            cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", non_existent_event_id, payload_json
        )
        conn.commit()

    processor = OutboxProcessor(worker_id="missing-ref-worker", max_retries=3)
    summary = processor.process_batch()
    assert summary.failed_count >= 1

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT status, retry_count, error_message FROM dbo.outbox_events WHERE outbox_id = ?;",
            outbox_id,
        )
        status, retries, error_msg = cur.fetchone()
        assert status == "FAILED"
        assert "does not exist in database" in error_msg

        # Clean up record
        cur.execute("DELETE FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        conn.commit()


def test_maximum_retry_exhaustion_marks_failed(seed_order):
    """Verify that transient failures reaching max_retries transition status to FAILED (dead-letter)."""
    order_id = seed_order["order_id"]
    repo = OutboxRepository()

    payload_json = json.dumps({"event_id": 7777, "order_id": order_id, "event_type": "TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 7777, payload_json)
        conn.commit()

    def persistent_failure_handler(payload, conn):
        raise RuntimeError("Persistent network glitch")

    processor = OutboxProcessor(
        worker_id="retry-worker",
        max_retries=2,  # Max 2 retries
        base_backoff_seconds=0.0,
        downstream_handler=persistent_failure_handler,
    )

    # Attempt 1 -> retry_count = 1, status = PENDING
    s1 = processor.process_batch()
    assert s1.retried_count >= 1

    # Attempt 2 -> retry_count = 2, status = FAILED (exhausted)
    s2 = processor.process_batch()
    assert s2.failed_count >= 1

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, retry_count FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        status, retries = cur.fetchone()
        assert status == "FAILED"
        assert retries == 2

        # Clean up record
        cur.execute("DELETE FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        conn.commit()


# ============================================================================
# 4. Concurrency, Lease Expiration & Stale Worker Protection
# ============================================================================
def test_concurrent_worker_claiming_no_duplicates(client, seed_order):
    """Verify multiple concurrent workers claim messages with zero duplicate assignments."""
    order_id = seed_order["order_id"]
    uid = seed_order["uid"]

    # Ingest 6 events
    for i in range(6):
        res = client.post(
            f"/api/v1/orders/{order_id}/events",
            headers={"Idempotency-Key": f"concur-outbox-{uid}-{i}"},
            json={
                "event_type": "PACKAGE_SCANNED",
                "occurred_at": (datetime.now(timezone.utc) - timedelta(minutes=10 - i)).isoformat(),
            },
        )
        assert res.status_code == 201

    barrier = threading.Barrier(2)
    claimed_by_w1 = []
    claimed_by_w2 = []
    worker_errors = []

    def worker_1_task():
        try:
            repo = OutboxRepository()
            barrier.wait()
            with get_db_connection() as conn:
                cur = conn.cursor()
                msgs = repo.claim_pending_messages(cur, batch_size=3)
                conn.commit()
                claimed_by_w1.extend([m["outbox_id"] for m in msgs])
        except Exception as ex:
            worker_errors.append(("worker_1", ex))

    def worker_2_task():
        try:
            repo = OutboxRepository()
            barrier.wait()
            with get_db_connection() as conn:
                cur = conn.cursor()
                msgs = repo.claim_pending_messages(cur, batch_size=3)
                conn.commit()
                claimed_by_w2.extend([m["outbox_id"] for m in msgs])
        except Exception as ex:
            worker_errors.append(("worker_2", ex))

    t1 = threading.Thread(target=worker_1_task)
    t2 = threading.Thread(target=worker_2_task)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not worker_errors, f"Thread error occurred: {worker_errors}"

    # Verify zero overlap between the two workers' claimed sets
    set1 = set(claimed_by_w1)
    set2 = set(claimed_by_w2)
    overlap = set1.intersection(set2)
    assert len(overlap) == 0, f"Concurrent workers claimed identical messages: {overlap}"
    assert len(set1) > 0 and len(set2) > 0


def test_stale_worker_attempting_to_complete_reclaimed_message_fails(seed_order):
    """Verify that when a worker's lease expires and another claims it, the stale worker's completion is rejected."""
    order_id = seed_order["order_id"]
    repo = OutboxRepository()

    # 1. Insert outbox message
    payload_json = json.dumps({"event_id": 5555, "order_id": order_id, "event_type": "TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 5555, payload_json)
        conn.commit()

    # 2. Worker A claims message with 1s lease
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed_a = repo.claim_pending_messages(cur, batch_size=1, lease_seconds=1)
        assert len(claimed_a) == 1
        locked_at_a = claimed_a[0]["locked_at"]
        conn.commit()

    # Wait for Worker A's lease to expire
    time.sleep(1.5)

    # 3. Worker B reclaims the message (new locked_at assigned)
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed_b = repo.claim_pending_messages(cur, batch_size=1, lease_seconds=1)
        assert len(claimed_b) == 1
        locked_at_b = claimed_b[0]["locked_at"]
        conn.commit()
    assert locked_at_a != locked_at_b

    # 4. Stale Worker A wakes up and attempts mark_published using locked_at_a
    with get_db_connection() as conn:
        cur = conn.cursor()
        stale_ok = repo.mark_published(cur, outbox_id=outbox_id, expected_locked_at=locked_at_a)
        conn.commit()

    # Ownership check must return False!
    assert stale_ok is False, "Stale worker was incorrectly allowed to complete a stolen message!"

    # 5. Worker B successfully completes using locked_at_b
    with get_db_connection() as conn:
        cur = conn.cursor()
        winner_ok = repo.mark_published(cur, outbox_id=outbox_id, expected_locked_at=locked_at_b)
        conn.commit()
    assert winner_ok is True

    # Clean up test outbox record
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        conn.commit()


# ============================================================================
# 5. Observability Endpoint & Metrics
# ============================================================================
def test_outbox_observability_endpoint(client, seed_order):
    """Verify that GET /api/v1/internal/outbox/stats returns accurate metrics with valid key."""
    response = client.get(
        "/api/v1/internal/outbox/stats",
        headers={"X-Internal-API-Key": "test-internal-api-key"},
    )
    assert response.status_code == 200
    assert response.is_json

    body = response.get_json()
    assert body["success"] is True
    data = body["data"]

    assert "pending_count" in data
    assert "processing_count" in data
    assert "published_count" in data
    assert "failed_count" in data
    assert "total_retries" in data
    assert "oldest_pending_age_seconds" in data
    assert isinstance(data["pending_count"], int)
    assert isinstance(data["published_count"], int)


# ============================================================================
# 6. Exponential Backoff & Retry Delay Scheduling
# ============================================================================
def test_exponential_retry_backoff_delays_and_caps():
    """Verify exponential backoff calculation scales exponentially and respects upper ceiling."""
    processor = OutboxProcessor(
        base_backoff_seconds=1.0,
        backoff_multiplier=2.0,
        max_backoff_seconds=10.0,
    )
    # retry_count 0 -> 1.0 * (2^0) = 1s
    assert processor.compute_backoff_delay(0) == 1
    # retry_count 1 -> 1.0 * (2^1) = 2s
    assert processor.compute_backoff_delay(1) == 2
    # retry_count 2 -> 1.0 * (2^2) = 4s
    assert processor.compute_backoff_delay(2) == 4
    # retry_count 3 -> 1.0 * (2^3) = 8s
    assert processor.compute_backoff_delay(3) == 8
    # retry_count 4 -> 1.0 * (2^4) = 16s -> capped at 10s
    assert processor.compute_backoff_delay(4) == 10
    # retry_count 10 -> capped at 10s
    assert processor.compute_backoff_delay(10) == 10


def test_pending_message_not_claimed_before_next_retry_at(seed_order):
    """Verify that pending messages with a future next_retry_at are skipped during claiming."""
    repo = OutboxRepository()
    order_id = seed_order["order_id"]

    payload_json = json.dumps({"event_id": 11111, "order_id": order_id, "event_type": "BACKOFF_TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 11111, payload_json)
        # Manually set next_retry_at to 60 seconds in the future
        cur.execute(
            "UPDATE dbo.outbox_events SET next_retry_at = DATEADD(second, 60, SYSUTCDATETIME()) WHERE outbox_id = ?;",
            outbox_id,
        )
        conn.commit()

    # Attempt to claim - message must NOT be claimed because next_retry_at is in the future
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed = repo.claim_pending_messages(cur, batch_size=10)
        target = [m for m in claimed if m["outbox_id"] == outbox_id]
        assert len(target) == 0, "Message with future next_retry_at was claimed prematurely!"
        conn.commit()

    # Verify message status remains PENDING in database
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, next_retry_at FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        row = cur.fetchone()
        assert row[0] == "PENDING"
        assert row[1] is not None
        conn.commit()


def test_pending_message_claimed_after_next_retry_at_elapses(seed_order):
    """Verify that pending message is claimed once next_retry_at has elapsed, and next_retry_at is cleared."""
    repo = OutboxRepository()
    order_id = seed_order["order_id"]

    payload_json = json.dumps({"event_id": 22222, "order_id": order_id, "event_type": "BACKOFF_ELAPSED_TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        outbox_id = repo.insert_outbox_event(cur, "ORDER_EVENT_INGESTED", "ORDER_EVENT", 22222, payload_json)
        # Set next_retry_at in the past
        cur.execute(
            "UPDATE dbo.outbox_events SET next_retry_at = DATEADD(second, -5, SYSUTCDATETIME()) WHERE outbox_id = ?;",
            outbox_id,
        )
        conn.commit()

    # Claim - message must now be claimable
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed = repo.claim_pending_messages(cur, batch_size=10)
        target = [m for m in claimed if m["outbox_id"] == outbox_id]
        assert len(target) == 1, "Message with past next_retry_at was not claimed!"
        # Verify next_retry_at is cleared to None on claim
        assert target[0]["next_retry_at"] is None
        conn.commit()

    # Verify database state has next_retry_at == NULL
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, next_retry_at FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        row = cur.fetchone()
        assert row[0] == "PROCESSING"
        assert row[1] is None


# ============================================================================
# 7. Hard-Crash Recovery Counting and Retry Exhaustion
# ============================================================================
def test_hard_crash_recovery_increments_retry_count_and_sets_diagnostic(seed_order):
    """Verify that claiming an expired worker lease increments retry_count and sets recovery diagnostic."""
    repo = OutboxRepository()
    order_id = seed_order["order_id"]

    # Insert message directly simulating a crashed worker with an expired lease
    payload_json = json.dumps({"event_id": 33333, "order_id": order_id, "event_type": "CRASH_DIAG_TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.outbox_events (
                event_type, aggregate_type, aggregate_id, payload_json, status, retry_count, locked_at
            )
            OUTPUT INSERTED.outbox_id
            VALUES ('ORDER_EVENT_INGESTED', 'ORDER_EVENT', 33333, ?, 'PROCESSING', 0,
                    DATEADD(second, -15, SYSUTCDATETIME()));
            """,
            payload_json,
        )
        outbox_id = cur.fetchone()[0]
        conn.commit()

    # Recovery worker claims expired lease (lease_seconds=5)
    with get_db_connection() as conn:
        cur = conn.cursor()
        claimed = repo.claim_pending_messages(cur, batch_size=10, lease_seconds=5, max_retries=3)
        target = [m for m in claimed if m["outbox_id"] == outbox_id]
        assert len(target) == 1
        msg = target[0]
        assert msg["status"] == "PROCESSING"
        assert msg["retry_count"] == 1
        assert "Worker lease expired; reclaimed by recovery worker" in msg["error_message"]
        conn.commit()

    # Verify database state matches
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status, retry_count, error_message FROM dbo.outbox_events WHERE outbox_id = ?;", outbox_id)
        row = cur.fetchone()
        assert row[0] == "PROCESSING"
        assert row[1] == 1
        assert "Worker lease expired" in row[2]


def test_hard_crash_retry_exhaustion_marks_failed(seed_order):
    """Verify that an expired lease with exhausted retries transitions directly to FAILED without reprocessing."""
    order_id = seed_order["order_id"]

    # Insert message simulating a repeatedly crashing worker at retry limit (retry_count = 2, max_retries = 3)
    payload_json = json.dumps({"event_id": 44444, "order_id": order_id, "event_type": "CRASH_EXHAUST_TEST"})
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO dbo.outbox_events (
                event_type, aggregate_type, aggregate_id, payload_json, status, retry_count, locked_at
            )
            OUTPUT INSERTED.outbox_id
            VALUES ('ORDER_EVENT_INGESTED', 'ORDER_EVENT', 44444, ?, 'PROCESSING', 2,
                    DATEADD(second, -20, SYSUTCDATETIME()));
            """,
            payload_json,
        )
        outbox_id = cur.fetchone()[0]
        conn.commit()

    # Run OutboxProcessor with max_retries=3
    downstream_calls = []

    def tracking_handler(payload, conn):
        downstream_calls.append(payload)

    processor = OutboxProcessor(
        worker_id="exhaustion-worker",
        lease_seconds=5,
        max_retries=3,
        downstream_handler=tracking_handler,
    )
    summary = processor.process_batch()

    # The dead-lettered message must be counted as failed
    assert summary.failed_count >= 1
    # Downstream handler must NEVER have been called for this exhausted message
    assert len(downstream_calls) == 0, "Downstream handler was incorrectly invoked for dead-lettered message!"

    # Verify database state: status = FAILED, retry_count = 3, locked_at = NULL, error_message recorded
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT status, retry_count, locked_at, error_message FROM dbo.outbox_events WHERE outbox_id = ?;",
            outbox_id,
        )
        status, retries, locked_at, error_msg = cur.fetchone()
        assert status == "FAILED"
        assert retries == 3
        assert locked_at is None
        assert "Maximum retries exhausted (worker lease expired)" in error_msg


# ============================================================================
# 8. Internal API Key Endpoint Authentication
# ============================================================================
def test_internal_outbox_stats_auth_missing_key(client):
    """Verify that accessing /api/v1/internal/outbox/stats without an API key returns 401 UNAUTHORIZED."""
    response = client.get("/api/v1/internal/outbox/stats")
    assert response.status_code == 401
    assert response.is_json
    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNAUTHORIZED"
    assert "internal api key" in body["error"]["message"].lower()


def test_internal_outbox_stats_auth_invalid_key(client):
    """Verify that accessing /api/v1/internal/outbox/stats with an incorrect API key returns 401 UNAUTHORIZED."""
    response = client.get(
        "/api/v1/internal/outbox/stats",
        headers={"X-Internal-API-Key": "invalid-wrong-key-value"},
    )
    assert response.status_code == 401
    assert response.is_json
    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "UNAUTHORIZED"


def test_internal_outbox_stats_auth_valid_bearer_token(client):
    """Verify that accessing /api/v1/internal/outbox/stats with Authorization: Bearer <key> succeeds."""
    response = client.get(
        "/api/v1/internal/outbox/stats",
        headers={"Authorization": "Bearer test-internal-api-key"},
    )
    assert response.status_code == 200
    assert response.is_json
    body = response.get_json()
    assert body["success"] is True
    assert "pending_count" in body["data"]
