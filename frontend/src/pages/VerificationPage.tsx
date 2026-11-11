import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { OperationalDecision, Order, OutcomeVerification } from '../types/api';
import {
  fetchOrders,
  fetchCaseDecisions,
  verifyDecision,
  fetchDecisionVerification,
} from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface VerificationPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  initialDecisionId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const VerificationPage: React.FC<VerificationPageProps> = ({
  initialCaseId,
  initialOrderId,
  initialDecisionId,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [decisions, setDecisions] = useState<OperationalDecision[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState<number | null>(initialDecisionId || null);
  const [verification, setVerification] = useState<OutcomeVerification | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Verification Form State
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState<boolean>(false);
  const [actualDeliveryAt, setActualDeliveryAt] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [outcomeNotes, setOutcomeNotes] = useState<string>('');
  const [verifyLoading, setVerifyLoading] = useState<boolean>(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

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

  // Load decisions for case
  useEffect(() => {
    async function loadDecisionsForCase() {
      if (!selectedCaseId) return;
      setLoading(true);
      setError(null);
      try {
        const list = await fetchCaseDecisions(selectedCaseId);
        setDecisions(list);
        if (list.length > 0) {
          if (!selectedDecisionId || !list.some((d) => d.decision_id === selectedDecisionId)) {
            // Pick first approved or first decision
            const approved = list.find((d) => d.decision_status === 'APPROVED');
            setSelectedDecisionId(approved ? approved.decision_id : list[0].decision_id);
          }
        } else {
          setSelectedDecisionId(null);
          setVerification(null);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load decisions');
      } finally {
        setLoading(false);
      }
    }
    loadDecisionsForCase();
  }, [selectedCaseId]);

  // Load verification for selected decision
  useEffect(() => {
    async function loadVerificationDetail() {
      if (!selectedDecisionId) {
        setVerification(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const v = await fetchDecisionVerification(selectedDecisionId);
        setVerification(v);
      } catch {
        // Not yet verified
        setVerification(null);
      } finally {
        setLoading(false);
      }
    }
    loadVerificationDetail();
  }, [selectedDecisionId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord && ord.active_case_id) {
      setSelectedCaseId(ord.active_case_id);
    } else {
      setSelectedCaseId(null);
      setDecisions([]);
      setSelectedDecisionId(null);
      setVerification(null);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDecisionId) return;

    setVerifyLoading(true);
    setVerifyError(null);

    try {
      const res = await verifyDecision(selectedDecisionId, {
        actual_delivery_at: new Date(actualDeliveryAt).toISOString(),
        outcome_notes: outcomeNotes.trim() || undefined,
      });
      setVerification(res);
      setIsVerifyModalOpen(false);
    } catch (err: unknown) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifyLoading(false);
    }
  };

  const currentDecision = decisions.find((d) => d.decision_id === selectedDecisionId);

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
            Empirical Outcome Verification
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Closed-loop validation auditing actual delivery times against counterfactual model predictions.
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

          {decisions.length > 0 && (
            <select
              value={selectedDecisionId || ''}
              onChange={(e) => setSelectedDecisionId(Number(e.target.value))}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontSize: '0.85rem',
                backgroundColor: '#ffffff',
                fontWeight: 500,
              }}
            >
              {decisions.map((d) => (
                <option key={d.decision_id} value={d.decision_id}>
                  Decision #{d.decision_id} ({d.decision_status})
                </option>
              ))}
            </select>
          )}

          <Button
            variant="primary"
            onClick={() => {
              setActualDeliveryAt(new Date().toISOString().slice(0, 16));
              setOutcomeNotes('');
              setIsVerifyModalOpen(true);
            }}
            disabled={!selectedDecisionId}
          >
            {verification ? 'Re-Verify Outcome' : 'Verify Outcome'}
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Integrity Mandate:</strong> Verification records actual observed outcomes to measure
        prediction accuracy against empirical reality. Causara never fabricates or synthesizes verification results.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {!selectedCaseId && !loading && (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Select an order with an active delay case and recorded decision to verify outcomes.
            </p>
          </div>
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Auditing outcome metrics and prediction errors..." />
      ) : verification ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Executive Verification Metric Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
            }}
          >
            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Verification Status
              </div>
              <div style={{ marginTop: '6px' }}>
                <Badge label="VERIFIED" variant="success" size="md" dot />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Audited {new Date(verification.measured_at).toLocaleString()}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Signed Prediction Error
              </div>
              <div
                style={{
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  marginTop: '4px',
                  color:
                    verification.signed_prediction_error_minutes > 0
                      ? 'var(--status-red)'
                      : verification.signed_prediction_error_minutes < 0
                      ? 'var(--status-green)'
                      : 'var(--primary)',
                }}
              >
                {verification.signed_prediction_error_minutes > 0 ? '+' : ''}
                {verification.signed_prediction_error_minutes} min
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {verification.signed_prediction_error_minutes > 0
                  ? 'Delivered later than model predicted'
                  : verification.signed_prediction_error_minutes < 0
                  ? 'Delivered earlier than model predicted'
                  : 'Perfect model alignment'}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Absolute Prediction Error
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                {verification.absolute_prediction_error_minutes} min
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Model deviation magnitude
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                SLA Delivery Variance
              </div>
              <div
                style={{
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  marginTop: '4px',
                  color: verification.delivery_variance_minutes > 0 ? 'var(--status-red)' : 'var(--status-green)',
                }}
              >
                {verification.delivery_variance_minutes > 0 ? '+' : ''}
                {verification.delivery_variance_minutes} min
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Actual vs original SLA commitment
              </div>
            </Card>
          </div>

          {/* Timeline Audit Comparison Table */}
          <Card
            title={`Outcome Audit: Decision #${verification.decision_id}`}
            subtitle="Comparing planned, predicted, and empirically observed timestamps"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                <div
                  style={{
                    padding: '14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    1. Original SLA Commitment
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
                    {new Date(verification.original_expected_delivery_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Customer contractual expectation
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #bae6fd',
                    backgroundColor: '#f0f9ff',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#0369a1', fontWeight: 600 }}>
                    2. Model Predicted Delivery
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0284c7', marginTop: '6px' }}>
                    {new Date(verification.predicted_delivery_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#0369a1', marginTop: '4px' }}>
                    Counterfactual scenario projection
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #bbf7d0',
                    backgroundColor: '#f0fdf4',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>
                    3. Empirically Observed Delivery
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#16a34a', marginTop: '6px' }}>
                    {new Date(verification.actual_delivery_at).toLocaleString()}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: '4px' }}>
                    Verified delivery POD event timestamp
                  </div>
                </div>
              </div>

              {/* Outcome Notes */}
              {verification.outcome_notes && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '4px' }}>
                    Auditor Notes & Observations
                  </div>
                  <p
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-main)',
                      backgroundColor: '#f8fafc',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid #e2e8f0',
                      lineHeight: 1.5,
                    }}
                  >
                    {verification.outcome_notes}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      ) : currentDecision ? (
        <Card
          title={`Decision #${currentDecision.decision_id}: ${currentDecision.scenario_name || `Scenario #${currentDecision.scenario_id}`}`}
          subtitle={`Status: ${currentDecision.decision_status}`}
        >
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
              This decision has not yet been audited against actual delivery events.
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setActualDeliveryAt(new Date().toISOString().slice(0, 16));
                setOutcomeNotes('');
                setIsVerifyModalOpen(true);
              }}
            >
              Verify Actual Outcome Now
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Verify Outcome Modal */}
      <Modal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        title="Record Observed Delivery & Verify Model Accuracy"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsVerifyModalOpen(false)}
              disabled={verifyLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleVerifySubmit}
              loading={verifyLoading}
            >
              Compute Prediction Errors
            </Button>
          </>
        }
      >
        <form onSubmit={handleVerifySubmit}>
          {verifyError && <Alert type="error">{verifyError}</Alert>}

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
                Actual Observed Delivery Timestamp (UTC) *
              </label>
              <input
                type="datetime-local"
                value={actualDeliveryAt}
                onChange={(e) => setActualDeliveryAt(e.target.value)}
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
                Verification Notes & Field Observations
              </label>
              <textarea
                rows={3}
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="e.g. Expedited air flight arrived on schedule; last-mile courier experienced minor 15-minute gate hold."
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
