"""Service managing decision governance, approval lifecycle, and outcome verification."""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, List, Optional

from app.api.errors import APIError
from app.repositories.decision_repository import DecisionRepository
from app.repositories.delay_repository import DelayRepository
from app.repositories.scenario_repository import ScenarioRepository
from app.repositories.timeline_repository import TimelineRepository

logger = logging.getLogger(__name__)


class DecisionService:
    """Service governing intervention decision approvals and prediction verifications."""

    def __init__(
        self,
        decision_repo: Optional[DecisionRepository] = None,
        scenario_repo: Optional[ScenarioRepository] = None,
        delay_repo: Optional[DelayRepository] = None,
        timeline_repo: Optional[TimelineRepository] = None,
    ) -> None:
        self.decision_repo = decision_repo or DecisionRepository()
        self.scenario_repo = scenario_repo or ScenarioRepository()
        self.delay_repo = delay_repo or DelayRepository()
        self.timeline_repo = timeline_repo or TimelineRepository()

    def record_decision(
        self,
        case_id: int,
        scenario_id: int,
        decided_by: int,
        rationale: str,
    ) -> Dict[str, Any]:
        """Record an operational decision selecting a simulated scenario for a case."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )

        scenario = self.scenario_repo.get_scenario_by_id(scenario_id)
        if not scenario:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Scenario {scenario_id} does not exist.",
                status_code=404,
            )

        if int(scenario["case_id"]) != case_id:
            raise APIError(
                code="BAD_REQUEST",
                message=f"Scenario {scenario_id} does not belong to case {case_id}.",
                status_code=400,
            )

        if not rationale or not rationale.strip():
            raise APIError(
                code="BAD_REQUEST",
                message="Decision rationale is mandatory.",
                status_code=400,
            )

        try:
            decision_id = self.decision_repo.record_decision(
                case_id=case_id,
                scenario_id=scenario_id,
                decided_by=decided_by,
                rationale=rationale.strip(),
            )
        except Exception as ex:
            logger.error("Failed to record decision: %s", ex)
            raise APIError(
                code="DATABASE_ERROR",
                message=f"Failed to record decision: {ex}",
                status_code=500,
            )

        # Update case status to PENDING_APPROVAL
        self.delay_repo.update_case_status(case_id=case_id, status="PENDING_APPROVAL")

        record = self.decision_repo.get_decision_by_id(decision_id)
        if not record:
            raise APIError(
                code="INTERNAL_ERROR",
                message="Decision was inserted but could not be re-queried.",
                status_code=500,
            )
        return record

    def approve_decision(
        self,
        decision_id: int,
        manager_user_id: int,
    ) -> Dict[str, Any]:
        """Approve a pending decision, closing the case and triggering downstream execution."""
        decision = self.decision_repo.get_decision_by_id(decision_id)
        if not decision:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision {decision_id} does not exist.",
                status_code=404,
            )

        if decision["decision_status"] != "PENDING":
            raise APIError(
                code="CONFLICT",
                message=f"Cannot approve decision with status '{decision['decision_status']}'. Must be 'PENDING'.",
                status_code=409,
            )

        try:
            self.decision_repo.approve_decision(decision_id=decision_id, manager_user_id=manager_user_id)
        except Exception as ex:
            logger.error("Failed to approve decision %s: %s", decision_id, ex)
            raise APIError(
                code="APPROVAL_FAILED",
                message=f"Failed to approve decision: {ex}",
                status_code=500,
            )

        # Mark decision case as CLOSED
        case_id = int(decision["case_id"])
        self.delay_repo.update_case_status(
            case_id=case_id,
            status="CLOSED",
            closed_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )

        return self.decision_repo.get_decision_by_id(decision_id) or {}

    def reject_decision(
        self,
        decision_id: int,
        manager_user_id: int,
        rejection_reason: str,
    ) -> Dict[str, Any]:
        """Reject a pending decision."""
        decision = self.decision_repo.get_decision_by_id(decision_id)
        if not decision:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision {decision_id} does not exist.",
                status_code=404,
            )

        if decision["decision_status"] != "PENDING":
            raise APIError(
                code="CONFLICT",
                message=f"Cannot reject decision with status '{decision['decision_status']}'. Must be 'PENDING'.",
                status_code=409,
            )

        reason = rejection_reason.strip() if rejection_reason else "Rejected by manager."
        self.decision_repo.reject_decision(
            decision_id=decision_id,
            manager_user_id=manager_user_id,
            rejection_reason=reason,
        )

        # Reopen case for continued analysis
        case_id = int(decision["case_id"])
        self.delay_repo.update_case_status(case_id=case_id, status="ANALYZING")

        return self.decision_repo.get_decision_by_id(decision_id) or {}

    def verify_prediction(
        self,
        decision_id: int,
        actual_delivery_at: Optional[datetime] = None,
        outcome_notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reconcile and verify decision's predicted delivery outcome against actual delivery."""
        decision = self.decision_repo.get_decision_by_id(decision_id)
        if not decision:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision {decision_id} does not exist.",
                status_code=404,
            )

        # If actual_delivery_at is not supplied, check the underlying order's actual delivery
        actual_at = actual_delivery_at
        if not actual_at:
            case = self.delay_repo.get_case_by_id(int(decision["case_id"]))
            if case:
                order = self.timeline_repo.get_order(int(case["order_id"]))
                if order and order.get("actual_delivery_at"):
                    actual_at = order["actual_delivery_at"]

        if not actual_at:
            raise APIError(
                code="BAD_REQUEST",
                message="Cannot verify outcome: actual_delivery_at was not provided and order is not delivered.",
                status_code=400,
            )

        notes = outcome_notes or f"Automated prediction verification for decision #{decision_id}."
        try:
            self.decision_repo.verify_prediction(
                decision_id=decision_id,
                actual_delivery_at=actual_at,
                outcome_notes=notes,
            )
        except Exception as ex:
            logger.error("Failed to execute prediction verification: %s", ex)
            raise APIError(
                code="VERIFICATION_FAILED",
                message=f"Failed to verify prediction: {ex}",
                status_code=500,
            )

        verification = self.decision_repo.get_verification_by_decision_id(decision_id)
        if not verification:
            raise APIError(
                code="INTERNAL_ERROR",
                message="Verification succeeded but record could not be retrieved.",
                status_code=500,
            )
        return verification

    def get_decision(self, decision_id: int) -> Dict[str, Any]:
        """Retrieve decision details by ID."""
        decision = self.decision_repo.get_decision_by_id(decision_id)
        if not decision:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision {decision_id} does not exist.",
                status_code=404,
            )
        return decision

    def list_case_decisions(self, case_id: int) -> List[Dict[str, Any]]:
        """List all decisions recorded for a case."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )
        return self.decision_repo.list_decisions_by_case(case_id)

    def get_decision_verification(self, decision_id: int) -> Dict[str, Any]:
        """Retrieve verified prediction outcomes for a decision."""
        decision = self.decision_repo.get_decision_by_id(decision_id)
        if not decision:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision {decision_id} does not exist.",
                status_code=404,
            )

        verification = self.decision_repo.get_verification_by_decision_id(decision_id)
        if not verification:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"No verification record found for decision {decision_id}.",
                status_code=404,
            )
        return verification
