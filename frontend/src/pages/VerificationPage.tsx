import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { OperationalDecision, Order, OutcomeVerification } from '../types/api';
import {
  fetchOrders,
  fetchOrder,
  fetchCaseDecisions,
  verifyDecision,
  fetchDecisionVerification,
} from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface VerificationPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  initialDecisionId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number; decisionId?: number }) => void;
}

export const VerificationPage: React.FC<VerificationPageProps> = ({
  initialCaseId,
  initialOrderId,
  initialDecisionId,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [decisions, setDecisions] = useState<OperationalDecision[]>([]);
  const [selectedDecisionId, setSelectedDecisionId] = useState<number | null>(initialDecisionId || null);
  const [verification, setVerification] = useState<OutcomeVerification | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Verification Form Modal State
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState<boolean>(false);
  const [actualDeliveryAt, setActualDeliveryAt] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [outcomeNotes, setOutcomeNotes] = useState<string>('');
  const [verifyLoading, setVerifyLoading] = useState<boolean>(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Load orders with cases
  useEffect(() => {
    async function loadOrdersWithCases() {
      try {
        const res = await fetchOrders({ limit: 50 });
        const orderList = res.orders || [];
        setOrders(orderList);

        if (!selectedCaseId) {
          if (initialOrderId) {
            const found = orderList.find((o) => o.order_id === initialOrderId);
            if (found && found.active_case_id) {
              setSelectedCaseId(found.active_case_id);
              setSelectedOrderId(found.order_id);
              return;
            }
          }
          const orderWithCase = orderList.find((o) => o.active_case_id);
          if (orderWithCase && orderWithCase.active_case_id) {
            setSelectedCaseId(orderWithCase.active_case_id);
            setSelectedOrderId(orderWithCase.order_id);
          } else if (orderList.length > 0) {
            setSelectedOrderId(orderList[0].order_id);
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

  // Load order details whenever selectedOrderId changes
  useEffect(() => {
    async function loadOrderDetails() {
      if (!selectedOrderId) {
        setSelectedOrder(null);
        return;
      }
      try {
        const ord = await fetchOrder(selectedOrderId);
        setSelectedOrder(ord);
      } catch {
        const found = orders.find((o) => o.order_id === selectedOrderId);
        if (found) setSelectedOrder(found);
      }
    }
    loadOrderDetails();
  }, [selectedOrderId, orders]);

  // Load decisions for case
  useEffect(() => {
    async function loadDecisionsForCase() {
      if (!selectedCaseId) {
        setDecisions([]);
        setSelectedDecisionId(null);
        setVerification(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const list = await fetchCaseDecisions(selectedCaseId);
        const safeList = Array.isArray(list) ? list : [];
        setDecisions(safeList);
        if (safeList.length > 0) {
          if (!selectedDecisionId || !safeList.some((d) => d.decision_id === selectedDecisionId)) {
            // Prefer first approved decision or first in list
            const approved = safeList.find((d) => d.decision_status === 'APPROVED' || d.decision_status === 'EXECUTED');
            setSelectedDecisionId(approved ? approved.decision_id : safeList[0].decision_id);
          }
        } else {
          setSelectedDecisionId(null);
          setVerification(null);
        }
      } catch (err: unknown) {
        const rawMsg = err instanceof Error ? err.message : 'Failed to load decisions';
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
    }
    loadDecisionsForCase();
  }, [selectedCaseId]);

  // Load verification for selected decision
  const loadVerificationDetail = async (decisionId: number) => {
    setLoading(true);
    setError(null);
    try {
      const v = await fetchDecisionVerification(decisionId);
      setVerification(v);
    } catch {
      // Not yet verified
      setVerification(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDecisionId) {
      loadVerificationDetail(selectedDecisionId);
    } else {
      setVerification(null);
    }
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
      if (ord) setSelectedOrder(ord);
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

  const currentDecision = useMemo(() => {
    return decisions.find((d) => d.decision_id === selectedDecisionId);
  }, [decisions, selectedDecisionId]);

  const canVerifyCurrentDecision =
    currentDecision?.decision_status === 'APPROVED' ||
    currentDecision?.decision_status === 'EXECUTED';

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
              onClick={() => onNavigate('decisions', { orderId: selectedOrderId || undefined, caseId: selectedCaseId || undefined })}
              title="Return to Decisions module"
            >
              &larr; Back to Decisions
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
            Empirical Outcome Verification
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Closed-loop validation auditing actual delivery times against counterfactual model predictions.
          </p>
        </div>

        {/* Order Selector, Decision Selector & Action Buttons */}
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
              minWidth: '220px',
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

          {decisions.length > 0 && (
            <select
              aria-label="Select Decision"
              value={selectedDecisionId || ''}
              onChange={(e) => setSelectedDecisionId(Number(e.target.value))}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontSize: '0.875rem',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-main)',
                fontWeight: 500,
                outline: 'none',
                minWidth: '220px',
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
            variant="outline"
            onClick={() => selectedDecisionId && loadVerificationDetail(selectedDecisionId)}
            disabled={loading || !selectedDecisionId}
            title="Reload verification audit"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={() => {
              setActualDeliveryAt(new Date().toISOString().slice(0, 16));
              setOutcomeNotes('');
              setIsVerifyModalOpen(true);
            }}
            disabled={!selectedDecisionId || !canVerifyCurrentDecision}
            title={
              canVerifyCurrentDecision
                ? 'Record observed delivery and verify model prediction'
                : 'Decision must be APPROVED or EXECUTED before outcome verification'
            }
          >
            {verification ? 'Re-Verify Outcome' : 'Verify Outcome'}
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedDecisionId && (
              <Button size="sm" variant="outline" onClick={() => loadVerificationDetail(selectedDecisionId)}>
                Retry
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Selected Order & Incident Context Card */}
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SLA Commitment</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {formatShortDate(selectedOrder.expected_delivery_at)}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                {formatDateTime(selectedOrder.expected_delivery_at)}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifySelf: 'start' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Related Modules</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('evidence', { orderId: selectedOrder.order_id, caseId: selectedCaseId || undefined })}
                >
                  Evidence &rarr;
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('timeline', { orderId: selectedOrder.order_id })}
                >
                  Timeline &rarr;
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Epistemological Domain Mandate Banner */}
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
            Empirical Ground Truth Mandate:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Outcome verification records actual observed POD timestamps to compute mathematical model error. Simulated outcomes are never conflated with observed reality, and prediction variances remain permanently preserved for continuous causal model recalibration.
          </span>
        </div>
      </div>

      {!selectedCaseId && !loading && (
        <Card>
          <EmptyState
            title="No Active Delay Case Selected"
            description="Select an order with an active delay case and recorded decision above to perform empirical outcome auditing."
            actionLabel="View Operational Decisions"
            onAction={() => onNavigate('decisions', { orderId: selectedOrderId || undefined })}
          />
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Auditing outcome metrics and reconciling prediction error distributions..." />
      ) : verification ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Executive Verification Metric Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '16px',
            }}
          >
            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Verification Status
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
                  AUDITED
                </span>
              </div>
              <div style={{ marginTop: '8px' }}>
                <Badge label="EMPIRICALLY VERIFIED" variant="success" size="md" dot />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Reconciled on {formatDateTime(verification.measured_at)}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Signed Prediction Error
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  VARIANCE
                </span>
              </div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  marginTop: '6px',
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
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {verification.signed_prediction_error_minutes > 0
                  ? 'Delivered later than model predicted'
                  : verification.signed_prediction_error_minutes < 0
                  ? 'Delivered earlier than model predicted'
                  : 'Perfect model alignment'}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Absolute Prediction Error
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  RESIDUAL
                </span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
                {verification.absolute_prediction_error_minutes} min
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Model deviation magnitude
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  SLA Delivery Variance
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-yellow-bg)', color: 'var(--status-yellow)', fontWeight: 600 }}>
                  FINAL SLA
                </span>
              </div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  marginTop: '6px',
                  color: verification.delivery_variance_minutes > 0 ? 'var(--status-red)' : 'var(--status-green)',
                }}
              >
                {verification.delivery_variance_minutes > 0 ? '+' : ''}
                {verification.delivery_variance_minutes} min
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Actual vs original contractual SLA
              </div>
            </Card>
          </div>

          {/* Timeline Audit Comparison Table / Cards */}
          <Card
            title={`Outcome Audit: Decision #${verification.decision_id}`}
            subtitle="Side-by-side reconciliation of planned, predicted, and empirically observed timestamps"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {/* 1. Contractual SLA */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    1. Contractual SLA Commitment
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
                    {formatDateTime(verification.original_expected_delivery_at)}
                  </div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Customer promised delivery deadline
                  </div>
                </div>

                {/* 2. Model Predicted Delivery */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--status-blue)',
                    backgroundColor: 'var(--status-blue-bg)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--status-blue)', fontWeight: 600 }}>
                    2. Model Predicted Delivery
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--status-blue)', marginTop: '8px' }}>
                    {formatDateTime(verification.predicted_delivery_at)}
                  </div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--status-blue)', marginTop: '4px' }}>
                    Counterfactual scenario forecast
                  </div>
                </div>

                {/* 3. Empirically Observed Delivery */}
                <div
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--status-green)',
                    backgroundColor: 'var(--status-green-bg)',
                  }}
                >
                  <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', fontWeight: 600 }}>
                    3. Empirically Observed Delivery
                  </div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '8px' }}>
                    {formatDateTime(verification.actual_delivery_at)}
                  </div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--status-green)', marginTop: '4px' }}>
                    Verified delivery POD event timestamp
                  </div>
                </div>
              </div>

              {/* Baseline comparison if present */}
              {verification.baseline_estimated_delivery_at && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <strong>Unmitigated Baseline Projection:</strong>{' '}
                  {formatDateTime(verification.baseline_estimated_delivery_at)} (delay without operational intervention)
                </div>
              )}

              {/* Auditor Notes */}
              {verification.outcome_notes && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '6px' }}>
                    Auditor Notes & Field Observations
                  </div>
                  <p
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-main)',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {verification.outcome_notes}
                  </p>
                </div>
              )}

              {/* Supporting Evidence Link */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border-color)',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Empirical Proof: Check carrier POD slips and GPS logs in Evidence Management
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('evidence', { orderId: selectedOrderId || undefined, caseId: selectedCaseId || undefined })}
                >
                  Inspect Supporting Evidence &rarr;
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : currentDecision ? (
        <Card
          title={`Decision #${currentDecision.decision_id}: ${currentDecision.scenario_name || `Scenario #${currentDecision.scenario_id}`}`}
          subtitle={`Status: ${currentDecision.decision_status} • Selected on ${formatDateTime(currentDecision.selected_at)}`}
        >
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px', maxWidth: '480px', margin: '0 auto 16px auto', lineHeight: 1.5 }}>
              {canVerifyCurrentDecision
                ? 'This operational decision has not yet been audited against actual delivery events. Once physical proof of delivery is received, reconcile timestamps to measure model error.'
                : `Decision is currently '${currentDecision.decision_status}'. Operations Manager approval (APPROVED / EXECUTED) is required prior to empirical outcome verification.`}
            </p>
            <Button
              variant="primary"
              disabled={!canVerifyCurrentDecision}
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
      ) : selectedCaseId ? (
        <Card>
          <EmptyState
            title="No Recorded Decisions"
            description={`No operational decisions have been committed for Case #${selectedCaseId} yet. A decision must be recorded before verifying its outcome.`}
            actionLabel="Go to Decisions"
            onAction={() => onNavigate('decisions', { orderId: selectedOrderId || undefined, caseId: selectedCaseId || undefined })}
          />
        </Card>
      ) : null}

      {/* Verify Outcome Modal */}
      <Modal
        isOpen={isVerifyModalOpen}
        onClose={() => setIsVerifyModalOpen(false)}
        title="Record Observed Delivery & Verify Model Accuracy"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
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
          </div>
        }
      >
        <form onSubmit={handleVerifySubmit}>
          {verifyError && <Alert type="error">{verifyError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label
                htmlFor="actual_delivery_timestamp"
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
                id="actual_delivery_timestamp"
                type="datetime-local"
                value={actualDeliveryAt}
                onChange={(e) => setActualDeliveryAt(e.target.value)}
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
                htmlFor="verification_outcome_notes"
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
                id="verification_outcome_notes"
                rows={3}
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="e.g. Expedited air flight arrived on schedule; last-mile courier experienced minor 15-minute gate hold."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
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
