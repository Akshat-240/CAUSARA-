"""Tests for Order Entity Creation, Management, and Stage Baseline Tracking."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.database.connection import get_db_connection
from app.services.order_service import OrderService


@pytest.fixture
def seed_order_actors():
    """Create test seller and customer users."""
    uid = uuid.uuid4().hex[:8]

    with get_db_connection() as conn:
        cur = conn.cursor()

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Order Seller {uid}", f"orderseller_{uid}@order-test.com", "hash_pw",
        )
        seller_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.users (full_name, email, password_hash) OUTPUT INSERTED.user_id VALUES (?, ?, ?);",
            f"Order Customer {uid}", f"ordercust_{uid}@order-test.com", "hash_pw",
        )
        customer_user_id = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO dbo.sellers (owner_user_id, business_name) OUTPUT INSERTED.seller_id VALUES (?, ?);",
            seller_user_id, f"Order Enterprise {uid}",
        )
        seller_id = cur.fetchone()[0]
        conn.commit()

    yield {
        "seller_id": seller_id,
        "seller_user_id": seller_user_id,
        "customer_user_id": customer_user_id,
        "uid": uid,
    }

    # Teardown
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            DELETE FROM dbo.order_stages
            WHERE order_id IN (SELECT order_id FROM dbo.orders WHERE seller_id = ?);
            """,
            seller_id,
        )
        cur.execute("DELETE FROM dbo.orders WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.sellers WHERE seller_id = ?;", seller_id)
        cur.execute("DELETE FROM dbo.users WHERE user_id IN (?, ?);", (seller_user_id, customer_user_id))
        conn.commit()


def test_create_order_with_default_stages(seed_order_actors):
    """Test order creation with automatically synthesized proportional operational stages."""
    seller_id = seed_order_actors["seller_id"]
    customer_id = seed_order_actors["customer_user_id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    delivery = now + timedelta(days=5)

    service = OrderService()
    order = service.create_order(
        seller_id=seller_id,
        customer_user_id=customer_id,
        external_order_ref=f"ORD-DEFAULT-{uuid.uuid4().hex[:6]}",
        placed_at=now,
        expected_delivery_at=delivery,
    )

    assert order["order_id"] is not None
    assert order["status"] == "PLACED"
    stages = order["stages"]
    assert len(stages) == 5

    stage_codes = [s["stage_code"] for s in stages]
    assert stage_codes == ["SELLER_PROCESSING", "DISPATCH", "LINEHAUL_TRANSPORT", "LAST_MILE", "DELIVERED"]


def test_create_order_duplicate_reference_rejection(seed_order_actors):
    """Test that creating an order with existing seller external ref raises 409."""
    seller_id = seed_order_actors["seller_id"]
    customer_id = seed_order_actors["customer_user_id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    ref = f"ORD-DUP-{uuid.uuid4().hex[:6]}"

    service = OrderService()
    service.create_order(
        seller_id=seller_id,
        customer_user_id=customer_id,
        external_order_ref=ref,
        placed_at=now,
        expected_delivery_at=now + timedelta(days=3),
    )

    with pytest.raises(Exception) as exc_info:
        service.create_order(
            seller_id=seller_id,
            customer_user_id=customer_id,
            external_order_ref=ref,
            placed_at=now,
            expected_delivery_at=now + timedelta(days=3),
        )
    assert getattr(exc_info.value, "code", None) == "ORDER_EXISTS"


def test_order_api_endpoints(client, seed_order_actors):
    """Test Order REST API endpoints: POST, GET, list, and stages."""
    seller_id = seed_order_actors["seller_id"]
    customer_id = seed_order_actors["customer_user_id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    ref = f"ORD-API-{uuid.uuid4().hex[:6]}"

    # 1. POST /orders
    res_post = client.post(
        "/api/v1/orders",
        json={
            "seller_id": seller_id,
            "customer_user_id": customer_id,
            "external_order_ref": ref,
            "placed_at": now.isoformat(),
            "expected_delivery_at": (now + timedelta(days=4)).isoformat(),
        },
    )
    assert res_post.status_code == 201
    order_data = res_post.get_json()["data"]
    order_id = order_data["order_id"]
    assert order_id is not None
    assert len(order_data["stages"]) == 5

    # 2. GET /orders/<id>
    res_get = client.get(f"/api/v1/orders/{order_id}")
    assert res_get.status_code == 200
    assert res_get.get_json()["data"]["order_id"] == order_id

    # 3. GET /orders/<id>/stages
    res_stages = client.get(f"/api/v1/orders/{order_id}/stages")
    assert res_stages.status_code == 200
    stages_data = res_stages.get_json()["data"]
    assert stages_data["order_id"] == order_id
    assert stages_data["stage_count"] == 5

    # 4. GET /orders (list)
    res_list = client.get(f"/api/v1/orders?seller_id={seller_id}")
    assert res_list.status_code == 200
    list_data = res_list.get_json()["data"]
    assert list_data["total"] >= 1
    assert any(o["order_id"] == order_id for o in list_data["orders"])

    # 5. GET /orders/stats
    res_stats = client.get("/api/v1/orders/stats")
    assert res_stats.status_code == 200
    stats_data = res_stats.get_json()["data"]
    assert "total_orders" in stats_data
    assert "delivered_orders" in stats_data
    assert "active_orders" in stats_data

    # 6. GET /sellers
    res_sellers = client.get("/api/v1/sellers")
    assert res_sellers.status_code == 200
    sellers_data = res_sellers.get_json()["data"]
    assert "sellers" in sellers_data
    assert any(s["seller_id"] == seller_id for s in sellers_data["sellers"])

    # 7. GET /actors
    res_actors = client.get("/api/v1/actors")
    assert res_actors.status_code == 200
    actors_data = res_actors.get_json()["data"]
    assert "actors" in actors_data
    assert "count" in actors_data

    # 8. GET /users
    res_users = client.get("/api/v1/users")
    assert res_users.status_code == 200
    users_data = res_users.get_json()["data"]
    assert "users" in users_data
