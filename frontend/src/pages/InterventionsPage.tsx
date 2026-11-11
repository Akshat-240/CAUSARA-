import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { CandidateIntervention, Order } from '../types/api';
import { formatCurrency } from '../utils/formatters';
import { fetchOrders, fetchCandidateInterventions } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface InterventionsPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const InterventionsPage: React.FC<InterventionsPageProps> = ({
  initialCaseId,
  initialOrderId,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [candidates, setCandidates] = useState<CandidateIntervention[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrdersWithCases() {
      try {
        const res = await fetchOrders({ limit: 50 });
        setOrders(res.orders);

        // Find initial case if not set
        if (!selectedCaseId) {
          if (initialOrderId) {
            const found = res.orders.find((o) => o.order_id === initialOrderId);
            if (found && found.active_case_id) {
              setSelectedCaseId(found.active_case_id);
              setSelectedOrderId(found.order_id);
              return;
            }
          }
          // Default to first order with an active case
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

  const loadCandidates = async (caseId: number) => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchCandidateInterventions(caseId);
      setCandidates(items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve candidate interventions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadCandidates(selectedCaseId);
    }
  }, [selectedCaseId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord && ord.active_case_id) {
      setSelectedCaseId(ord.active_case_id);
    } else {
      setSelectedCaseId(null);
      setCandidates([]);
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
            Candidate Interventions
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Actionable mitigation levers tailored to active delay bottlenecks and downstream stages.
          </p>
        </div>

        {/* Case / Order Selector */}
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
            variant="primary"
            onClick={() => onNavigate('scenarios', { caseId: selectedCaseId || undefined, orderId: selectedOrderId || undefined })}
            disabled={!selectedCaseId}
          >
            Simulate Scenarios &rarr;
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Actionable Catalog:</strong> Interventions match delay patterns discovered in earlier stages.
        Each candidate intervention specifies expected time savings, implementation cost, and operational risk.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {!selectedCaseId && !loading && (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
              The selected order does not have an active delay case.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate('delay-analysis', { orderId: selectedOrderId || undefined })}
            >
              Run Delay Analysis to Create Case
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Searching candidate interventions matching delay points..." />
      ) : candidates.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Identified Levers ({candidates.length} options for Case #{selectedCaseId})
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Select an intervention to test counterfactual scenarios
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '16px',
            }}
          >
            {candidates.map((item) => (
              <Card
                key={item.intervention_id}
                title={item.name}
                subtitle={`${item.intervention_code} • ${item.applicable_stage_code}`}
                action={
                  <Badge
                    label={item.risk_level}
                    variant={
                      item.risk_level === 'LOW'
                        ? 'success'
                        : item.risk_level === 'MEDIUM'
                        ? 'warning'
                        : 'danger'
                    }
                    size="sm"
                  />
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Category and Rationale */}
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Operational Domain
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)', marginTop: '2px' }}>
                      {item.intervention_type}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Rationale
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.4 }}>
                      {item.rationale}
                    </p>
                  </div>

                  {item.preconditions && (
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Preconditions
                      </div>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {item.preconditions}
                      </p>
                    </div>
                  )}

                  {/* Impact & Cost Strip */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      backgroundColor: '#f8fafc',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid #e2e8f0',
                      marginTop: '4px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Delay Recovery</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--status-green)' }}>
                        +{item.expected_time_saved_minutes} min
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Estimated Cost</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {formatCurrency(item.estimated_cost)}
                      </div>
                    </div>
                  </div>

                  <div style={{ paddingTop: '8px', borderTop: '1px solid #e2e8f0' }}>
                    <Button
                      variant="outline"
                      size="sm"
                      style={{ width: '100%' }}
                      onClick={() =>
                        onNavigate('scenarios', {
                          caseId: selectedCaseId || undefined,
                          orderId: selectedOrderId || undefined,
                        })
                      }
                    >
                      Simulate in Counterfactual Engine &rarr;
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
