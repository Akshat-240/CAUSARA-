"""Automated tests for evidence backend: metadata, uploads, cross-order validation, and stage queries."""

import io
import uuid
from datetime import datetime, timedelta, timezone
import pytest

from app.database.connection import get_db_connection
from app.services.evidence_service import EvidenceService, MAX_FILE_SIZE_BYTES


@pytest.fixture
def seed_evidence_order():
    """Fixture creating an isolated order, stages, events, and a decision case."""
    uid = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    with get_db_connection() as conn:
        cur = conn.cursor()

        # Users
        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Seller {uid}", f"seller_{uid}@evidence-test.com", "hash_pw",
        )
        seller_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Customer {uid}", f"cust_{uid}@evidence-test.com", "hash_pw",
        )
        customer_user_id = cur.fetchone()[0]

        # Seller
        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Evidence Biz {uid}",
        )
        seller_id = cur.fetchone()[0]

        # Order 1
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, f"ORD-EVI1-{uid}", now, now + timedelta(days=3),
        )
        order_id_1 = cur.fetchone()[0]

        # Order 2 (for cross-order checks)
        cur.execute(
            """
            INSERT INTO dbo.orders (
                seller_id, customer_user_id, external_order_ref, placed_at, expected_delivery_at, status
            )
            OUTPUT INSERTED.order_id
            VALUES (?, ?, ?, ?, ?, 'PROCESSING');
            """,
            seller_id, customer_user_id, f"ORD-EVI2-{uid}", now, now + timedelta(days=3),
        )
        order_id_2 = cur.fetchone()[0]

        # Stages for Order 1
        cur.execute(
            """
            INSERT INTO dbo.order_stages (order_id, stage_code, sequence_no, planned_start_at, planned_end_at, status)
            OUTPUT INSERTED.stage_id
            VALUES (?, 'SELLER_PROCESSING', 1, ?, ?, 'IN_PROGRESS');
            """,
            order_id_1, now, now + timedelta(hours=8),
        )
        stage_id_1 = cur.fetchone()[0]

        # Event for Order 1
        cur.execute(
            """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, occurred_at, received_at, source_type, idempotency_key
            )
            OUTPUT INSERTED.event_id
            VALUES (?, ?, 'ORDER_PLACED', ?, ?, 'SYSTEM', ?);
            """,
            order_id_1, stage_id_1, now, now, f"evt-evi1-{uid}",
        )
        event_id_1 = cur.fetchone()[0]

        # Event for Order 2
        cur.execute(
            """
            INSERT INTO dbo.order_events (
                order_id, stage_id, event_type, occurred_at, received_at, source_type, idempotency_key
            )
            OUTPUT INSERTED.event_id
            VALUES (?, NULL, 'ORDER_PLACED', ?, ?, 'SYSTEM', ?);
            """,
            order_id_2, now, now, f"evt-evi2-{uid}",
        )
        event_id_2 = cur.fetchone()[0]

        # Decision case for Order 1
        cur.execute(
            """
            INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
            OUTPUT INSERTED.case_id
            VALUES (?, ?, 'Delay Case Order 1', 'OPEN', ?);
            """,
            order_id_1, seller_user_id, now,
        )
        case_id_1 = cur.fetchone()[0]

        # Decision case for Order 2
        cur.execute(
            """
            INSERT INTO dbo.decision_cases (order_id, created_by, case_title, status, opened_at)
            OUTPUT INSERTED.case_id
            VALUES (?, ?, 'Delay Case Order 2', 'OPEN', ?);
            """,
            order_id_2, seller_user_id, now,
        )
        case_id_2 = cur.fetchone()[0]

        conn.commit()

    yield {
        "order_id_1": order_id_1,
        "order_id_2": order_id_2,
        "seller_user_id": seller_user_id,
        "stage_id_1": stage_id_1,
        "event_id_1": event_id_1,
        "event_id_2": event_id_2,
        "case_id_1": case_id_1,
        "case_id_2": case_id_2,
    }

    # Teardown
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM dbo.audit_log WHERE actor_user_id IN (?, ?);", (seller_user_id, customer_user_id))
        cur.execute("DELETE FROM dbo.evidence WHERE order_id IN (?, ?);", (order_id_1, order_id_2))
        cur.execute("DELETE FROM dbo.decision_cases WHERE order_id IN (?, ?);", (order_id_1, order_id_2))
        cur.execute("DELETE FROM dbo.order_events WHERE order_id IN (?, ?);", (order_id_1, order_id_2))
        cur.execute("DELETE FROM dbo.order_stages WHERE order_id IN (?, ?);", (order_id_1, order_id_2))
        cur.execute("DELETE FROM dbo.orders WHERE order_id IN (?, ?);", (order_id_1, order_id_2))
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", (seller_user_id, customer_user_id))
        conn.commit()


def test_register_evidence_metadata_json(seed_evidence_order):
    """Verify registering evidence with pre-existing blob URI."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]
    event_id = seed_evidence_order["event_id_1"]
    unique_uri = f"https://azure.storage/blob/{uuid.uuid4().hex}_delivery_receipt.pdf"

    service = EvidenceService()
    sha = "a" * 64
    record = service.register_evidence(
        order_id=order_id,
        uploaded_by=user_id,
        file_name="delivery_receipt.pdf",
        content_type="application/pdf",
        blob_uri=unique_uri,
        sha256_hash=sha,
        event_id=event_id,
    )
    assert record["evidence_id"] is not None
    assert record["status"] == "ACTIVE"
    assert record["order_id"] == order_id
    assert record["event_id"] == event_id


def test_register_evidence_with_binary_payload(seed_evidence_order):
    """Verify local storage persistence when binary bytes are supplied."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]

    service = EvidenceService()
    test_content = b"Proof of handover signed document content"
    record = service.register_evidence(
        order_id=order_id,
        uploaded_by=user_id,
        file_name="handover_proof.txt",
        content_type="text/plain",
        file_bytes=test_content,
    )
    assert record["evidence_id"] is not None
    assert record["blob_uri"].startswith(f"local://evidence/{order_id}/")
    assert len(record["sha256_hash"]) == 64

    # Verify content readback from local storage
    read_bytes = service.storage.read_file(record["blob_uri"])
    assert read_bytes == test_content


def test_cross_order_event_rejection(seed_evidence_order):
    """Verify attempting to associate an event from Order 2 to Order 1 raises 400 error."""
    order_1 = seed_evidence_order["order_id_1"]
    event_2 = seed_evidence_order["event_id_2"]
    user_id = seed_evidence_order["seller_user_id"]

    service = EvidenceService()
    with pytest.raises(Exception) as exc_info:
        service.register_evidence(
            order_id=order_1,
            uploaded_by=user_id,
            file_name="cross_event.pdf",
            content_type="application/pdf",
            blob_uri="local://test/blob.pdf",
            sha256_hash="b" * 64,
            event_id=event_2,  # Belongs to Order 2, not Order 1!
        )
    assert exc_info.value.code == "CROSS_ORDER_EVENT_REFERENCE"


def test_cross_order_case_rejection(seed_evidence_order):
    """Verify attempting to associate a case from Order 2 to Order 1 raises 400 error."""
    order_1 = seed_evidence_order["order_id_1"]
    case_2 = seed_evidence_order["case_id_2"]
    user_id = seed_evidence_order["seller_user_id"]

    service = EvidenceService()
    with pytest.raises(Exception) as exc_info:
        service.register_evidence(
            order_id=order_1,
            uploaded_by=user_id,
            file_name="cross_case.pdf",
            content_type="application/pdf",
            blob_uri="local://test/blob.pdf",
            sha256_hash="c" * 64,
            case_id=case_2,  # Belongs to Order 2, not Order 1!
        )
    assert exc_info.value.code == "CROSS_ORDER_CASE_REFERENCE"


def test_unsupported_media_type_rejection(seed_evidence_order):
    """Verify malicious or unapproved content types are rejected with HTTP 415."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]

    service = EvidenceService()
    with pytest.raises(Exception) as exc_info:
        service.register_evidence(
            order_id=order_id,
            uploaded_by=user_id,
            file_name="malicious.exe",
            content_type="application/x-msdownload",
            blob_uri="local://test/malicious.exe",
            sha256_hash="d" * 64,
        )
    assert exc_info.value.code == "UNSUPPORTED_MEDIA_TYPE"


def test_oversized_file_rejection(seed_evidence_order):
    """Verify payload exceeding MAX_FILE_SIZE_BYTES is rejected with HTTP 413."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]

    service = EvidenceService()
    giant_payload = b"X" * (MAX_FILE_SIZE_BYTES + 1024)
    with pytest.raises(Exception) as exc_info:
        service.register_evidence(
            order_id=order_id,
            uploaded_by=user_id,
            file_name="giant.pdf",
            content_type="application/pdf",
            file_bytes=giant_payload,
        )
    assert exc_info.value.code == "FILE_TOO_LARGE"


def test_list_evidence_by_stage(seed_evidence_order):
    """Verify evidence can be listed by order and filtered by stage."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]
    event_id = seed_evidence_order["event_id_1"]
    stage_id = seed_evidence_order["stage_id_1"]

    service = EvidenceService()
    service.register_evidence(
        order_id=order_id,
        uploaded_by=user_id,
        file_name="stage_receipt.png",
        content_type="image/png",
        blob_uri=f"local://test/{uuid.uuid4().hex}_receipt.png",
        sha256_hash="e" * 64,
        event_id=event_id,
    )

    stage_evidence = service.list_evidence_for_order(order_id=order_id, stage_id=stage_id)
    assert len(stage_evidence) == 1
    assert stage_evidence[0]["file_name"] == "stage_receipt.png"


def test_evidence_api_endpoints(client, seed_evidence_order):
    """Verify REST API endpoints for evidence upload and retrieval."""
    order_id = seed_evidence_order["order_id_1"]
    user_id = seed_evidence_order["seller_user_id"]

    # 1. POST JSON
    res_json = client.post(
        f"/api/v1/orders/{order_id}/evidence",
        json={
            "uploaded_by": user_id,
            "file_name": "api_doc.pdf",
            "content_type": "application/pdf",
            "blob_uri": f"https://storage.azure.com/{uuid.uuid4().hex}_api_doc.pdf",
            "sha256_hash": "f" * 64,
        },
    )
    assert res_json.status_code == 201
    evidence_id = res_json.get_json()["data"]["evidence_id"]

    # 2. POST Multipart file upload
    data = {
        "uploaded_by": str(user_id),
        "file": (io.BytesIO(b"Sample upload test content"), "sample.txt"),
    }
    res_file = client.post(
        f"/api/v1/orders/{order_id}/evidence",
        data=data,
        content_type="multipart/form-data",
    )
    assert res_file.status_code == 201

    # 3. GET /orders/{id}/evidence
    res_list = client.get(f"/api/v1/orders/{order_id}/evidence")
    assert res_list.status_code == 200
    assert len(res_list.get_json()["data"]["evidence"]) >= 2

    # 4. GET /evidence/{id}
    res_get = client.get(f"/api/v1/evidence/{evidence_id}")
    assert res_get.status_code == 200
    assert res_get.get_json()["data"]["file_name"] == "api_doc.pdf"
