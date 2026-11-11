import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { OperationalDecision, Order, DecisionScenario, DemoActor } from '../types/api';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import {
  fetchOrders,
  fetchCaseDecisions,
  fetchCaseScenarios,
  recordDecision,
  approveDecision,
  rejectDecision,
} from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface DecisionsPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  initialScenarioId?: number;
  actors: DemoActor[];
  activeActor: DemoActor | null;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number; decisionId?: number }) => void;
}

export const DecisionsPage: React.FC<DecisionsPageProps> = ({
  initialCaseId,
  initialOrderId,
  initialScenarioId,
  actors,
  activeActor,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [decisions, setDecisions] = useState<OperationalDecision[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Record Decision Modal State
  const [isRecordModalOpen, setIsRecordModalOpen] = useState<boolean>(false);
  const [scenarios, setScenarios] = useState<DecisionScenario[]>([]);
  const [chosenScenarioId, setChosenScenarioId] = useState<number | null>(initialScenarioId || null);
  const [rationale, setRationale] = useState<string>('');
  const [recordLoading, setRecordLoading] = useState<boolean>(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  // Rejection Modal State
  const [rejectingDecisionId, setRejectingDecisionId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [rejectLoading, setRejectLoading] = useState<boolean>(false);

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

  const loadDecisions = async (caseId: number) => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchCaseDecisions(caseId);
      setDecisions(items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadDecisions(selectedCaseId);
    }
  }, [selectedCaseId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord && ord.active_case_id) {
      setSelectedCaseId(ord.active_case_id);
    } else {
      setSelectedCaseId(null);
      setDecisions([]);
    }
  };

  const handleOpenRecordModal = async () => {
    if (!selectedCaseId) return;
    setIsRecordModalOpen(true);
    setRecordError(null);
    try {
      const scList = await fetchCaseScenarios(selectedCaseId);
      setScenarios(scList);
      if (!chosenScenarioId && scList.length > 0) {
        setChosenScenarioId(scList[0].scenario_id);
      }
    } catch {
      // Fallback
    }
  };

  const handleRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCaseId || !chosenScenarioId) {
      setRecordError('Please select a valid scenario.');
      return;
    }
    if (!activeActor) {
      setRecordError('Please select an active operational actor in the header first.');
      return;
    }
    if (!rationale.trim()) {
      setRecordError('Decision rationale is required for governance auditability.');
      return;
    }

    setRecordLoading(true);
    setRecordError(null);

    try {
      await recordDecision(selectedCaseId, {
        scenario_id: chosenScenarioId,
        decided_by: activeActor.id,
        rationale: rationale.trim(),
      });
      setIsRecordModalOpen(false);
      setRationale('');
      await loadDecisions(selectedCaseId);
    } catch (err: unknown) {
      setRecordError(err instanceof Error ? err.message : 'Failed to record decision');
    } finally {
      setRecordLoading(false);
    }
  };

  const getManagerActor = (): DemoActor | undefined => {
    if (activeActor && activeActor.role === 'MANAGER') {
      return activeActor;
    }
    return actors.find((a) => a.role === 'MANAGER');
  };

  const handleApprove = async (decisionId: number) => {
    const manager = getManagerActor();
    if (!manager) {
      setError('Approval requires an Operations Manager actor. No manager was discovered from the server.');
      return;
    }

    try {
      await approveDecision(decisionId, manager.id);
      if (selectedCaseId) {
        await loadDecisions(selectedCaseId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingDecisionId) return;

    const manager = getManagerActor();
    if (!manager) {
      setError('Rejection requires an Operations Manager actor. No manager was discovered from the server.');
      return;
    }

    setRejectLoading(true);
    try {
      await rejectDecision(rejectingDecisionId, manager.id, rejectionReason.trim());
      setRejectingDecisionId(null);
      setRejectionReason('');
      if (selectedCaseId) {
        await loadDecisions(selectedCaseId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setRejectLoading(false);
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
            Operational Decisions & Governance
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Auditable intervention selections requiring stakeholder approval prior to dispatch execution.
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
            variant="primary"
            onClick={handleOpenRecordModal}
            disabled={!selectedCaseId}
          >
            + Record Decision
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Dual Governance Control:</strong> Decisions recorded by operations analysts must be
        approved by an Operations Manager before operational dispatch. Every record logs decider,
        approver, timestamp, and qualitative rationale.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {!selectedCaseId && !loading && (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Select an order with an active delay case above to view and record operational decisions.
            </p>
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Loading decision audit records..." />
      ) : decisions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Recorded Decisions ({decisions.length} Decisions for Case #{selectedCaseId})
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {decisions.map((dec) => {
              const isPending = dec.decision_status === 'PENDING';
              const isApproved = dec.decision_status === 'APPROVED';

              return (
                <Card
                  key={dec.decision_id}
                  title={`Decision #${dec.decision_id}: ${dec.scenario_name || `Scenario #${dec.scenario_id}`}`}
                  subtitle={`Selected by User #${dec.decided_by} on ${new Date(dec.selected_at).toLocaleString()}`}
                  action={
                    <Badge
                      label={dec.decision_status}
                      variant={getStatusBadgeVariant(dec.decision_status)}
                      size="md"
                      dot
                    />
                  }
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Performance Projections */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '12px',
                        padding: '12px',
                        backgroundColor: '#f8fafc',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Predicted Savings</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-green)' }}>
                          +{dec.predicted_time_saved_minutes ?? 0} min
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Estimated Cost</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                          {formatCurrency(dec.estimated_cost)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Risk Rating</div>
                        <div style={{ marginTop: '4px' }}>
                          <Badge
                            label={dec.risk_level || 'LOW'}
                            variant={
                              dec.risk_level === 'HIGH'
                                ? 'danger'
                                : dec.risk_level === 'MEDIUM'
                                ? 'warning'
                                : 'success'
                            }
                            size="sm"
                          />
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Confidence</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {formatPercentage(dec.confidence_score)}
                        </div>
                      </div>
                    </div>

                    {/* Qualitative Rationale */}
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                        Documented Decision Rationale
                      </div>
                      <p
                        style={{
                          fontSize: '0.85rem',
                          color: 'var(--text-main)',
                          backgroundColor: '#ffffff',
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-color)',
                          lineHeight: 1.5,
                        }}
                      >
                        {dec.rationale}
                      </p>
                    </div>

                    {/* Approval Audit Trail */}
                    {dec.approved_at && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ✓ Approved by User #{dec.approved_by} at {new Date(dec.approved_at).toLocaleString()}
                      </div>
                    )}

                    {/* Governance Action Controls */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '10px',
                        paddingTop: '12px',
                        borderTop: '1px solid #e2e8f0',
                      }}
                    >
                      {isPending && (
                        <>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setRejectingDecisionId(dec.decision_id);
                              setRejectionReason('');
                            }}
                          >
                            Reject
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => handleApprove(dec.decision_id)}
                          >
                            Approve Decision (Operations Manager)
                          </Button>
                        </>
                      )}

                      {isApproved && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() =>
                            onNavigate('verification', {
                              caseId: selectedCaseId || undefined,
                              orderId: selectedOrderId || undefined,
                              decisionId: dec.decision_id,
                            })
                          }
                        >
                          Verify Actual Outcome &rarr;
                        </Button>
                      )}
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
              No operational decisions recorded for Case #{selectedCaseId} yet.
            </p>
            <Button variant="primary" onClick={handleOpenRecordModal}>
              + Record Initial Decision
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Record Decision Modal */}
      <Modal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        title="Record Operational Decision"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsRecordModalOpen(false)}
              disabled={recordLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleRecordSubmit}
              loading={recordLoading}
            >
              Commit Decision Record
            </Button>
          </>
        }
      >
        <form onSubmit={handleRecordSubmit}>
          {recordError && <Alert type="error">{recordError}</Alert>}

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
                Selected Scenario *
              </label>
              <select
                value={chosenScenarioId || ''}
                onChange={(e) => setChosenScenarioId(Number(e.target.value))}
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                  backgroundColor: '#ffffff',
                }}
              >
                {scenarios.map((sc) => (
                  <option key={sc.scenario_id} value={sc.scenario_id}>
                    {sc.scenario_name} (+{sc.predicted_time_saved_minutes}m, {formatCurrency(sc.estimated_cost)}, {sc.risk_level} risk)
                  </option>
                ))}
              </select>
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
                Decided By (Active Operational Actor)
              </label>
              <input
                type="text"
                value={activeActor ? `${activeActor.name} (${activeActor.role})` : 'No active actor selected'}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: '#f1f5f9',
                  color: 'var(--text-muted)',
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
                Decision Rationale & Governance Justification *
              </label>
              <textarea
                rows={4}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Explain why this scenario was selected over alternatives, considering cost vs SLA penalty trade-offs..."
                required
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

      {/* Rejection Modal */}
      <Modal
        isOpen={!!rejectingDecisionId}
        onClose={() => setRejectingDecisionId(null)}
        title="Reject Operational Decision"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRejectingDecisionId(null)}
              disabled={rejectLoading}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleRejectSubmit}
              loading={rejectLoading}
            >
              Confirm Rejection
            </Button>
          </>
        }
      >
        <form onSubmit={handleRejectSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Are you sure you want to reject Decision #{rejectingDecisionId}?
            </p>
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
                Rejection Reason (Audit Trail)
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Budget ceiling exceeded for this carrier option."
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
