/**
 * Causara Domain and API Types
 * Full TypeScript contracts matching backend REST API v1.
 */

export interface ApiMeta {
  request_id: string;
  timestamp: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  meta: ApiMeta;
}

export interface HealthData {
  status: string;
  service: string;
  version: string;
  environment: string;
  database?: string;
}

export type HealthResponse = ApiSuccessResponse<HealthData>;

// --- User, Actor & Seller ---

export interface DemoActor {
  id: number;
  name: string;
  email: string;
  role: 'ANALYST' | 'MANAGER' | 'SELLER' | 'CUSTOMER' | string;
  label: string;
}

export interface User {
  user_id: number;
  full_name: string;
  email: string;
  is_active: boolean;
  role?: string;
  created_at: string;
}

export interface Seller {
  seller_id: number;
  owner_user_id: number;
  business_name: string;
  owner_name?: string;
  owner_email?: string;
}

// --- Order & Stages ---

export interface OrderStage {
  stage_id: number;
  order_id: number;
  stage_code: string;
  sequence_no: number;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
}

export interface Order {
  order_id: number;
  seller_id: number;
  customer_user_id: number;
  external_order_ref: string;
  placed_at: string;
  expected_delivery_at: string;
  actual_delivery_at: string | null;
  status: 'PLACED' | 'PROCESSING' | 'DISPATCHED' | 'IN_TRANSIT' | 'DELIVERED' | 'DELAYED' | 'CANCELLED';
  created_at: string;
  seller_business_name?: string;
  customer_name?: string;
  customer_email?: string;
  active_case_id?: number | null;
  stages?: OrderStage[];
}

export interface OrderListResponse {
  total: number;
  limit: number;
  offset: number;
  orders: Order[];
}

export interface OrderStats {
  total_orders: number;
  delivered_orders: number;
  active_orders: number;
  cancelled_orders: number;
  delayed_orders: number;
  open_cases_count: number;
}

export interface CreateOrderPayload {
  seller_id: number;
  customer_user_id: number;
  external_order_ref: string;
  placed_at?: string;
  expected_delivery_at: string;
  stages?: Array<{
    stage_code: string;
    sequence_no: number;
    planned_start_at?: string;
    planned_end_at?: string;
  }>;
}

// --- Timeline & Events ---

export interface TimelineEvent {
  event_id: number;
  order_id: number;
  stage_id: number | null;
  stage_code: string | null;
  event_type: string;
  occurred_at: string;
  received_at: string;
  source_type: string;
  source_provider: string | null;
  idempotency_key: string;
  description: string | null;
  sequence_position: number;
  validation_status: 'VALID' | 'OUT_OF_ORDER' | 'DUPLICATE' | 'CONFLICT';
  anomalies: string[];
}

export interface ReconstructedStage {
  stage_id: number;
  stage_code: string;
  sequence_no: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  planned_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  variance_minutes: number | null;
  time_lost_minutes: number;
  time_recovered_minutes: number;
  event_count: number;
  event_ids: number[];
  anomalies: string[];
}

export interface TimelineSummary {
  order_id: number;
  reconstructed_order_status: string;
  total_events: number;
  valid_event_count: number;
  out_of_order_count: number;
  duplicate_count: number;
  conflict_count: number;
  is_complete: boolean;
  has_anomalies: boolean;
  warnings: string[];
  customer_summary: string;
}

export interface ReconstructedTimeline {
  order_id: number;
  order_status: string;
  timeline: TimelineEvent[];
  stage_progression: ReconstructedStage[];
  summary: TimelineSummary;
  reconstructed_at: string;
}

// --- Evidence ---

export interface EvidenceItem {
  evidence_id: number;
  order_id: number;
  event_id: number | null;
  case_id: number | null;
  uploaded_by: number;
  blob_uri: string;
  file_name: string;
  content_type: string;
  sha256_hash: string | null;
  status: 'PENDING_UPLOAD' | 'ACTIVE' | 'ARCHIVED';
  uploaded_at: string | null;
  completed_at: string | null;
  upload_expires_at: string | null;
}

// --- Delay Analysis ---

export interface StageDelayMetric {
  stage_id: number;
  stage_code: string;
  sequence_no: number;
  status: string;
  planned_start_at: string | null;
  planned_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  planned_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  variance_minutes: number | null;
  excess_duration_minutes: number;
  time_recovered_minutes: number;
  is_delayed: boolean;
  has_missing_data: boolean;
  event_count: number;
  source_event_ids: number[];
  anomalies: string[];
}

export interface DelayGraphEdge {
  edge_id: number | null;
  case_id: number;
  from_stage_id: number;
  from_stage_code: string;
  to_stage_id: number;
  to_stage_code: string;
  edge_type: 'STAGE_TRANSITION' | 'BOTTLENECK_PROPAGATION' | 'CORRELATION';
  evidence_class: 'FACT' | 'HYPOTHESIS' | 'ESTIMATE';
  estimated_delay_minutes: number | null;
  explanation: string;
}

export interface DelayAnalysisReport {
  order_id: number;
  case_id: number | null;
  order_status: string;
  is_delayed: boolean;
  total_planned_duration_minutes: number | null;
  total_actual_duration_minutes: number | null;
  total_delivery_variance_minutes: number | null;
  primary_delay_stage_code: string | null;
  stage_metrics: StageDelayMetric[];
  delay_graph: DelayGraphEdge[];
  epistemological_breakdown: {
    facts: {
      description: string;
      observed_stages_count: number;
      records: Array<{
        stage_code: string;
        actual_start: string;
        actual_end: string;
        actual_duration_minutes: number;
      }>;
    };
    variances: {
      description: string;
      stages_with_variance_count: number;
      records: Array<{
        stage_code: string;
        variance_minutes: number;
        excess_duration_minutes: number;
      }>;
    };
    hypotheses: {
      description: string;
      candidate_edges_count: number;
    };
    estimates: {
      description: string;
      total_estimated_delay_minutes: number;
    };
  };
  missing_data_warnings: string[];
  disclaimer: string;
}

// --- Interventions ---

/**
 * Decimal or numeric field returned from SQL Server / PostgreSQL APIs.
 * Can be serialized as a string (e.g. "25.00", "0.8800"), a number, or null if unassigned/unestimated.
 */
export type DecimalValue = number | string | null;

export interface CandidateIntervention {
  intervention_id: number;
  intervention_code: string;
  name: string;
  intervention_type: string;
  applicable_stage_code: string;
  rationale: string;
  preconditions: string;
  expected_time_saved_minutes: number;
  estimated_cost: DecimalValue;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
}

// --- Scenarios ---

export interface ScenarioInterventionLink {
  intervention_id: number;
  intervention_code: string;
  name: string;
  intervention_type: string;
  description: string;
  estimated_cost_contribution: DecimalValue | null;
}

export interface DecisionScenario {
  scenario_id: number;
  case_id: number;
  scenario_name: string;
  status: 'PENDING_PERSISTENCE' | 'READY' | 'FAILED';
  predicted_time_saved_minutes: number;
  estimated_cost: DecimalValue;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence_score: DecimalValue;
  cosmos_document_id: string | null;
  model_version: string | null;
  created_at: string;
  interventions?: ScenarioInterventionLink[];
  assumptions?: string[];
}

// --- Decisions ---

export interface OperationalDecision {
  decision_id: number;
  case_id: number;
  scenario_id: number;
  decided_by: number;
  approved_by: number | null;
  decision_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  rationale: string;
  selected_at: string;
  approved_at: string | null;
  scenario_name?: string;
  predicted_time_saved_minutes?: number;
  estimated_cost?: DecimalValue;
  risk_level?: string;
  confidence_score?: DecimalValue;
  decided_by_name?: string;
  approved_by_name?: string | null;
}

// --- Outcome Verification ---

export interface OutcomeVerification {
  verification_id: number;
  decision_id: number;
  measured_at: string;
  original_expected_delivery_at: string;
  baseline_estimated_delivery_at: string | null;
  predicted_delivery_at: string;
  actual_delivery_at: string;
  signed_prediction_error_minutes: number;
  absolute_prediction_error_minutes: number;
  delivery_variance_minutes: number;
  outcome_notes: string | null;
}
