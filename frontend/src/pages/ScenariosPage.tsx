import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { DecisionScenario, Order, CandidateIntervention } from '../types/api';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import {
  fetchOrders,
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
        setOrders(res.orders);

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
          }
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      }
    }
    loadOrdersWithCases();
  }, [initialCaseId, initialOrderId]);

  const loadScenarios = async (caseId: number) => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchCaseScenarios(caseId);
      setScenarios(items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadScenarios(selectedCaseId);
    }
  }, [selectedCaseId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord && ord.active_case_id) {
      setSelectedCaseId(ord.active_case_id);
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
      setScenarios(generated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to auto-generate scenarios');
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
      setAvailableInterventions(items);
    } catch {
      // Fallback
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
      await loadScenarios(selectedCaseId);
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>
            Scenario Simulator
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Counterfactual simulations evaluating trade-offs between delivery recovery, cost, and risk.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select
            value={selectedOrderId || ''}
            onChange={(e) => handleOrderChange(Number(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              backgroundColor: '#ffffff',
              fontWeight: 500,
            }}
          >
            {orders.map((o) => (
              <option key={o.order_id} value={o.order_id}>
                {o.external_order_ref} {o.active_case_id ? `(Case #${o.active_case_id})` : '(No Case)'}
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            onClick={handleAutoGenerate}
            loading={generating}
            disabled={!selectedCaseId}
          >
            ⚡ Auto-Generate Options
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenCustomModal}
            disabled={!selectedCaseId}
          >
            + Custom Scenario
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Counterfactual Projections:</strong> Predicted delay savings are model-based estimates
        derived from historical distribution parameters. Causara preserves all assumptions explicitly
        for auditability before any decision is approved.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {!selectedCaseId && !loading && (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Select an order with an active delay case above to simulate intervention scenarios.
            </p>
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Simulating counterfactual scenarios..." />
      ) : scenarios.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
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
                  subtitle={`Scenario #${sc.scenario_id} • Created ${new Date(sc.created_at).toLocaleDateString()}`}
                  action={
                    <Badge
                      label={sc.risk_level}
                      variant={
                        sc.risk_level === 'LOW'
                          ? 'success'
                          : sc.risk_level === 'MEDIUM'
                          ? 'warning'
                          : 'danger'
                      }
                      size="sm"
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
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Time Recovered
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-green)' }}>
                          +{sc.predicted_time_saved_minutes} min
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Estimated Cost
                        </div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {formatCurrency(sc.estimated_cost)}
                        </div>
                      </div>
                    </div>

                    {/* Confidence Gauge */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Confidence Score</span>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatPercentage(sc.confidence_score)}</span>
                      </div>
                      <div
                        style={{
                          width: '100%',
                          height: '6px',
                          backgroundColor: '#e2e8f0',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${confidencePct}%`,
                            height: '100%',
                            backgroundColor: 'var(--primary)',
                            borderRadius: '3px',
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {sc.interventions.map((link) => (
                            <div
                              key={link.intervention_id}
                              style={{
                                fontSize: '0.75rem',
                                padding: '4px 8px',
                                backgroundColor: '#ffffff',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                display: 'flex',
                                justifyContent: 'space-between',
                              }}
                            >
                              <span>{link.name}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{link.intervention_type}</span>
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
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {sc.assumptions.map((asm, i) => (
                            <li key={i}>{asm}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
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
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              No scenarios simulated yet for Case #{selectedCaseId}.
            </p>
            <Button variant="primary" onClick={handleAutoGenerate} loading={generating}>
              ⚡ Auto-Generate Standard Scenarios
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Custom Scenario Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Simulate Custom Counterfactual Scenario"
        footer={
          <>
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
          </>
        }
      >
        <form onSubmit={handleCreateCustomScenario}>
          {createError && <Alert type="error">{createError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                Scenario Name *
              </label>
              <input
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
                  fontSize: '0.85rem',
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
                          borderRadius: '4px',
                          backgroundColor: isSelected ? 'var(--primary-light)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleIntervention(item.intervention_id)}
                        />
                        <div style={{ fontSize: '0.8rem', flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>{item.name}</span>
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
                }}
              />
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
