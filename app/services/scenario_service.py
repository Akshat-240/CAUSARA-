"""Scenario simulation service for evaluating and comparing intervention strategies."""

import logging
from typing import Any, Dict, List, Optional
import uuid

from app.api.errors import APIError
from app.repositories.delay_repository import DelayRepository
from app.repositories.scenario_repository import ScenarioRepository
from app.services.intervention_service import InterventionService

logger = logging.getLogger(__name__)

# Fallback baseline estimates per intervention code
INTERVENTION_DEFAULTS = {
    "PRIORITY_PACKING": {"time_saved": 180, "cost": 25.00, "risk": "LOW"},
    "CARRIER_REROUTE": {"time_saved": 360, "cost": 65.00, "risk": "MEDIUM"},
    "AIR_FREIGHT_UPGRADE": {"time_saved": 720, "cost": 180.00, "risk": "HIGH"},
    "HUB_EXPEDITE": {"time_saved": 180, "cost": 35.00, "risk": "LOW"},
    "CUSTOMER_PROACTIVE_NOTICE": {"time_saved": 0, "cost": 0.00, "risk": "LOW"},
}

RISK_ORDER = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
RISK_BY_VALUE = {1: "LOW", 2: "MEDIUM", 3: "HIGH"}


class ScenarioService:
    """Service simulating intervention scenarios for decision cases."""

    def __init__(
        self,
        scenario_repo: Optional[ScenarioRepository] = None,
        delay_repo: Optional[DelayRepository] = None,
        intervention_service: Optional[InterventionService] = None,
    ) -> None:
        self.scenario_repo = scenario_repo or ScenarioRepository()
        self.delay_repo = delay_repo or DelayRepository()
        self.intervention_service = intervention_service or InterventionService(
            scenario_repo=self.scenario_repo,
            delay_repo=self.delay_repo,
        )

    def simulate_scenario(
        self,
        case_id: int,
        scenario_name: str,
        intervention_ids: List[int],
        assumptions: Optional[List[str]] = None,
        cosmos_document_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Simulate a decision scenario containing one or more interventions."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )

        if not intervention_ids:
            raise APIError(
                code="BAD_REQUEST",
                message="At least one intervention must be selected to simulate a scenario.",
                status_code=400,
            )

        # Retrieve discovered interventions to use context-aware savings/costs if available
        candidates = self.intervention_service.discover_candidate_interventions(case_id)
        candidate_by_id = {c.intervention_id: c for c in candidates}

        interventions_to_link: List[Dict[str, Any]] = []
        total_time_saved = 0
        total_cost = 0.0
        max_risk_val = 1

        for i_id in intervention_ids:
            cand = candidate_by_id.get(i_id)
            if cand:
                i_cost = cand.estimated_cost
                i_time = cand.expected_time_saved_minutes
                i_risk = cand.risk_level
                i_code = cand.intervention_code
            else:
                raw_int = self.scenario_repo.get_intervention_by_id(i_id)
                if not raw_int:
                    raise APIError(
                        code="BAD_REQUEST",
                        message=f"Intervention id {i_id} is not valid.",
                        status_code=400,
                    )
                i_code = raw_int["intervention_code"]
                defaults = INTERVENTION_DEFAULTS.get(i_code, {"time_saved": 60, "cost": 20.0, "risk": "LOW"})
                i_cost = float(defaults["cost"])
                i_time = int(defaults["time_saved"])
                i_risk = defaults["risk"]

            total_cost += i_cost
            total_time_saved += i_time
            max_risk_val = max(max_risk_val, RISK_ORDER.get(i_risk, 1))

            interventions_to_link.append({
                "intervention_id": i_id,
                "cost_contribution": i_cost,
                "intervention_code": i_code,
            })

        risk_level = RISK_BY_VALUE[max_risk_val]

        # Calculate confidence score based on risk profile and data completeness
        if risk_level == "LOW":
            confidence = 0.8800
        elif risk_level == "MEDIUM":
            confidence = 0.7500
        else:
            confidence = 0.6200

        doc_id = cosmos_document_id or f"sim-{uuid.uuid4().hex[:12]}"

        # Insert scenario
        scenario = self.scenario_repo.insert_scenario(
            case_id=case_id,
            scenario_name=scenario_name,
            predicted_time_saved_minutes=total_time_saved,
            estimated_cost=round(total_cost, 2),
            risk_level=risk_level,
            confidence_score=confidence,
            status="READY",
            cosmos_document_id=doc_id,
            model_version="v1.0-rules-engine",
        )

        scenario_id = int(scenario["scenario_id"])

        # Link interventions
        for item in interventions_to_link:
            self.scenario_repo.insert_scenario_intervention(
                scenario_id=scenario_id,
                intervention_id=item["intervention_id"],
                estimated_cost_contribution=item["cost_contribution"],
            )

        full_scenario = self.scenario_repo.get_scenario_by_id(scenario_id)
        if full_scenario:
            full_scenario["assumptions"] = assumptions or [
                "Operational window and buffer estimates valid at calculation timestamp.",
                "Carrier partner capacity availability subject to real-time dispatch booking.",
            ]
            return full_scenario
        return scenario

    def auto_generate_scenarios_for_case(self, case_id: int) -> List[Dict[str, Any]]:
        """Automatically synthesize candidate scenarios for side-by-side comparison."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )

        candidates = self.intervention_service.discover_candidate_interventions(case_id)
        if not candidates:
            # Fallback to general proactive notice
            active = self.scenario_repo.list_active_interventions()
            notice = next((i for i in active if i["intervention_code"] == "CUSTOMER_PROACTIVE_NOTICE"), None)
            if notice:
                sc = self.simulate_scenario(
                    case_id=case_id,
                    scenario_name="Customer Transparency Scenario",
                    intervention_ids=[int(notice["intervention_id"])],
                    assumptions=["Maintains customer expectation without modifying transit route."],
                )
                return [sc]
            return []

        created_scenarios: List[Dict[str, Any]] = []

        # Scenario 1: Aggressive Recovery (High or Medium risk transit intervention + notice)
        transit_candidates = [c for c in candidates if c.risk_level in ("HIGH", "MEDIUM")]
        notice_candidates = [c for c in candidates if c.intervention_code == "CUSTOMER_PROACTIVE_NOTICE"]

        if transit_candidates:
            primary_transit = transit_candidates[0]
            int_ids = [primary_transit.intervention_id]
            if notice_candidates:
                int_ids.append(notice_candidates[0].intervention_id)

            sc1 = self.simulate_scenario(
                case_id=case_id,
                scenario_name=f"Expedited Transit Strategy ({primary_transit.name})",
                intervention_ids=int_ids,
                assumptions=[
                    "Immediate carrier dispatch cut-off adheres to booking deadline.",
                    "Proactive notification informs buyer of expedited transit.",
                ],
            )
            created_scenarios.append(sc1)

        # Scenario 2: Conservative / Localized Intervention
        warehouse_candidates = [
            c for c in candidates
            if c.risk_level == "LOW" and c.intervention_code != "CUSTOMER_PROACTIVE_NOTICE"
        ]
        if warehouse_candidates:
            primary_wh = warehouse_candidates[0]
            int_ids = [primary_wh.intervention_id]
            if notice_candidates:
                int_ids.append(notice_candidates[0].intervention_id)

            sc2 = self.simulate_scenario(
                case_id=case_id,
                scenario_name=f"Localized Expedite ({primary_wh.name})",
                intervention_ids=int_ids,
                assumptions=["Dock and packaging staff assigned immediately to priority queue."],
            )
            created_scenarios.append(sc2)

        # Scenario 3: Communication & Expectation Reset Only
        if notice_candidates:
            sc3 = self.simulate_scenario(
                case_id=case_id,
                scenario_name="Proactive Customer Notice Strategy",
                intervention_ids=[notice_candidates[0].intervention_id],
                assumptions=["Zero additional transport spend; sets realistic revised ETA."],
            )
            created_scenarios.append(sc3)

        return created_scenarios

    def get_scenario(self, scenario_id: int) -> Dict[str, Any]:
        """Retrieve a simulated scenario by ID."""
        scenario = self.scenario_repo.get_scenario_by_id(scenario_id)
        if not scenario:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Scenario {scenario_id} does not exist.",
                status_code=404,
            )
        return scenario

    def list_case_scenarios(self, case_id: int) -> List[Dict[str, Any]]:
        """List all scenarios simulated for a decision case."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )
        return self.scenario_repo.list_scenarios_by_case(case_id)
