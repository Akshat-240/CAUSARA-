"""Intervention discovery engine for matching operational delay points to interventions."""

from dataclasses import asdict, dataclass
import logging
from typing import Any, Dict, List, Optional

from app.api.errors import APIError
from app.repositories.delay_repository import DelayRepository
from app.repositories.scenario_repository import ScenarioRepository
from app.services.delay_service import DelayAnalysisService

logger = logging.getLogger(__name__)


@dataclass
class CandidateIntervention:
    """Discovered candidate intervention tailored to an observed delay point."""

    intervention_id: int
    intervention_code: str
    name: str
    intervention_type: str
    applicable_stage_code: str
    rationale: str
    preconditions: str
    expected_time_saved_minutes: int
    estimated_cost: float
    risk_level: str  # LOW, MEDIUM, HIGH

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class InterventionService:
    """Service discovering and evaluating candidate operational interventions."""

    def __init__(
        self,
        scenario_repo: Optional[ScenarioRepository] = None,
        delay_repo: Optional[DelayRepository] = None,
        delay_service: Optional[DelayAnalysisService] = None,
    ) -> None:
        self.scenario_repo = scenario_repo or ScenarioRepository()
        self.delay_repo = delay_repo or DelayRepository()
        self.delay_service = delay_service or DelayAnalysisService()

    def discover_candidate_interventions(self, case_id: int) -> List[CandidateIntervention]:
        """Discover candidate interventions for a decision case based on delay analysis."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )

        order_id = int(case["order_id"])
        # Perform deterministic delay analysis
        report = self.delay_service.analyze_order_delay(order_id, persist_edges=False)

        # Retrieve active interventions catalogue
        active_interventions = self.scenario_repo.list_active_interventions()
        by_code = {item["intervention_code"]: item for item in active_interventions}

        candidates: List[CandidateIntervention] = []

        # Evaluate stage metrics for delay bottlenecks
        for stage in report.stage_metrics:
            excess = stage.excess_duration_minutes

            if stage.stage_code == "SELLER_PROCESSING" and (excess > 0 or stage.status == "IN_PROGRESS"):
                item = by_code.get("PRIORITY_PACKING")
                if item:
                    savings = max(60, min(excess if excess > 0 else 180, 240))
                    candidates.append(
                        CandidateIntervention(
                            intervention_id=int(item["intervention_id"]),
                            intervention_code=item["intervention_code"],
                            name=item["name"],
                            intervention_type=item["intervention_type"],
                            applicable_stage_code=stage.stage_code,
                            rationale=(
                                f"Stage '{stage.stage_code}' shows {excess} minutes excess duration. "
                                "Expediting warehouse picking and priority queue packaging compresses "
                                "remaining preparation time."
                            ),
                            preconditions="Order must not have been picked up by carrier yet.",
                            expected_time_saved_minutes=savings,
                            estimated_cost=25.00,
                            risk_level="LOW",
                        )
                    )

            elif stage.stage_code == "DISPATCH" and excess > 0:
                item = by_code.get("CARRIER_REROUTE")
                if item:
                    savings = max(120, min(excess, 480))
                    candidates.append(
                        CandidateIntervention(
                            intervention_id=int(item["intervention_id"]),
                            intervention_code=item["intervention_code"],
                            name=item["name"],
                            intervention_type=item["intervention_type"],
                            applicable_stage_code=stage.stage_code,
                            rationale=(
                                f"Dispatch handover bottleneck of {excess} minutes detected. "
                                "Rerouting consignment to an alternative carrier partner eliminates "
                                "terminal dwell time."
                            ),
                            preconditions="Alternative carrier capacity confirmed in dispatch origin zone.",
                            expected_time_saved_minutes=savings,
                            estimated_cost=65.00,
                            risk_level="MEDIUM",
                        )
                    )

            elif stage.stage_code == "LINEHAUL_TRANSPORT" and excess > 0:
                # If excess > 720 min (12h), air freight is applicable
                if excess >= 720:
                    item_air = by_code.get("AIR_FREIGHT_UPGRADE")
                    if item_air:
                        savings = max(360, min(excess, 1200))
                        candidates.append(
                            CandidateIntervention(
                                intervention_id=int(item_air["intervention_id"]),
                                intervention_code=item_air["intervention_code"],
                                name=item_air["name"],
                                intervention_type=item_air["intervention_type"],
                                applicable_stage_code=stage.stage_code,
                                rationale=(
                                    f"Major linehaul delay of {excess} minutes observed. "
                                    "Upgrading from surface ground to air cargo recovers significant linehaul "
                                    "transit buffer."
                                ),
                                preconditions="Consignment dimensions and weight must conform to air cargo limits.",
                                expected_time_saved_minutes=savings,
                                estimated_cost=180.00,
                                risk_level="HIGH",
                            )
                        )
                else:
                    item_reroute = by_code.get("CARRIER_REROUTE")
                    if item_reroute:
                        savings = max(90, min(excess, 360))
                        candidates.append(
                            CandidateIntervention(
                                intervention_id=int(item_reroute["intervention_id"]),
                                intervention_code=item_reroute["intervention_code"],
                                name=item_reroute["name"],
                                intervention_type=item_reroute["intervention_type"],
                                applicable_stage_code=stage.stage_code,
                                rationale=(
                                    f"Linehaul delay of {excess} minutes observed. "
                                    "Rerouting through expedited secondary ground linehaul restores transit velocity."
                                ),
                                preconditions="Secondary ground corridor active and within operating window.",
                                expected_time_saved_minutes=savings,
                                estimated_cost=65.00,
                                risk_level="MEDIUM",
                            )
                        )

            elif stage.stage_code in ("LAST_MILE", "HUB_SORTING") and excess > 0:
                item_hub = by_code.get("HUB_EXPEDITE")
                if item_hub:
                    savings = max(60, min(excess, 240))
                    candidates.append(
                        CandidateIntervention(
                            intervention_id=int(item_hub["intervention_id"]),
                            intervention_code=item_hub["intervention_code"],
                            name=item_hub["name"],
                            intervention_type=item_hub["intervention_type"],
                            applicable_stage_code=stage.stage_code,
                            rationale=(
                                f"Distribution hub sorting bottleneck of {excess} minutes detected. "
                                "Priority dock processing accelerates transfer to local delivery dispatch."
                            ),
                            preconditions="Package arrived at destination distribution hub facility.",
                            expected_time_saved_minutes=savings,
                            estimated_cost=35.00,
                            risk_level="LOW",
                        )
                    )

        # Proactive customer communication is always recommended if there is any delay or risk
        if report.is_delayed or any(s.excess_duration_minutes > 0 for s in report.stage_metrics):
            item_notice = by_code.get("CUSTOMER_PROACTIVE_NOTICE")
            if item_notice:
                candidates.append(
                    CandidateIntervention(
                        intervention_id=int(item_notice["intervention_id"]),
                        intervention_code=item_notice["intervention_code"],
                        name=item_notice["name"],
                        intervention_type=item_notice["intervention_type"],
                        applicable_stage_code=report.primary_delay_stage_code or "ORDER",
                        rationale=(
                            "Proactive communication informs buyer with revised delivery commitment, "
                            "preserving trust and eliminating inbound support escalation."
                        ),
                        preconditions="Valid customer notification channel (SMS or Email) on file.",
                        expected_time_saved_minutes=0,
                        estimated_cost=0.00,
                        risk_level="LOW",
                    )
                )

        # Deduplicate candidates by intervention_id
        unique_candidates: Dict[int, CandidateIntervention] = {}
        for c in candidates:
            if c.intervention_id not in unique_candidates:
                unique_candidates[c.intervention_id] = c
            else:
                # Keep candidate with higher expected time savings
                if c.expected_time_saved_minutes > unique_candidates[c.intervention_id].expected_time_saved_minutes:
                    unique_candidates[c.intervention_id] = c

        return list(unique_candidates.values())
