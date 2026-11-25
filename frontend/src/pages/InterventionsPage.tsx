import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { CandidateIntervention, Order } from '../types/api';
import { formatCurrency } from '../utils/formatters';
import { fetchOrders, fetchOrder, fetchCandidateInterventions } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface InterventionsPageProps {
  initialCaseId?: number;
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number; scenarioId?: number }) => void;
}

const RISK_FILTERS = ['ALL', 'LOW', 'MEDIUM', 'HIGH'];

export const InterventionsPage: React.FC<InterventionsPageProps> = ({
  initialCaseId,
  initialOrderId,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(initialCaseId || null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [candidates, setCandidates] = useState<CandidateIntervention[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Detail Modal State
  const [selectedIntervention, setSelectedIntervention] = useState<CandidateIntervention | null>(null);

  // Load orders with cases
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
          // Default to first order with an active case
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

  // Load candidates and order details when case or order changes
  const loadCandidatesAndOrder = async (caseId: number, orderId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const candidatesPromise = fetchCandidateInterventions(caseId);
      const orderPromise = orderId ? fetchOrder(orderId) : Promise.resolve(null);

      const [candidatesData, orderData] = await Promise.all([candidatesPromise, orderPromise]);
      setCandidates(candidatesData || []);
      if (orderData) {
        setSelectedOrder(orderData);
      } else if (orderId) {
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to retrieve candidate interventions';
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
      loadCandidatesAndOrder(selectedCaseId, selectedOrderId);
    } else {
      setCandidates([]);
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
        setCandidates([]);
      }
    } else {
      setSelectedCaseId(null);
      setCandidates([]);
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

  // Filtered interventions
  const filteredCandidates = useMemo(() => {
    return candidates.filter((item) => {
      const matchesRisk = riskFilter === 'ALL' || item.risk_level === riskFilter;
      if (!matchesRisk) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.name.toLowerCase().includes(q) ||
        item.intervention_code.toLowerCase().includes(q) ||
        item.applicable_stage_code.toLowerCase().includes(q) ||
        item.intervention_type.toLowerCase().includes(q) ||
        item.rationale.toLowerCase().includes(q)
      );
    });
  }, [candidates, riskFilter, searchQuery]);

  const hasActiveFilters = riskFilter !== 'ALL' || searchQuery.trim().length > 0;

  const handleClearFilters = () => {
    setRiskFilter('ALL');
    setSearchQuery('');
  };

  // Metrics derived from candidates
  const maxTimeRecoverable = useMemo(() => {
    if (candidates.length === 0) return 0;
    return Math.max(...candidates.map((c) => c.expected_time_saved_minutes || 0));
  }, [candidates]);

  const applicableStages = useMemo(() => {
    const set = new Set(candidates.map((c) => c.applicable_stage_code));
    return Array.from(set);
  }, [candidates]);

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
            Candidate Interventions
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Actionable mitigation levers tailored to active delay bottlenecks and downstream operational stages.
          </p>
        </div>

        {/* Order Selector & Simulation Action */}
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
            onClick={() => selectedCaseId && loadCandidatesAndOrder(selectedCaseId, selectedOrderId)}
            disabled={loading || !selectedCaseId}
            title="Reload candidate levers"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={() =>
              onNavigate('scenarios', {
                caseId: selectedCaseId || undefined,
                orderId: selectedOrderId || undefined,
              })
            }
            disabled={!selectedCaseId}
            title="Simulate counterfactual scenarios"
          >
            Simulate Scenarios &rarr;
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedCaseId && (
              <Button size="sm" variant="outline" onClick={() => loadCandidatesAndOrder(selectedCaseId, selectedOrderId)}>
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
                  onClick={() => onNavigate('timeline', { orderId: selectedOrder.order_id })}
                >
                  Timeline &rarr;
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
            Actionable Catalog Guardrail:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Candidate interventions represent structured recovery hypotheses matching discovered delay patterns. Expected time savings and costs are parameter estimates, strictly separated from actual verified outcomes.
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
              Available Levers
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              CATALOG
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
            {candidates.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Candidate levers for Case #{selectedCaseId || '—'}
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Max Delay Recovery
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
              POTENTIAL
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '6px' }}>
            {maxTimeRecoverable > 0 ? `+${maxTimeRecoverable} min` : '0 min'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Maximum single-lever time savings
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Applicable Stages
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
              TARGETS
            </span>
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', marginTop: '10px' }}>
            {applicableStages.length > 0 ? applicableStages.join(', ') : 'None'}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {applicableStages.length} bottleneck operational stages
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Simulation Engine
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              READY
            </span>
          </div>
          <div style={{ marginTop: '10px' }}>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                onNavigate('scenarios', {
                  caseId: selectedCaseId || undefined,
                  orderId: selectedOrderId || undefined,
                })
              }
              disabled={!selectedCaseId}
            >
              Test Scenarios &rarr;
            </Button>
          </div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Combine levers in counterfactual runs
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
          {/* Risk Level Filter Pills */}
          <div
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '2px',
              alignItems: 'center',
            }}
          >
            {RISK_FILTERS.map((r) => {
              const isActive = riskFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRiskFilter(r)}
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
                  {r === 'ALL' ? 'All Risks' : `${r} Risk`}
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
                placeholder="Search intervention name, stage, domain..."
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
            title="No Active Delay Case"
            description="The selected order does not have an active delay case. Run delay analysis to detect bottlenecks and generate candidate recovery levers."
            actionLabel="Run Delay Analysis to Create Case"
            onAction={() => onNavigate('delay-analysis', { orderId: selectedOrderId || undefined })}
          />
        </Card>
      )}

      {loading ? (
        <LoadingSpinner message="Searching candidate interventions matching delay bottlenecks..." />
      ) : candidates.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              Identified Levers ({filteredCandidates.length}{candidates.length > filteredCandidates.length ? ` of ${candidates.length}` : ''} options for Case #{selectedCaseId})
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Select a lever to inspect details or test in counterfactual simulator
            </span>
          </div>

          {filteredCandidates.length === 0 ? (
            <Card>
              <EmptyState
                title="No levers match filters"
                description="No candidate interventions match your current risk and search filters."
                actionLabel="Clear Filters"
                onAction={handleClearFilters}
              />
            </Card>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {filteredCandidates.map((item) => (
                <Card
                  key={item.intervention_id}
                  title={item.name}
                  subtitle={`${item.intervention_code} • Stage: ${item.applicable_stage_code}`}
                  action={
                    <Badge
                      label={`${item.risk_level} RISK`}
                      variant={
                        item.risk_level === 'LOW'
                          ? 'success'
                          : item.risk_level === 'MEDIUM'
                          ? 'warning'
                          : 'danger'
                      }
                      size="sm"
                      dot
                    />
                  }
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Category and Rationale */}
                    <div>
                      <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Operational Domain
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)', marginTop: '2px' }}>
                        {item.intervention_type}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                        Mitigation Rationale
                      </div>
                      <p style={{ fontSize: '0.825rem', color: 'var(--text-main)', marginTop: '2px', lineHeight: 1.45, margin: 0 }}>
                        {item.rationale}
                      </p>
                    </div>

                    {item.preconditions && (
                      <div
                        style={{
                          padding: '8px 10px',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <strong>Preconditions:</strong> {item.preconditions}
                      </div>
                    )}

                    {/* Impact & Cost Strip */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 14px',
                        backgroundColor: 'var(--bg-surface-subtle)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        marginTop: '4px',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Delay Recovery (Est.)</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '2px' }}>
                          +{item.expected_time_saved_minutes} min
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Estimated Cost</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                          {formatCurrency(item.estimated_cost)}
                        </div>
                      </div>
                    </div>

                    {/* Card Actions */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '8px',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--border-color)',
                      }}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedIntervention(item)}
                      >
                        Inspect Details
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() =>
                          onNavigate('scenarios', {
                            caseId: selectedCaseId || undefined,
                            orderId: selectedOrderId || undefined,
                          })
                        }
                      >
                        Simulate &rarr;
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : selectedCaseId && !loading ? (
        <Card>
          <EmptyState
            title="No Candidate Interventions Found"
            description={`No candidate interventions have been indexed for Case #${selectedCaseId}.`}
            actionLabel="View Delay Analysis"
            onAction={() => onNavigate('delay-analysis', { orderId: selectedOrderId || undefined, caseId: selectedCaseId || undefined })}
          />
        </Card>
      ) : null}

      {/* Intervention Detail Modal */}
      {selectedIntervention && (
        <Modal
          isOpen={!!selectedIntervention}
          onClose={() => setSelectedIntervention(null)}
          title={`Intervention Lever: ${selectedIntervention.name}`}
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
              <Button variant="secondary" onClick={() => setSelectedIntervention(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setSelectedIntervention(null);
                  onNavigate('scenarios', {
                    caseId: selectedCaseId || undefined,
                    orderId: selectedOrderId || undefined,
                  });
                }}
              >
                Launch Simulator with this Lever &rarr;
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Intervention Code</span>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--primary)' }}>
                  {selectedIntervention.intervention_code}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Stage</span>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                  {selectedIntervention.applicable_stage_code}
                </div>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Risk Profile</span>
                <div style={{ marginTop: '2px' }}>
                  <Badge
                    label={`${selectedIntervention.risk_level} RISK`}
                    variant={
                      selectedIntervention.risk_level === 'LOW'
                        ? 'success'
                        : selectedIntervention.risk_level === 'MEDIUM'
                        ? 'warning'
                        : 'danger'
                    }
                    size="sm"
                    dot
                  />
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Operational Domain & Classification
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                {selectedIntervention.intervention_type}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Full Strategic Rationale
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5, marginTop: '4px', margin: 0 }}>
                {selectedIntervention.rationale}
              </p>
            </div>

            {selectedIntervention.preconditions && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Operational Preconditions
                </div>
                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    color: 'var(--text-muted)',
                    marginTop: '4px',
                  }}
                >
                  {selectedIntervention.preconditions}
                </div>
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                padding: '14px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Estimated Time Saved</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '2px' }}>
                  +{selectedIntervention.expected_time_saved_minutes} min
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Model-based counterfactual estimate
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Estimated Implementation Cost</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '2px' }}>
                  {formatCurrency(selectedIntervention.estimated_cost)}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Marginal operational expenditure
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
