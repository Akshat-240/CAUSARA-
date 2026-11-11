"""Integration tests for order lifecycle event ingestion and timeline retrieval."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest
from app.database.connection import get_db_connection
from app.services.event_service import EventService


@pytest.fixture
def seed_order():
    """Fixture creating an isolated order hierarchy for ingestion testing.

    Cleans up all created rows upon test completion.
    """
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # 1. User (Seller owner)
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller User {uid}", f"seller_{uid}@test.com", "hash_pw"
        )
        seller_user_id = cur.fetchone()[0]

        # 2. User (Customer)
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer User {uid}", f"cust_{uid}@test.com", "hash_pw"
        )
        customer_user_id = cur.fetchone()[0]

        # 3. Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Biz {uid}"
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
            seller_id, customer_user_id, f"ORD-{uid}", now, now + timedelta(days=3)
        )
        order_id = cur.fetchone()[0]

        # 5. Stages
        cur.execute(
            """
            INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status)
            OUTPUT INSERTED.stage_id
            VALUES (?, 'SELLER_PROCESSING', 1, 'COMPLETED');
            """,
            order_id
        )
        stage1_id = cur.fetchone()[0]

        cur.execute(
            """
            INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, status)
            OUTPUT INSERTED.stage_id
            VALUES (?, 'DISPATCH', 2, 'IN_PROGRESS');
            """,
            order_id
        )
        stage2_id = cur.fetchone()[0]

    yield {
        "order_id": order_id,
        "seller_id": seller_id,
        "seller_user_id": seller_user_id,
        "customer_user_id": customer_user_id,
        "stage1_id": stage1_id,
        "stage2_id": stage2_id,
        "uid": uid,
    }

    # Teardown: delete hierarchy in reverse dependency order
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.order_events WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.order_stages WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.orders WHERE order_id = ?;", order_id)
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", seller_user_id, customer_user_id)


# ============================================================================
# 1. Valid Event Ingestion
# ============================================================================
def test_valid_event_ingestion_success(client, seed_order):
    """Verify that a well-formed event payload is accepted and persisted with HTTP 201."""
    order_id = seed_order["order_id"]
    idempotency_key = f"key-valid-{seed_order['uid']}-1"

    payload = {
        "event_type": "PACKAGE_SCANNED",
        "stage_code": "SELLER_PROCESSING",
        "occurred_at": "2026-11-04T10:00:00Z",
        "location": "Warehouse Hub 1, Bengaluru",
        "description": "Package barcode scanned at sort station",
        "source_type": "MANUAL_DASHBOARD",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload,
    )

    assert response.status_code == 201
    body = response.get_json()
    assert body["success"] is True
    assert body["data"]["order_id"] == order_id
    assert body["data"]["event_type"] == "PACKAGE_SCANNED"
    assert body["data"]["stage_id"] == seed_order["stage1_id"]
    assert body["data"]["status"] == "ACCEPTED"
    assert body["data"]["is_duplicate"] is False
    assert isinstance(body["data"]["event_id"], int)


def test_valid_event_ingestion_with_stage_id(client, seed_order):
    """Verify that event ingestion succeeds when stage_id is provided directly."""
    order_id = seed_order["order_id"]
    idempotency_key = f"key-stageid-{seed_order['uid']}-2"

    payload = {
        "event_type": "DISPATCHED",
        "stage_id": seed_order["stage2_id"],
        "occurred_at": "2026-11-04T11:00:00Z",
        "description": "Handed to courier driver",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload,
    )

    assert response.status_code == 201
    body = response.get_json()
    assert body["success"] is True
    assert body["data"]["stage_id"] == seed_order["stage2_id"]


def test_valid_event_ingestion_without_stage(client, seed_order):
    """Verify that events without a specific stage (general order events) are accepted with stage_id=None."""
    order_id = seed_order["order_id"]
    idempotency_key = f"key-nostage-{seed_order['uid']}-3"

    payload = {
        "event_type": "NOTE_ADDED",
        "occurred_at": "2026-11-04T09:30:00Z",
        "description": "General operational notification",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload,
    )

    assert response.status_code == 201
    body = response.get_json()
    assert body["data"]["stage_id"] is None


# ============================================================================
# 2. Validation Failures: Missing Required Fields
# ============================================================================
def test_ingest_event_missing_idempotency_key(client, seed_order):
    """Verify that missing idempotency key returns HTTP 400 MISSING_IDEMPOTENCY_KEY."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "PACKAGE_SCANNED",
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(f"/api/v1/orders/{order_id}/events", json=payload)
    assert response.status_code == 400
    body = response.get_json()
    assert body["success"] is False
    assert body["error"]["code"] == "MISSING_IDEMPOTENCY_KEY"


def test_ingest_event_missing_event_type(client, seed_order):
    """Verify that missing event_type returns HTTP 400 MISSING_REQUIRED_FIELD."""
    order_id = seed_order["order_id"]
    payload = {
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-missing-type"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "MISSING_REQUIRED_FIELD"


def test_ingest_event_missing_occurred_at(client, seed_order):
    """Verify that missing occurred_at returns HTTP 400 MISSING_REQUIRED_FIELD."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "DISPATCHED",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-missing-occurred"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "MISSING_REQUIRED_FIELD"


# ============================================================================
# 3. Validation Failures: Nonexistent Order or Stage
# ============================================================================
def test_ingest_event_nonexistent_order(client):
    """Verify that attempting to ingest an event on an unknown order_id returns HTTP 404."""
    nonexistent_order_id = 999999999
    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(
        f"/api/v1/orders/{nonexistent_order_id}/events",
        headers={"Idempotency-Key": "key-nonexistent-order"},
        json=payload,
    )
    assert response.status_code == 404
    body = response.get_json()
    assert body["error"]["code"] == "ORDER_NOT_FOUND"


def test_ingest_event_stage_belonging_to_different_order(client, seed_order):
    """Verify that referencing a stage from a different order returns HTTP 400 STAGE_ORDER_MISMATCH."""
    order1_id = seed_order["order_id"]
    arbitrary_foreign_stage_id = 999999998

    payload = {
        "event_type": "DISPATCHED",
        "stage_id": arbitrary_foreign_stage_id,
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(
        f"/api/v1/orders/{order1_id}/events",
        headers={"Idempotency-Key": "key-foreign-stage"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "STAGE_ORDER_MISMATCH"


def test_ingest_event_unknown_stage_code(client, seed_order):
    """Verify that an unknown stage_code returns HTTP 404 STAGE_NOT_FOUND."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "DISPATCHED",
        "stage_code": "NONEXISTENT_STAGE_XYZ",
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-bad-stage-code"},
        json=payload,
    )
    assert response.status_code == 404
    body = response.get_json()
    assert body["error"]["code"] == "STAGE_NOT_FOUND"


# ============================================================================
# 4. Validation Failures: Timestamps and Enums
# ============================================================================
def test_ingest_event_invalid_timestamp_format(client, seed_order):
    """Verify that an unparseable timestamp returns HTTP 400 INVALID_EVENT_TIMESTAMP."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "not-a-timestamp",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-bad-timestamp"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "INVALID_EVENT_TIMESTAMP"


def test_ingest_event_future_timestamp(client, seed_order):
    """Verify that an event timestamp far in the future is rejected with HTTP 400."""
    order_id = seed_order["order_id"]
    future_time = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": future_time,
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-future-time"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "INVALID_EVENT_TIMESTAMP"


def test_ingest_event_invalid_event_type(client, seed_order):
    """Verify that an invalid event_type (special characters or too short) is rejected."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "invalid!event#name",
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-bad-type"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "INVALID_EVENT_TYPE"


def test_ingest_event_invalid_source_type(client, seed_order):
    """Verify that an unrecognized source_type is rejected with HTTP 400."""
    order_id = seed_order["order_id"]
    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-04T10:00:00Z",
        "source_type": "UNAPPROVED_SOURCE",
    }

    response = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": "key-bad-source"},
        json=payload,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert body["error"]["code"] == "INVALID_SOURCE_TYPE"


# ============================================================================
# 5. Idempotency and Conflict Detection
# ============================================================================
def test_idempotent_duplicate_replay(client, seed_order):
    """Verify that resubmitting identical payload with same key returns HTTP 200 without creating duplicates."""
    order_id = seed_order["order_id"]
    idempotency_key = f"key-idempotent-{seed_order['uid']}"

    payload = {
        "event_type": "PACKAGE_SCANNED",
        "stage_code": "SELLER_PROCESSING",
        "occurred_at": "2026-11-04T10:00:00Z",
        "location": "Bengaluru Hub",
        "description": "Initial scan",
    }

    # First request -> 201 Created
    res1 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload,
    )
    assert res1.status_code == 201
    body1 = res1.get_json()
    event_id_1 = body1["data"]["event_id"]
    assert body1["data"]["is_duplicate"] is False

    # Second identical request -> 200 OK replay
    res2 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload,
    )
    assert res2.status_code == 200
    body2 = res2.get_json()
    assert body2["data"]["event_id"] == event_id_1
    assert body2["data"]["is_duplicate"] is True

    # Assert exactly 1 row exists in database for this key
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.order_events WHERE idempotency_key = ?;", idempotency_key)
        assert cur.fetchone()[0] == 1


def test_idempotency_conflict_rejection(client, seed_order):
    """Verify that reusing the same key with conflicting event data raises HTTP 409 IDEMPOTENCY_CONFLICT."""
    order_id = seed_order["order_id"]
    idempotency_key = f"key-conflict-{seed_order['uid']}"

    payload1 = {
        "event_type": "PACKAGE_SCANNED",
        "occurred_at": "2026-11-04T10:00:00Z",
        "description": "First scan",
    }
    res1 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload1,
    )
    assert res1.status_code == 201

    # Conflicting second request: different event_type
    payload2 = {
        "event_type": "CANCELLED",
        "occurred_at": "2026-11-04T10:00:00Z",
        "description": "Conflict attempt",
    }
    res2 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": idempotency_key},
        json=payload2,
    )
    assert res2.status_code == 409
    body2 = res2.get_json()
    assert body2["error"]["code"] == "IDEMPOTENCY_CONFLICT"


# ============================================================================
# 6. Transaction Safety & Rollback
# ============================================================================
def test_transaction_rollback_on_database_failure(seed_order, monkeypatch):
    """Verify that a database failure during event insertion cleanly rolls back without partial records."""
    order_id = seed_order["order_id"]
    service = EventService()
    idempotency_key = f"key-rollback-{seed_order['uid']}"

    payload = {
        "event_type": "DISPATCHED",
        "occurred_at": "2026-11-04T10:00:00Z",
    }

    # Simulate an unexpected database failure inside repository insert
    def faulty_insert(*args, **kwargs):
        raise RuntimeError("Simulated transient SQL failure during insertion")

    monkeypatch.setattr(service.repo, "insert_order_event", faulty_insert)

    with pytest.raises(RuntimeError) as exc_info:
        service.ingest_event(order_id, payload, idempotency_key=idempotency_key)
    assert "Simulated transient SQL failure" in str(exc_info.value)

    # Verify no partial or orphan record was committed
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM dbo.order_events WHERE idempotency_key = ?;", idempotency_key)
        assert cur.fetchone()[0] == 0


# ============================================================================
# 7. Timeline Retrieval & History Preservation
# ============================================================================
def test_multiple_events_chronological_timeline(client, seed_order):
    """Verify that multiple events ingested in arbitrary order are sorted strictly by physical occurred_at."""
    order_id = seed_order["order_id"]
    uid = seed_order["uid"]

    # Ingest event 3 (DISPATCHED)
    client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": f"multi-{uid}-3"},
        json={"event_type": "DISPATCHED", "occurred_at": "2026-11-02T14:00:00Z"},
    )

    # Ingest event 1 (ORDER_PLACED - earlier time)
    client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": f"multi-{uid}-1"},
        json={"event_type": "ORDER_PLACED", "occurred_at": "2026-11-01T08:00:00Z"},
    )

    # Ingest event 2 (PACKED - middle time)
    client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": f"multi-{uid}-2"},
        json={"event_type": "PACKED", "occurred_at": "2026-11-01T15:00:00Z"},
    )

    # Query GET timeline
    response = client.get(f"/api/v1/orders/{order_id}/events")
    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True
    assert body["data"]["count"] == 3

    event_types = [e["event_type"] for e in body["data"]["events"]]
    assert event_types == ["ORDER_PLACED", "PACKED", "DISPATCHED"]


def test_preservation_of_existing_event_history(client, seed_order):
    """Verify that ingesting subsequent events preserves prior records without mutating them."""
    order_id = seed_order["order_id"]
    uid = seed_order["uid"]

    # 1. Ingest initial event
    res1 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": f"hist-{uid}-1"},
        json={
            "event_type": "ORDER_PLACED",
            "occurred_at": "2026-11-01T10:00:00Z",
            "description": "Original unchangeable note",
        },
    )
    event1_id = res1.get_json()["data"]["event_id"]

    # 2. Ingest second event with newer status
    res2 = client.post(
        f"/api/v1/orders/{order_id}/events",
        headers={"Idempotency-Key": f"hist-{uid}-2"},
        json={
            "event_type": "DELIVERED",
            "occurred_at": "2026-11-03T16:00:00Z",
            "description": "Final package delivery",
        },
    )
    event2_id = res2.get_json()["data"]["event_id"]
    assert event1_id != event2_id

    # 3. Read event 1 directly from database and verify it was NOT mutated
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT event_type, description, occurred_at FROM dbo.order_events WHERE event_id = ?;",
            event1_id
        )
        row = cur.fetchone()
        assert row is not None
        assert row[0] == "ORDER_PLACED"
        assert row[1] == "Original unchangeable note"
