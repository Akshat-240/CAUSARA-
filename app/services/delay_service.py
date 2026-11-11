"""Delay-Chain Reconstruction and Investigation Engine.

Performs deterministic delay analysis by comparing observed stage durations
against planned baselines and constructing explainable delay relationships.
Enforces strict epistemological boundaries:
- Distinguishes observed facts, calculated variances, hypotheses, and estimates.
- Never asserts that duration variance alone proves causal fault or responsibility.
- Does not invent delays where timestamps or stages are missing.
"""

from dataclasses import asdict, dataclass, field
import logging
from typing import Any, Dict, List, Optional

from app.api.errors import APIError
from app.database.connection import get_db_connection
from app.repositories.delay_repository import DelayRepository
from app.repositories.timeline_repository import TimelineRepository
from app.services.timeline_service import TimelineService, ReconstructedTimeline

logger = logging.getLogger(__name__)


@dataclass
class StageDelayMetric:
    """Calculated duration and variance metrics for a single operational stage."""

    stage_id: int
    stage_code: str
    sequence_no: int
    status: str
    planned_start_at: Optional[str]
    planned_end_at: Optional[str]
    actual_start_at: Optional[str]
    actual_end_at: Optional[str]
    planned_duration_minutes: Optional[int]
    actual_duration_minutes: Optional[int]
    variance_minutes: Optional[int]
    excess_duration_minutes: int
    time_recovered_minutes: int
    is_delayed: bool
    has_missing_data: bool
    event_count: int
    source_event_ids: List[int] = field(default_factory=list)
    anomalies: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DelayGraphEdge:
    """Graph edge representing a transition or hypothesized delay propagation."""

    edge_id: Optional[int]
    case_id: int
    from_stage_id: int
    from_stage_code: str
    to_stage_id: int
    to_stage_code: str
    edge_type: str  # STAGE_TRANSITION, BOTTLENECK_PROPAGATION, CORRELATION
    evidence_class: str  # FACT, HYPOTHESIS, ESTIMATE
    estimated_delay_minutes: Optional[int]
    explanation: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DelayAnalysisReport:
    """Comprehensive epistemologically-partitioned delay analysis report."""

    order_id: int
    case_id: Optional[int]
    order_status: str
    is_delayed: bool
    total_planned_duration_minutes: Optional[int]
    total_actual_duration_minutes: Optional[int]
    total_delivery_variance_minutes: Optional[int]
    primary_delay_stage_code: Optional[str]
    stage_metrics: List[StageDelayMetric]
    delay_graph: List[DelayGraphEdge]
    epistemological_breakdown: Dict[str, Any]
    missing_data_warnings: List[str]
    disclaimer: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "order_id": self.order_id,
            "case_id": self.case_id,
            "order_status": self.order_status,
            "is_delayed": self.is_delayed,
            "total_planned_duration_minutes": self.total_planned_duration_minutes,
            "total_actual_duration_minutes": self.total_actual_duration_minutes,
            "total_delivery_variance_minutes": self.total_delivery_variance_minutes,
            "primary_delay_stage_code": self.primary_delay_stage_code,
            "stage_metrics": [m.to_dict() for m in self.stage_metrics],
            "delay_graph": [e.to_dict() for e in self.delay_graph],
            "epistemological_breakdown": self.epistemological_breakdown,
            "missing_data_warnings": self.missing_data_warnings,
            "disclaimer": self.disclaimer,
        }


class DelayAnalysisService:
    """Service executing deterministic delay-chain reconstruction and case management."""

    DISCLAIMER = (
        "Epistemological Guardrail: Duration variance indicates deviation from planned schedule buffers. "
        "It constitutes an observed arithmetic variance and does not, in isolation, prove causal blame "
        "or responsibility."
    )

    def __init__(
        self,
        delay_repo: Optional[DelayRepository] = None,
        timeline_repo: Optional[TimelineRepository] = None,
        timeline_service: Optional[TimelineService] = None,
    ) -> None:
        self.delay_repo = delay_repo or DelayRepository()
        self.timeline_repo = timeline_repo or TimelineRepository()
        self.timeline_service = timeline_service or TimelineService()

    def analyze_order_delay(
        self,
        order_id: int,
        creator_user_id: Optional[int] = None,
        persist_edges: bool = True,
    ) -> DelayAnalysisReport:
        """Execute delay-chain analysis for an order.

        1. Reconstruct factual timeline.
        2. Calculate stage variances and excess durations.
        3. Identify missing data preventing reliable attribution.
        4. Construct and optionally persist delay edges for decision case.
        """
        # Fetch order
        order = self.timeline_repo.get_order(order_id)
        if not order:
            raise APIError(
                code="ORDER_NOT_FOUND",
                message=f"Order {order_id} does not exist.",
                status_code=404,
            )

        # 1. Reconstruct timeline facts
        reconstructed: ReconstructedTimeline = self.timeline_service.reconstruct_order_timeline(
            order_id=order_id,
            persist_stage_actuals=True,
            record_audit=False,
        )

        # 2. Compute stage metrics
        stage_metrics: List[StageDelayMetric] = []
        missing_data_warnings: List[str] = []
        observed_facts: List[Dict[str, Any]] = []
        duration_variances: List[Dict[str, Any]] = []

        total_planned_min = 0
        total_actual_min = 0
        has_full_planned = True
        has_full_actual = True

        for s in reconstructed.stage_progression:
            is_delayed = bool(s.time_lost_minutes > 0)
            has_missing = bool(s.status == "SKIPPED" or (s.status == "COMPLETED" and s.actual_duration_minutes is None))

            if s.status == "SKIPPED":
                missing_data_warnings.append(
                    f"Stage '{s.stage_code}' was skipped. Missing timestamps prevent attribution."
                )

            if s.planned_duration_minutes is not None:
                total_planned_min += s.planned_duration_minutes
            else:
                has_full_planned = False

            if s.actual_duration_minutes is not None:
                total_actual_min += s.actual_duration_minutes
            else:
                has_full_actual = False

            metric = StageDelayMetric(
                stage_id=s.stage_id or 0,
                stage_code=s.stage_code,
                sequence_no=s.sequence_no,
                status=s.status,
                planned_start_at=s.planned_start_at,
                planned_end_at=s.planned_end_at,
                actual_start_at=s.actual_start_at,
                actual_end_at=s.actual_end_at,
                planned_duration_minutes=s.planned_duration_minutes,
                actual_duration_minutes=s.actual_duration_minutes,
                variance_minutes=s.variance_minutes,
                excess_duration_minutes=s.time_lost_minutes,
                time_recovered_minutes=s.time_recovered_minutes,
                is_delayed=is_delayed,
                has_missing_data=has_missing,
                event_count=s.event_count,
                source_event_ids=s.event_ids,
                anomalies=s.anomalies,
            )
            stage_metrics.append(metric)

            # Record epistemological facts
            if s.actual_start_at and s.actual_end_at:
                observed_facts.append({
                    "stage_code": s.stage_code,
                    "actual_start": s.actual_start_at,
                    "actual_end": s.actual_end_at,
                    "actual_duration_minutes": s.actual_duration_minutes,
                })

            if s.variance_minutes is not None:
                duration_variances.append({
                    "stage_code": s.stage_code,
                    "variance_minutes": s.variance_minutes,
                    "excess_duration_minutes": s.time_lost_minutes,
                })

        # Calculate total delivery variance
        overall_delivery_variance: Optional[int] = None
        if has_full_planned and has_full_actual:
            overall_delivery_variance = total_actual_min - total_planned_min
        elif any(m.variance_minutes is not None for m in stage_metrics):
            # Sum observable variances
            overall_delivery_variance = sum(m.variance_minutes for m in stage_metrics if m.variance_minutes is not None)

        is_order_delayed = bool(
            (overall_delivery_variance and overall_delivery_variance > 0)
            or any(m.is_delayed for m in stage_metrics)
        )

        # Identify primary delayed stage (maximum excess duration)
        delayed_stages = [m for m in stage_metrics if m.excess_duration_minutes > 0]
        primary_delay_stage = (
            max(delayed_stages, key=lambda m: m.excess_duration_minutes).stage_code
            if delayed_stages
            else None
        )

        # 3. Create or fetch decision case if persisting edges
        case_id: Optional[int] = None
        case_creator = creator_user_id or int(order.get("customer_user_id") or 1)

        if persist_edges:
            case_record = self.delay_repo.get_or_create_case(
                order_id=order_id,
                created_by=case_creator,
                case_title=f"Delay Investigation for Order #{order_id}",
            )
            case_id = int(case_record["case_id"])

        # 4. Construct Delay Graph Edges
        graph_edges: List[DelayGraphEdge] = []
        valid_stages_with_ids = [m for m in stage_metrics if m.stage_id > 0]

        # Stage Transition Edges (Sequential Handover - FACT)
        for i in range(len(valid_stages_with_ids) - 1):
            curr_s = valid_stages_with_ids[i]
            next_s = valid_stages_with_ids[i + 1]

            edge_expl = f"Handover from stage '{curr_s.stage_code}' to '{next_s.stage_code}'."
            graph_edges.append(
                DelayGraphEdge(
                    edge_id=None,
                    case_id=case_id or 0,
                    from_stage_id=curr_s.stage_id,
                    from_stage_code=curr_s.stage_code,
                    to_stage_id=next_s.stage_id,
                    to_stage_code=next_s.stage_code,
                    edge_type="STAGE_TRANSITION",
                    evidence_class="FACT",
                    estimated_delay_minutes=curr_s.excess_duration_minutes if curr_s.is_delayed else 0,
                    explanation=edge_expl,
                )
            )

        # Bottleneck Propagation Edges (Delayed stage impacting downstream stages - HYPOTHESIS)
        for i, curr_s in enumerate(valid_stages_with_ids):
            if curr_s.excess_duration_minutes > 0 and i + 1 < len(valid_stages_with_ids):
                subsequent_s = valid_stages_with_ids[i + 1]
                prop_expl = (
                    f"Potential bottleneck propagation: {curr_s.excess_duration_minutes} mins excess duration in "
                    f"'{curr_s.stage_code}' may have compressed planned buffer for '{subsequent_s.stage_code}'."
                )
                graph_edges.append(
                    DelayGraphEdge(
                        edge_id=None,
                        case_id=case_id or 0,
                        from_stage_id=curr_s.stage_id,
                        from_stage_code=curr_s.stage_code,
                        to_stage_id=subsequent_s.stage_id,
                        to_stage_code=subsequent_s.stage_code,
                        edge_type="BOTTLENECK_PROPAGATION",
                        evidence_class="HYPOTHESIS",
                        estimated_delay_minutes=curr_s.excess_duration_minutes,
                        explanation=prop_expl,
                    )
                )

        # 5. Persist graph edges to database
        if persist_edges and case_id:
            with get_db_connection() as conn:
                self.delay_repo.delete_delay_edges_for_case(case_id, conn=conn)
                for edge in graph_edges:
                    saved = self.delay_repo.insert_delay_edge(
                        case_id=case_id,
                        from_stage_id=edge.from_stage_id,
                        to_stage_id=edge.to_stage_id,
                        edge_type=edge.edge_type,
                        evidence_class=edge.evidence_class,
                        estimated_delay_minutes=edge.estimated_delay_minutes,
                        explanation=edge.explanation,
                        conn=conn,
                    )
                    edge.edge_id = saved.get("edge_id")
                conn.commit()

        # 6. Epistemological partition
        breakdown = {
            "facts": {
                "description": "Directly observed timestamps, event counts, and stage progress.",
                "observed_stages_count": len(observed_facts),
                "records": observed_facts,
            },
            "variances": {
                "description": "Calculated mathematical delta (actual duration - planned duration).",
                "stages_with_variance_count": len(duration_variances),
                "records": duration_variances,
            },
            "hypotheses": {
                "description": "Formulated causal relationships and bottleneck propagation candidate edges.",
                "candidate_edges_count": len([e for e in graph_edges if e.evidence_class == "HYPOTHESIS"]),
            },
            "estimates": {
                "description": "Projected delay minutes and estimated downstream impacts.",
                "total_estimated_delay_minutes": sum(m.excess_duration_minutes for m in stage_metrics),
            },
        }

        return DelayAnalysisReport(
            order_id=order_id,
            case_id=case_id,
            order_status=reconstructed.order_status,
            is_delayed=is_order_delayed,
            total_planned_duration_minutes=total_planned_min if has_full_planned else None,
            total_actual_duration_minutes=total_actual_min if has_full_actual else None,
            total_delivery_variance_minutes=overall_delivery_variance,
            primary_delay_stage_code=primary_delay_stage,
            stage_metrics=stage_metrics,
            delay_graph=graph_edges,
            epistemological_breakdown=breakdown,
            missing_data_warnings=missing_data_warnings,
            disclaimer=self.DISCLAIMER,
        )

    def get_case_delay_graph(self, case_id: int) -> List[Dict[str, Any]]:
        """Retrieve persisted delay edges for a decision case."""
        case = self.delay_repo.get_case_by_id(case_id)
        if not case:
            raise APIError(
                code="RESOURCE_NOT_FOUND",
                message=f"Decision case {case_id} does not exist.",
                status_code=404,
            )
        return self.delay_repo.list_delay_edges_by_case(case_id)
