import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { OperationalDecision, Order, DecisionScenario, DemoActor } from '../types/api';
import { formatCurrency, formatPercentage } from '../utils/formatters';
import {
  fetchOrders,
  fetchOrder,
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
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number; scenarioId?: number; decisionId?: number }) => void;
}

const STATUS_FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'];

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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [decisions, setDecisions] = useState<OperationalDecision[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Decision Detail Modal
  const [inspectingDecision, setInspectingDecision] = useState<OperationalDecision | null>(null);

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

  // Load decisions and order details when case or order changes
  const loadDecisionsAndOrder = async (caseId: number, orderId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const decisionsPromise = fetchCaseDecisions(caseId);
      const orderPromise = orderId ? fetchOrder(orderId) : Promise.resolve(null);

      const [decisionsData, orderData] = await Promise.all([decisionsPromise, orderPromise]);
      setDecisions(Array.isArray(decisionsData) ? decisionsData : []);
      if (orderData) {
        setSelectedOrder(orderData);
      } else if (orderId) {
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
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
  };

  useEffect(() => {
    if (selectedCaseId) {
      loadDecisionsAndOrder(selectedCaseId, selectedOrderId);
    } else {
      setDecisions([]);
      if (selectedOrderId) {
        const found = orders.find((o) => o.order_id === selectedOrderId);
        if (found) setSelectedOrder(found);
      }
    }
  }, [selectedCaseId, selectedOrderId]);

  // Auto-open record modal if initialScenarioId was provided
  useEffect(() => {
    if (initialScenarioId && selectedCaseId) {
      setChosenScenarioId(initialScenarioId);
      handleOpenRecordModal();
    }
  }, [initialScenarioId, selectedCaseId]);

  const handleOrderChange = (orderId: number) => {
    const ord = orders.find((o) => o.order_id === orderId);
    setSelectedOrderId(orderId);
    if (ord && ord.active_case_id) {
      setSelectedCaseId(ord.active_case_id);
    } else {
      setSelectedCaseId(null);
      setDecisions([]);
      if (ord) setSelectedOrder(ord);
    }
  };

  const handleOpenRecordModal = async () => {
    if (!selectedCaseId) return;
    setIsRecordModalOpen(true);
    setRecordError(null);
    try {
      const scList = await fetchCaseScenarios(selectedCaseId);
      const safeScenarios = Array.isArray(scList) ? scList : [];
      setScenarios(safeScenarios);
      if (!chosenScenarioId && safeScenarios.length > 0) {
        setChosenScenarioId(safeScenarios[0].scenario_id);
      }
    } catch {
      // Non-critical fallback
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
      await loadDecisionsAndOrder(selectedCaseId, selectedOrderId);
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
        await loadDecisionsAndOrder(selectedCaseId, selectedOrderId);
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
        await loadDecisionsAndOrder(selectedCaseId, selectedOrderId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setRejectLoading(false);
    }
  };

  // Filtered decisions based on status and search query
  const filteredDecisions = useMemo(() => {
    return (Array.isArray(decisions) ? decisions : []).filter((dec) => {
      const matchesStatus = statusFilter === 'ALL' || dec.decision_status === statusFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (dec.scenario_name && dec.scenario_name.toLowerCase().includes(q)) ||
        (dec.rationale && dec.rationale.toLowerCase().includes(q)) ||
        dec.decision_id.toString().includes(q) ||
        (dec.decided_by_name && dec.decided_by_name.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }, [decisions, statusFilter, searchQuery]);

  const hasActiveFilters = statusFilter !== 'ALL' || searchQuery !== '';
  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setSearchQuery('');
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

  // Metrics across decisions
  const approvedCount = useMemo(() => {
    return decisions.filter((d) => d.decision_status === 'APPROVED' || d.decision_status === 'EXECUTED').length;
  }, [decisions]);

  const pendingCount = useMemo(() => {
    return decisions.filter((d) => d.decision_status === 'PENDING').length;
  }, [decisions]);

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
              onClick={() => onNavigate('scenarios', { orderId: selectedOrderId || undefined, caseId: selectedCaseId || undefined })}
              title="Return to Scenario Simulator"
            >
              &larr; Back to Simulator
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
            Operational Decisions & Governance
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Auditable intervention selections requiring dual stakeholder authorization prior to dispatch execution.
          </p>
        </div>

        {/* Order Selector & Record Action */}
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
            onClick={() => selectedCaseId && loadDecisionsAndOrder(selectedCaseId, selectedOrderId)}
            disabled={loading || !selectedCaseId}
            title="Reload decision audit records"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={handleOpenRecordModal}
            disabled={!selectedCaseId}
            title="Record an operational decision for this incident"
          >
            + Record Decision
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedCaseId && (
              <Button size="sm" variant="outline" onClick={() => loadDecisionsAndOrder(selectedCaseId, selectedOrderId)}>
                Retry
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Selected Order Context Card */}
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
                  onClick={() => onNavigate('scenarios', { orderId: selectedOrder.order_id, caseId: selectedCaseId || undefined })}
                >
                  Simulator &rarr;
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
            Dual Governance Control Guardrail:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Decisions recorded by operations analysts commit candidate simulation hypotheses into binding operational directives. Approval by an Operations Manager is mandatory prior to physical execution and empirical outcome verification.
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
              Recorded Decisions
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              AUDIT TRAIL
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
            {decisions.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Total decisions for Case #{selectedCaseId || '—'}
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Approved Decisions
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
              READY FOR POD
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '6px' }}>
            {approvedCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Manager authorized directives
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Pending Authorization
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-yellow-bg)', color: 'var(--status-yellow)', fontWeight: 600 }}>
              IN REVIEW
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: pendingCount > 0 ? 'var(--status-yellow)' : 'var(--text-main)', marginTop: '6px' }}>
            {pendingCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Awaiting manager sign-off
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Active Signer
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
              ACTOR
            </span>
          </div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary)', marginTop: '10px' }}>
            {activeActor ? activeActor.name : 'None Selected'}
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {activeActor ? `Role: ${activeActor.role}` : 'Select demo persona above'}
          </div>
        </Card>
      </div>

      {/* Filter and Search Bar Card */}
      <Card padding="16px">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          {/* Status Filter Pills */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '2px',
              alignItems: 'center',
            }}
          >
            {STATUS_FILTERS.map((st) => {
              const isActive = statusFilter === st;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-full)',
                    border: isActive
                      ? '1px solid var(--primary)'
                      : '1px solid var(--border-color)',
                    backgroundColor: isActive
                      ? 'var(--primary)'
                      : 'var(--bg-surface)',
                    color: isActive
                      ? 'var(--text-inverse)'
                      : 'var(--text-muted)',
                    fontSize: '0.8rem',
                    fontWeight: isActive ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                  }}
                >
                  {st === 'ALL' ? 'All Statuses' : st}
                </button>
              );
            })}
          </div>

          {/* Search Input & Clear Filters */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flex: '1 1 300px',
              maxWidth: '440px',
              minWidth: '240px',
            }}
          >
            <div style={{ position: 'relative', width: '100%' }}>
              <input
                type="text"
                placeholder="Search scenario name, rationale, user..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 34px 8px 14px',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  &times;
                </button>
              )}
            </div>

            {hasActiveFilters && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClearFilters}
                style={{ whiteSpace: 'nowrap' }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {!selectedCaseId && !loading && (
        <Card>
          <EmptyState
            title="No Active Delay Case Selected"
            description="Select an order with an active delay case above to audit recorded decisions or commit new intervention directives."
            actionLabel="View Scenario Simulator"
            onAction={() => onNavigate('scenarios', { orderId: selectedOrderId || undefined })}
          />
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Auditing operational decisions and governance records..." />
      ) : decisions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              Recorded Decisions ({filteredDecisions.length}{decisions.length > filteredDecisions.length ? ` of ${decisions.length}` : ''} directives for Case #{selectedCaseId})
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Dual authorization required for operational dispatch
            </span>
          </div>

          {filteredDecisions.length === 0 ? (
            <Card>
              <EmptyState
                title="No decisions match filters"
                description="No decision records match your current status and search query."
                actionLabel="Clear Filters"
                onAction={handleClearFilters}
              />
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredDecisions.map((dec) => {
                const isPending = dec.decision_status === 'PENDING';
                const isApproved = dec.decision_status === 'APPROVED' || dec.decision_status === 'EXECUTED';
                const isRejected = dec.decision_status === 'REJECTED';

                return (
                  <Card
                    key={dec.decision_id}
                    title={`Decision #${dec.decision_id}: ${dec.scenario_name || `Scenario #${dec.scenario_id}`}`}
                    subtitle={`Selected on ${formatDateTime(dec.selected_at)} • Decided by ${dec.decided_by_name || `User #${dec.decided_by}`}`}
                    action={
                      <Badge
                        label={dec.decision_status}
                        variant={getStatusBadgeVariant(dec.decision_status)}
                        size="md"
                        dot
                      />
                    }
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {/* Metric & Projection Strip */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                          gap: '12px',
                          padding: '12px 14px',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Predicted Savings</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '2px' }}>
                            +{dec.predicted_time_saved_minutes ?? 0} min
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Estimated Cost</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
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
                              dot
                            />
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Model Confidence</div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '2px' }}>
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
                            backgroundColor: 'var(--bg-surface)',
                            padding: '10px 14px',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            lineHeight: 1.5,
                            margin: 0,
                          }}
                        >
                          {dec.rationale}
                        </p>
                      </div>

                      {/* Audit Trail & Authorizer Sign-Off */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          flexWrap: 'wrap',
                          gap: '8px',
                        }}
                      >
                        <div>
                          {dec.approved_at ? (
                            <span style={{ color: 'var(--status-green)', fontWeight: 600 }}>
                              ✓ Approved by {dec.approved_by_name || `Manager #${dec.approved_by}`} at {formatDateTime(dec.approved_at)}
                            </span>
                          ) : isRejected ? (
                            <span style={{ color: 'var(--status-red)', fontWeight: 600 }}>
                              ✕ Rejected by {dec.approved_by_name || `Manager #${dec.approved_by}`}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--status-yellow)', fontWeight: 600 }}>
                              ⏳ Pending Operations Manager review
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: '0.725rem', color: 'var(--text-light)' }}>
                          Scenario Document #{dec.scenario_id}
                        </div>
                      </div>

                      {/* Governance Action Controls */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px',
                          paddingTop: '12px',
                          borderTop: '1px solid var(--border-color)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setInspectingDecision(dec)}
                        >
                          Inspect Specifications
                        </Button>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                                Approve Decision (Manager)
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
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
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

      {/* Decision Detail Modal */}
      {inspectingDecision && (
        <Modal
          isOpen={!!inspectingDecision}
          onClose={() => setInspectingDecision(null)}
          title={`Operational Decision #${inspectingDecision.decision_id}: ${inspectingDecision.scenario_name || `Scenario #${inspectingDecision.scenario_id}`}`}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
              <Button variant="secondary" onClick={() => setInspectingDecision(null)}>
                Close
              </Button>
              {(inspectingDecision.decision_status === 'APPROVED' || inspectingDecision.decision_status === 'EXECUTED') && (
                <Button
                  variant="primary"
                  onClick={() => {
                    const dId = inspectingDecision.decision_id;
                    setInspectingDecision(null);
                    onNavigate('verification', {
                      caseId: selectedCaseId || undefined,
                      orderId: selectedOrderId || undefined,
                      decisionId: dId,
                    });
                  }}
                >
                  Verify Outcome &rarr;
                </Button>
              )}
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                padding: '12px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</span>
                <div style={{ marginTop: '2px' }}>
                  <Badge
                    label={inspectingDecision.decision_status}
                    variant={getStatusBadgeVariant(inspectingDecision.decision_status)}
                    size="sm"
                    dot
                  />
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Predicted Time Saved</span>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--status-green)' }}>
                  +{inspectingDecision.predicted_time_saved_minutes ?? 0} min
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Estimated Cost</span>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                  {formatCurrency(inspectingDecision.estimated_cost)}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Risk Profile</span>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--primary)' }}>
                  {inspectingDecision.risk_level || 'LOW'}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Audit Justification & Rationale
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5, marginTop: '4px', margin: 0 }}>
                {inspectingDecision.rationale}
              </p>
            </div>

            <div
              style={{
                padding: '12px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}
            >
              <div><strong>Recorded By:</strong> {inspectingDecision.decided_by_name || `User #${inspectingDecision.decided_by}`} on {formatDateTime(inspectingDecision.selected_at)}</div>
              {inspectingDecision.approved_at && (
                <div><strong>Approved By:</strong> {inspectingDecision.approved_by_name || `Manager #${inspectingDecision.approved_by}`} on {formatDateTime(inspectingDecision.approved_at)}</div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Record Decision Modal */}
      <Modal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        title="Record Operational Decision"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
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
          </div>
        }
      >
        <form onSubmit={handleRecordSubmit}>
          {recordError && <Alert type="error">{recordError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label
                htmlFor="select_scenario"
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
                id="select_scenario"
                value={chosenScenarioId || ''}
                onChange={(e) => setChosenScenarioId(Number(e.target.value))}
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
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
                  backgroundColor: 'var(--bg-surface-subtle)',
                  color: 'var(--text-muted)',
                  fontSize: '0.875rem',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="decision_rationale"
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
                id="decision_rationale"
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

      {/* Rejection Modal */}
      <Modal
        isOpen={!!rejectingDecisionId}
        onClose={() => setRejectingDecisionId(null)}
        title="Reject Operational Decision"
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
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
          </div>
        }
      >
        <form onSubmit={handleRejectSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
              Are you sure you want to reject Decision #{rejectingDecisionId}?
            </p>
            <div>
              <label
                htmlFor="rejection_reason"
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
                id="rejection_reason"
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Budget ceiling exceeded for this carrier option."
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
