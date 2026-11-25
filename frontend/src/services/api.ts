import {
  AuthUser,
  CandidateIntervention,
  CreateOrderPayload,
  DecisionScenario,
  DelayAnalysisReport,
  DelayGraphEdge,
  DemoActor,
  EvidenceItem,
  HealthData,
  LoginPayload,
  OperationalDecision,
  Order,
  OrderListResponse,
  OrderStage,
  OrderStats,
  OutcomeVerification,
  ReconstructedTimeline,
  RegisterPayload,
  RoleOption,
  Seller,
  User,
  ApiErrorResponse,
  ApiSuccessResponse,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const AUTH_TOKEN_KEY = 'causara_token';

let inMemoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAuthToken(): string | null {
  if (inMemoryToken) {
    return inMemoryToken;
  }
  try {
    const stored = localStorage.getItem(AUTH_TOKEN_KEY);
    if (stored) {
      inMemoryToken = stored;
      return stored;
    }
    const storedUser = localStorage.getItem('causara_user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser) as { token?: string };
      if (parsed?.token) {
        inMemoryToken = parsed.token;
        return parsed.token;
      }
    }
  } catch {
    // Ignore storage read failures
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage write failures
  }
}

export function clearAuthSession(): void {
  inMemoryToken = null;
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem('causara_user');
  } catch {
    // Ignore storage clear failures
  }
}

export function registerUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function isSameApiOrigin(targetUrl: string): boolean {
  if (!/^https?:\/\//i.test(targetUrl)) {
    return true;
  }
  try {
    const base = /^https?:\/\//i.test(API_BASE_URL)
      ? new URL(API_BASE_URL).origin
      : window.location.origin;
    return new URL(targetUrl).origin === base;
  } catch {
    return false;
  }
}

/**
 * Generic request handler enforcing standard Causara API envelopes,
 * centralized error extraction, network failure handling, and signal cancellation.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  // Attach Authorization Bearer token only for requests targeting Causara API origin
  const token = getAuthToken();
  if (token && !headers.has('Authorization') && isSameApiOrigin(url)) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Set Content-Type only if body is string (not FormData)
  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    const netMsg = err instanceof Error ? err.message : 'Network failure reaching backend service';
    throw new Error(`Connection Error: ${netMsg}`);
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !endpoint.startsWith('/auth/login') &&
      !endpoint.startsWith('/auth/register')
    ) {
      clearAuthSession();
      if (unauthorizedHandler) {
        unauthorizedHandler();
      }
    }
    let errorMessage = `HTTP ${response.status} (${response.statusText})`;
    try {
      const errorJson: ApiErrorResponse = await response.json();
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // Fallback to HTTP error
    }
    throw new Error(errorMessage);
  }

  const json: ApiSuccessResponse<T> = await response.json();
  return json.data;
}

// ==========================================
// 1. System Health & Platform Identity
// ==========================================

export async function fetchHealth(signal?: AbortSignal): Promise<HealthData> {
  return request<HealthData>('/health', { method: 'GET', signal });
}

export async function fetchActors(signal?: AbortSignal): Promise<DemoActor[]> {
  const res = await request<{ actors: DemoActor[]; count: number }>('/actors', {
    method: 'GET',
    signal,
  });
  return res.actors;
}

export async function fetchUsers(
  params?: { role?: string; limit?: number; offset?: number },
  signal?: AbortSignal
): Promise<User[]> {
  const query = new URLSearchParams();
  if (params?.role) query.set('role', params.role);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const qs = query.toString();

  const res = await request<{ users: User[]; count: number }>(`/users${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    signal,
  });
  return res.users;
}

export async function fetchSellers(signal?: AbortSignal): Promise<Seller[]> {
  const res = await request<{ sellers: Seller[]; count: number }>('/sellers', {
    method: 'GET',
    signal,
  });
  return res.sellers;
}

// ==========================================
// 2. Orders & Operational Stages
// ==========================================

export async function fetchOrderStats(signal?: AbortSignal): Promise<OrderStats> {
  return request<OrderStats>('/orders/stats', { method: 'GET', signal });
}

export async function fetchOrders(
  params?: {
    status?: string;
    seller_id?: number;
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal
): Promise<OrderListResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== 'ALL') query.set('status', params.status);
  if (params?.seller_id) query.set('seller_id', params.seller_id.toString());
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());

  const qs = query.toString();
  return request<OrderListResponse>(`/orders${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    signal,
  });
}

export async function fetchOrder(orderId: number, signal?: AbortSignal): Promise<Order> {
  return request<Order>(`/orders/${orderId}`, { method: 'GET', signal });
}

export async function fetchOrderStages(orderId: number, signal?: AbortSignal): Promise<OrderStage[]> {
  const res = await request<{ order_id: number; stage_count: number; stages: OrderStage[] }>(
    `/orders/${orderId}/stages`,
    { method: 'GET', signal }
  );
  return res.stages;
}

export async function createOrder(payload: CreateOrderPayload, signal?: AbortSignal): Promise<Order> {
  return request<Order>('/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

// ==========================================
// 3. Factual Timeline & Reconstruction
// ==========================================

export async function fetchTimeline(orderId: number, signal?: AbortSignal): Promise<ReconstructedTimeline> {
  return request<ReconstructedTimeline>(`/orders/${orderId}/timeline`, {
    method: 'GET',
    signal,
  });
}

export async function reconstructTimeline(
  orderId: number,
  signal?: AbortSignal
): Promise<ReconstructedTimeline> {
  return request<ReconstructedTimeline>(`/orders/${orderId}/timeline/reconstruct`, {
    method: 'POST',
    body: JSON.stringify({ async: false }),
    signal,
  });
}

// ==========================================
// 4. Evidence Management
// ==========================================

export async function fetchEvidence(
  orderId: number,
  params?: { stage_id?: number; case_id?: number },
  signal?: AbortSignal
): Promise<EvidenceItem[]> {
  const query = new URLSearchParams();
  if (params?.stage_id) query.set('stage_id', params.stage_id.toString());
  if (params?.case_id) query.set('case_id', params.case_id.toString());
  const qs = query.toString();

  const res = await request<{ order_id: number; evidence_count: number; evidence: EvidenceItem[] }>(
    `/orders/${orderId}/evidence${qs ? `?${qs}` : ''}`,
    { method: 'GET', signal }
  );
  return res.evidence;
}

export async function fetchEvidenceDetail(evidenceId: number, signal?: AbortSignal): Promise<EvidenceItem> {
  return request<EvidenceItem>(`/evidence/${evidenceId}`, { method: 'GET', signal });
}

export async function uploadEvidenceFile(
  orderId: number,
  file: File,
  uploadedBy: number,
  caseId?: number,
  eventId?: number,
  signal?: AbortSignal
): Promise<EvidenceItem> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('uploaded_by', uploadedBy.toString());
  if (caseId) formData.append('case_id', caseId.toString());
  if (eventId) formData.append('event_id', eventId.toString());

  return request<EvidenceItem>(`/orders/${orderId}/evidence`, {
    method: 'POST',
    body: formData,
    signal,
  });
}

// ==========================================
// 5. Delay Analysis & Delay Graphs
// ==========================================

export async function fetchDelayAnalysis(orderId: number, signal?: AbortSignal): Promise<DelayAnalysisReport> {
  return request<DelayAnalysisReport>(`/orders/${orderId}/delay-analysis`, {
    method: 'GET',
    signal,
  });
}

export async function runDelayAnalysis(
  orderId: number,
  creatorUserId?: number,
  persistEdges = true,
  signal?: AbortSignal
): Promise<DelayAnalysisReport> {
  return request<DelayAnalysisReport>(`/orders/${orderId}/delay-analysis`, {
    method: 'POST',
    body: JSON.stringify({
      creator_user_id: creatorUserId,
      persist_edges: persistEdges,
    }),
    signal,
  });
}

export async function fetchCaseDelayReport(caseId: number, signal?: AbortSignal): Promise<DelayAnalysisReport> {
  return request<DelayAnalysisReport>(`/cases/${caseId}/delay-report`, {
    method: 'GET',
    signal,
  });
}

export async function fetchCaseDelayGraph(caseId: number, signal?: AbortSignal): Promise<DelayGraphEdge[]> {
  const res = await request<{ case_id: number; edge_count: number; edges: DelayGraphEdge[] }>(
    `/cases/${caseId}/delay-graph`,
    { method: 'GET', signal }
  );
  return res.edges;
}

// ==========================================
// 6. Intervention Discovery
// ==========================================

export async function fetchCandidateInterventions(
  caseId: number,
  signal?: AbortSignal
): Promise<CandidateIntervention[]> {
  const res = await request<{
    case_id: number;
    candidate_count: number;
    candidates: CandidateIntervention[];
  }>(`/cases/${caseId}/interventions`, { method: 'GET', signal });
  return res.candidates;
}

// ==========================================
// 7. Scenario Simulation
// ==========================================

export async function simulateScenario(
  caseId: number,
  payload: {
    scenario_name: string;
    intervention_ids: number[];
    assumptions?: string[];
  },
  signal?: AbortSignal
): Promise<DecisionScenario> {
  return request<DecisionScenario>(`/cases/${caseId}/scenarios`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function autoGenerateScenarios(
  caseId: number,
  signal?: AbortSignal
): Promise<DecisionScenario[]> {
  const res = await request<{
    case_id: number;
    scenario_count: number;
    scenarios: DecisionScenario[];
  }>(`/cases/${caseId}/scenarios/auto-generate`, {
    method: 'POST',
    signal,
  });
  return res.scenarios;
}

export async function fetchCaseScenarios(caseId: number, signal?: AbortSignal): Promise<DecisionScenario[]> {
  const res = await request<{
    case_id: number;
    scenario_count: number;
    scenarios: DecisionScenario[];
  }>(`/cases/${caseId}/scenarios`, { method: 'GET', signal });
  return res.scenarios;
}

export async function fetchScenarioDetail(scenarioId: number, signal?: AbortSignal): Promise<DecisionScenario> {
  return request<DecisionScenario>(`/scenarios/${scenarioId}`, { method: 'GET', signal });
}

// ==========================================
// 8. Decisions & Outcome Verification
// ==========================================

export async function recordDecision(
  caseId: number,
  payload: {
    scenario_id: number;
    decided_by: number;
    rationale: string;
  },
  signal?: AbortSignal
): Promise<OperationalDecision> {
  return request<OperationalDecision>(`/cases/${caseId}/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function fetchCaseDecisions(caseId: number, signal?: AbortSignal): Promise<OperationalDecision[]> {
  const res = await request<{
    case_id: number;
    decision_count: number;
    decisions: OperationalDecision[];
  }>(`/cases/${caseId}/decisions`, { method: 'GET', signal });
  return res.decisions;
}

export async function fetchDecisionDetail(decisionId: number, signal?: AbortSignal): Promise<OperationalDecision> {
  return request<OperationalDecision>(`/decisions/${decisionId}`, { method: 'GET', signal });
}

export async function approveDecision(
  decisionId: number,
  managerUserId: number,
  signal?: AbortSignal
): Promise<OperationalDecision> {
  return request<OperationalDecision>(`/decisions/${decisionId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ manager_user_id: managerUserId }),
    signal,
  });
}

export async function rejectDecision(
  decisionId: number,
  managerUserId: number,
  rejectionReason?: string,
  signal?: AbortSignal
): Promise<OperationalDecision> {
  return request<OperationalDecision>(`/decisions/${decisionId}/reject`, {
    method: 'POST',
    body: JSON.stringify({
      manager_user_id: managerUserId,
      rejection_reason: rejectionReason,
    }),
    signal,
  });
}

export async function verifyDecision(
  decisionId: number,
  payload: {
    actual_delivery_at?: string;
    outcome_notes?: string;
  },
  signal?: AbortSignal
): Promise<OutcomeVerification> {
  return request<OutcomeVerification>(`/decisions/${decisionId}/verify`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function fetchDecisionVerification(
  decisionId: number,
  signal?: AbortSignal
): Promise<OutcomeVerification | null> {
  const res = await request<
    OutcomeVerification | { verified: false; decision_id: number; decision_status?: string; verification: null }
  >(`/decisions/${decisionId}/verification`, {
    method: 'GET',
    signal,
  });
  if (res && 'verified' in res && res.verified === false) {
    return null;
  }
  return res as OutcomeVerification;
}

// ============================================================================
// Authentication & Roles
// ============================================================================

export async function loginUser(
  payload: LoginPayload,
  signal?: AbortSignal
): Promise<AuthUser> {
  return request<AuthUser>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function registerUser(
  payload: RegisterPayload,
  signal?: AbortSignal
): Promise<AuthUser> {
  return request<AuthUser>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function fetchRoles(signal?: AbortSignal): Promise<RoleOption[]> {
  const res = await request<{ roles: RoleOption[]; count: number }>('/auth/roles', {
    method: 'GET',
    signal,
  });
  return res.roles || [];
}
