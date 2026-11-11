"""Order management service for order lifecycle and stage baseline orchestration."""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.api.errors import APIError
from app.database.connection import get_db_connection
from app.repositories.order_repository import OrderRepository

logger = logging.getLogger(__name__)

# Default standard stage sequence and proportional window allocations
DEFAULT_STAGE_PROPORTIONS = [
    ("SELLER_PROCESSING", 1, 0.15),
    ("DISPATCH", 2, 0.10),
    ("LINEHAUL_TRANSPORT", 3, 0.45),
    ("LAST_MILE", 4, 0.20),
    ("DELIVERED", 5, 0.10),
]


class OrderService:
    """Service handling order creation with planned baselines and queries."""

    def __init__(self, order_repo: Optional[OrderRepository] = None) -> None:
        self.order_repo = order_repo or OrderRepository()

    def create_order(
        self,
        seller_id: int,
        customer_user_id: int,
        external_order_ref: str,
        placed_at: Optional[datetime] = None,
        expected_delivery_at: Optional[datetime] = None,
        custom_stages: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Create a new order with validated operational stage baselines."""
        if placed_at is not None:
            placed = placed_at.astimezone(timezone.utc).replace(tzinfo=None) if placed_at.tzinfo else placed_at
        else:
            placed = datetime.now(timezone.utc).replace(tzinfo=None)

        if not expected_delivery_at:
            raise APIError(
                code="BAD_REQUEST",
                message="Field 'expected_delivery_at' is required.",
                status_code=400,
            )

        expected = (
            expected_delivery_at.astimezone(timezone.utc).replace(tzinfo=None)
            if expected_delivery_at.tzinfo
            else expected_delivery_at
        )

        if expected <= placed:
            raise APIError(
                code="BAD_REQUEST",
                message="'expected_delivery_at' must be strictly after 'placed_at'.",
                status_code=400,
            )

        ref = external_order_ref.strip() if external_order_ref else ""
        if not ref:
            raise APIError(
                code="BAD_REQUEST",
                message="Field 'external_order_ref' is required.",
                status_code=400,
            )

        # Check uniqueness constraint
        existing = self.order_repo.get_order_by_seller_ref(seller_id=seller_id, external_order_ref=ref)
        if existing:
            raise APIError(
                code="ORDER_EXISTS",
                message=f"Order with reference '{ref}' already exists for seller {seller_id}.",
                status_code=409,
            )

        with get_db_connection() as conn:
            # 1. Insert order record
            order = self.order_repo.create_order(
                seller_id=seller_id,
                customer_user_id=customer_user_id,
                external_order_ref=ref,
                placed_at=placed,
                expected_delivery_at=expected,
                status="PLACED",
                conn=conn,
            )
            order_id = int(order["order_id"])

            created_stages: List[Dict[str, Any]] = []

            # 2. Insert stages (custom or default baseline)
            if custom_stages:
                for s in custom_stages:
                    stage = self.order_repo.create_stage(
                        order_id=order_id,
                        stage_code=s["stage_code"],
                        sequence_no=int(s["sequence_no"]),
                        planned_start_at=s.get("planned_start_at"),
                        planned_end_at=s.get("planned_end_at"),
                        status="PENDING",
                        conn=conn,
                    )
                    created_stages.append(stage)
            else:
                cursor_time = placed

                for code, seq, prop in DEFAULT_STAGE_PROPORTIONS:
                    p_start = cursor_time
                    p_end = p_start + (expected - placed) * prop
                    stage = self.order_repo.create_stage(
                        order_id=order_id,
                        stage_code=code,
                        sequence_no=seq,
                        planned_start_at=p_start,
                        planned_end_at=p_end,
                        status="PENDING",
                        conn=conn,
                    )
                    created_stages.append(stage)
                    cursor_time = p_end

            conn.commit()

        order["stages"] = created_stages
        return order

    def list_orders(
        self,
        status: Optional[str] = None,
        seller_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List orders with filtering and pagination."""
        return self.order_repo.list_orders(
            status=status,
            seller_id=seller_id,
            limit=limit,
            offset=offset,
        )

    def get_order(self, order_id: int) -> Dict[str, Any]:
        """Retrieve order metadata with stages."""
        order = self.order_repo.get_order_by_id(order_id)
        if not order:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )
        order["stages"] = self.order_repo.get_order_stages(order_id)
        return order

    def get_order_stages(self, order_id: int) -> List[Dict[str, Any]]:
        """Retrieve operational stage baselines for an order."""
        order = self.order_repo.get_order_by_id(order_id)
        if not order:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )
        return self.order_repo.get_order_stages(order_id)

    def get_order_stats(self) -> Dict[str, Any]:
        """Retrieve aggregated order fulfillment metrics."""
        return self.order_repo.get_order_stats()

    def list_sellers(self) -> List[Dict[str, Any]]:
        """Retrieve list of registered sellers."""
        return self.order_repo.list_sellers()
