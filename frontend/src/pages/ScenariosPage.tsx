import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { DecisionScenario, Order, CandidateIntervention } from '../types/api';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import {
  fetchOrders,
  fetchOrder,
  fetchCaseScenarios,
  autoGenerateScenarios,
  simulateScenario,
  fetchCandidateInterventions,
} from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface ScenariosPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number; scenarioId?: number }) => void;
}

export const ScenariosPage: React.FC<ScenariosPageProps> = ({
  initialCaseId,
  initialOrderId,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [scenarios, setScenarios] = useState<DecisionScenario[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Custom Scenario Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [availableInterventions, setAvailableInterventions] = useState<CandidateIntervention[]>([]);
  const [selectedInterventionIds, setSelectedInterventionIds] = useState<number[]>([]);
  const [scenarioName, setScenarioName] = useState<string>('');
  const [assumptionsText, setAssumptionsText] = useState<string>('');
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrdersWithCases() {
      try {
        const res = await fetchOrders({ limit: 50 });
        setOrders(res.orders || []);

        if (!selectedCaseId) {
          if (initialOrderId) {
            const found = res.orders.find((o) => o.order_id === initialOrderId);
            if (found && found.active_case_id) {
              setSelectedCaseId(found.active_case_id);
              setSelectedOrderId(found.order_id);
              return;
            }
          }
          const orderWithCase = res.orders.find((o) => o.active_case_id);
          if (orderWithCase && orderWithCase.active_case_id) {
            setSelectedCaseId(orderWithCase.active_case_id);
            setSelectedOrderId(orderWithCase.order_id);
          } else if (res.orders.length > 0) {
            setSelectedOrderId(res.orders[0].order_id);
          }
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : 'Failed to load orders';
        if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
          setError('Database connectivity restricted by firewall rules. Please verify Azure SQL networking.');
        } else {
          setError(rawMsg);
        }
      }
    }
    loadOrdersWithCases();
  }, [initialCaseId, initialOrderId]);

  // Load scenarios and order details
  const loadScenariosAndOrder = async (caseId: number, orderId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const scenariosPromise = fetchCaseScenarios(caseId);
      const orderPromise = orderId ? fetchOrder(orderId) : Promise.resolve(null);

      const [scenariosData, orderData] = await Promise.all([scenariosPromise, orderPromise]);
      setScenarios(scenariosData || []);
      if (orderData) {
        setSelectedOrder(orderData);
      } else if (orderId) {
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to load scenarios';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connectivity restricted by firewall rules. Ensure client IP is allowed in Azure SQL.');
      } else if (rawMsg.includes('Connection refused') || rawMsg.includes('Failed to fetch') || rawMsg.includes('503')) {
        setError('Backend service is temporarily unavailable. Please verify API server status.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadScenariosAndOrder(selectedCaseId, selectedOrderId);
    } else {
      setScenarios([]);
      if (selectedOrderId) {
        const found = orders.find((o) => o.order_id === selectedOrderId);
        if (found) setSelectedOrder(found);
      }
    }
  }, [selectedCaseId, selectedOrderId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord) {
      setSelectedOrder(ord);
      if (ord.active_case_id) {
        setSelectedCaseId(ord.active_case_id);
      } else {
        setSelectedCaseId(null);
        setScenarios([]);
      }
    } else {
      setSelectedCaseId(null);
      setScenarios([]);
    }
  };

  const handleAutoGenerate = async () => {
    if (!selectedCaseId) return;
    setGenerating(true);
    setError(null);
    try {
      const generated = await autoGenerateScenarios(selectedCaseId);
      const list = Array.isArray(generated) ? generated : (generated as any)?.scenarios || [];
      setScenarios(list);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to auto-generate scenarios';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connectivity restricted. Cannot run auto-generation without active SQL access.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenCustomModal = async () => {
    if (!selectedCaseId) return;
    setIsModalOpen(true);
    setCreateError(null);
    setScenarioName('');
    setSelectedInterventionIds([]);
    setAssumptionsText('');
    try {
      const items = await fetchCandidateInterventions(selectedCaseId);
      setAvailableInterventions(items || []);
    } catch {
      // Non-critical fallback
    }
  };

  const handleCreateCustomScenario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId) return;
    if (!scenarioName.trim()) {
      setCreateError('Scenario name is required.');
      return;
    }
    if (selectedInterventionIds.length === 0) {
      setCreateError('Please select at least one intervention.');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    const assumptions = assumptionsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      await simulateScenario(selectedCaseId, {
        scenario_name: scenarioName.trim(),
        intervention_ids: selectedInterventionIds,
        assumptions: assumptions.length > 0 ? assumptions : undefined,
      });
      setIsModalOpen(false);
      await loadScenariosAndOrder(selectedCaseId, selectedOrderId);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setCreateLoading(false);
    }
  };

  const toggleIntervention = (id: number) => {
    if (selectedInterventionIds.includes(id)) {
      setSelectedInterventionIds(selectedInterventionIds.filter((item) => item !== id));
    } else {
      setSelectedInterventionIds([...selectedInterventionIds, id]);
    }
  };

  const formatShortDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  // Comparative KPIs across scenarios
  const maxTimeRecovered = useMemo(() => {
    if (!Array.isArray(scenarios) || scenarios.length === 0) return 0;
    return Math.max(...scenarios.map((s) => s.predicted_time_saved_minutes || 0));
  }, [scenarios]);

  const maxConfidence = useMemo(() => {
    if (!Array.isArray(scenarios) || scenarios.length === 0) return 0;
    return Math.max(...scenarios.map((s) => Math.round((Number(s.confidence_score) || 0) * 100)));
  }, [scenarios]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate('orders', { orderId: selectedOrderId || undefined })}
              title="Return to Orders catalog"
            >
              &larr; Back to Orders
            </Button>
            {selectedOrder && (
              <Badge
                label={selectedOrder.status}
                variant={getStatusBadgeVariant(selectedOrder.status)}
                dot
                size="sm"
              />
            )}
            {selectedCaseId && (
              <span
                style={{
                  fontSize: '0.725rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  color: 'var(--primary)',
                  fontWeight: 600,
                  border: '1px solid var(--border-color)',
                }}
              >
                Case #{selectedCaseId}
              </span>
            )}
          </div>

          <h2
            style={{
              fontSize: '1.625rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Scenario Simulator
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Counterfactual simulations evaluating trade-offs between delivery recovery, cost, and operational risk.
          </p>
        </div>

        {/* Order Selector & Generator Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            aria-label="Select Target Order"
            value={selectedOrderId || ''}
            onChange={(e) => handleOrderChange(Number(e.target.value))}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              fontSize: '0.875rem',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-main)',
              fontWeight: 500,
              outline: 'none',
              minWidth: '240px',
            }}
          >
            {orders.length === 0 ? (
              <option value="">No orders found</option>
            ) : (
              orders.map((o) => (
                <option key={o.order_id} value={o.order_id}>
                  {o.external_order_ref} {o.active_case_id ? `(Case #${o.active_case_id})` : '(No Case)'}
                </option>
              ))
            )}
          </select>

          <Button
            variant="outline"
            onClick={handleAutoGenerate}
            loading={generating}
            disabled={!selectedCaseId}
            title="Auto-generate standard candidate scenario portfolio"
          >
            ⚡ Auto-Generate Options
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenCustomModal}
            disabled={!selectedCaseId}
            title="Design custom intervention scenario"
          >
            + Custom Scenario
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedCaseId && (
              <Button size="sm" variant="outline" onClick={() => loadScenariosAndOrder(selectedCaseId, selectedOrderId)}>
                Retry
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Selected Order & Incident Case Context Card */}
      {selectedOrder && (
        <Card padding="16px">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '16px',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Consignment</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '2px' }}>
                {selectedOrder.external_order_ref}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                Internal ID #{selectedOrder.order_id} {selectedOrder.active_case_id ? `• Case #${selectedOrder.active_case_id}` : ''}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Customer</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {selectedOrder.customer_name || `Customer #${selectedOrder.customer_user_id}`}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                User ID #{selectedOrder.customer_user_id}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Seller</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {selectedOrder.seller_business_name || `Seller #${selectedOrder.seller_id}`}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                Seller ID #{selectedOrder.seller_id}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Order Placed</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {formatShortDate(selectedOrder.placed_at)}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                {formatDateTime(selectedOrder.placed_at)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Expected Delivery</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {formatShortDate(selectedOrder.expected_delivery_at)}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                {selectedOrder.actual_delivery_at
                  ? `Delivered ${formatShortDate(selectedOrder.actual_delivery_at)}`
                  : 'Fulfillment in progress'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifySelf: 'start' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Related Modules</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('interventions', { caseId: selectedCaseId || undefined, orderId: selectedOrder.order_id })}
                >
                  Candidate Levers &rarr;
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('delay-analysis', { orderId: selectedOrder.order_id, caseId: selectedCaseId || undefined })}
                >
                  Delay Analysis &rarr;
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Epistemological Domain Distinction Banner */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          borderLeft: '4px solid var(--primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.825rem', color: 'var(--text-main)' }}>
            Counterfactual Projections Guardrail:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Predicted delay savings are model-based estimates derived from historical distribution parameters. Causara preserves all assumptions explicitly for auditability before any decision is approved.
          </span>
        </div>
      </div>

      {/* Overview Metrics Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
        }}
      >
        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Evaluated Scenarios
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              SIMULATED
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
            {scenarios.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Evaluated for Case #{selectedCaseId || '—'}
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Max Recovery Projected
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
              POTENTIAL
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '6px' }}>
            {maxTimeRecovered > 0 ? `+${maxTimeRecovered} min` : '0 min'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Maximum simulated time savings
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Peak Model Confidence
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
              ACCURACY
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--primary)', marginTop: '6px' }}>
            {maxConfidence > 0 ? `${maxConfidence}%` : '—'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Bayesian posterior prediction confidence
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Simulation Engine
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              COSMOS DB
            </span>
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '10px' }}>
            Active Simulation Core
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Documented scenario history
          </div>
        </Card>
      </div>

      {!selectedCaseId && !loading && (
        <Card>
          <EmptyState
            title="No Active Delay Case Selected"
            description="Select an order with an active delay case above to simulate intervention scenarios and evaluate trade-offs."
            actionLabel="Go to Delay Analysis"
            onAction={() => onNavigate('delay-analysis', { orderId: selectedOrderId || undefined })}
          />
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Simulating counterfactual scenarios and computing posterior distributions..." />
      ) : scenarios.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              Evaluated Options ({scenarios.length} Scenarios for Case #{selectedCaseId})
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Compare trade-offs and select preferred path for operational approval
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '20px',
            }}
          >
            {scenarios.map((sc) => {
              const confidencePct = Math.round((Number(sc.confidence_score) || 0) * 100);
              return (
                <Card
                  key={sc.scenario_id}
                  title={sc.scenario_name}
                  subtitle={`Scenario #${sc.scenario_id} • Created ${formatShortDate(sc.created_at)}`}
                  action={
                    <Badge
                      label={`${sc.risk_level} RISK`}
                      variant={
                        sc.risk_level === 'LOW'
                          ? 'success'
                          : sc.risk_level === 'MEDIUM'
                            ? 'warning'
                            : 'danger'
                      }
                      size="sm"
                      dot
                    />
                  }
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Key Metrics Grid */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '12px',
                        padding: '12px 14px',
                        backgroundColor: 'var(--bg-surface-subtle)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Time Recovered (Est.)
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '2px' }}>
                          +{sc.predicted_time_saved_minutes} min
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Estimated Cost
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                          {formatCurrency(sc.estimated_cost)}
                        </div>
                      </div>
                    </div>

                    {/* Confidence Gauge */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Confidence Score</span>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatPercentage(sc.confidence_score)}</span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '8px',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          borderRadius: 'var(--radius-full)',
                          overflow: 'hidden',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div
                          style={{
                            width: `${confidencePct}%`,
                            height: '100%',
                            backgroundColor: 'var(--primary)',
                            borderRadius: 'var(--radius-full)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </div>

                    {/* Interventions Applied */}
                    {sc.interventions && sc.interventions.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '6px' }}>
                          Included Interventions ({sc.interventions.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {sc.interventions.map((link) => (
                            <div
                              key={link.intervention_id}
                              style={{
                                fontSize: '0.775rem',
                                padding: '6px 10px',
                                backgroundColor: 'var(--bg-surface)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{link.name}</span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.725rem' }}>{link.intervention_type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Explicit Assumptions */}
                    {sc.assumptions && sc.assumptions.length > 0 && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                          Underlying Assumptions
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
                          {sc.assumptions.map((asm, i) => (
                            <li key={i}>{asm}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                      <Button
                        variant="primary"
                        style={{ width: '100%' }}
                        onClick={() =>
                          onNavigate('decisions', {
                            caseId: selectedCaseId || undefined,
                            orderId: selectedOrderId || undefined,
                            scenarioId: sc.scenario_id,
                          })
                        }
                      >
                        Record Decision with this Scenario &rarr;
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : selectedCaseId ? (
        <Card>
          <EmptyState
            title="No Scenarios Simulated Yet"
            description={`No counterfactual scenarios have been generated for Case #${selectedCaseId} yet.`}
            actionLabel="⚡ Auto-Generate Standard Scenarios"
            onAction={handleAutoGenerate}
          />
        </Card>
      ) : null}

      {/* Custom Scenario Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Simulate Custom Counterfactual Scenario"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
            <Button
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={createLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateCustomScenario}
              loading={createLoading}
            >
              Simulate Counterfactual
            </Button>
          </div>
        }
      >
        <form onSubmit={handleCreateCustomScenario}>
          {createError && <Alert type="error">{createError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label
                htmlFor="custom_scenario_name"
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                Scenario Name *
              </label>
              <input
                id="custom_scenario_name"
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="e.g. Expedited Air Freight + Same-Day Sorting"
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                Select Interventions *
              </label>

              {availableInterventions.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Loading candidate interventions...
                </p>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    padding: '8px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  {availableInterventions.map((item) => {
                    const isSelected = selectedInterventionIds.includes(item.intervention_id);
                    return (
                      <label
                        key={item.intervention_id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px 8px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: isSelected ? 'var(--primary-subtle)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleIntervention(item.intervention_id)}
                        />
                        <div style={{ fontSize: '0.8rem', flex: 1 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                            (+{item.expected_time_saved_minutes}m, {formatCurrency(item.estimated_cost)})
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="custom_scenario_assumptions"
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                Auditable Assumptions (One per line)
              </label>
              <textarea
                id="custom_scenario_assumptions"
                rows={3}
                value={assumptionsText}
                onChange={(e) => setAssumptionsText(e.target.value)}
                placeholder="e.g. Carrier express dispatch SLA remains under 4 hours."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
