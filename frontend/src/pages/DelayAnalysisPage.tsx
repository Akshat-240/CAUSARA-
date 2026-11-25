import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, EpistemologyBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { EmptyState } from '../components/common/EmptyState';
import { DelayAnalysisReport, Order, StageDelayMetric, DelayGraphEdge, DemoActor } from '../types/api';
import { fetchOrders, fetchOrder, fetchDelayAnalysis, runDelayAnalysis } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface DelayAnalysisPageProps {
  initialOrderId?: number;
  activeActor: DemoActor | null;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const DelayAnalysisPage: React.FC<DelayAnalysisPageProps> = ({
  initialOrderId,
  activeActor,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [report, setReport] = useState<DelayAnalysisReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load orders list for selector
  useEffect(() => {
    async function loadOrdersList() {
      try {
        const res = await fetchOrders({ limit: 50 });
        setOrders(res.orders || []);
        if (!selectedOrderId && res.orders && res.orders.length > 0) {
          setSelectedOrderId(res.orders[0].order_id);
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
    loadOrdersList();
  }, []);

  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  // Load report and order context for selected order
  const loadReportAndOrder = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [orderRes, reportRes] = await Promise.allSettled([
        fetchOrder(orderId),
        fetchDelayAnalysis(orderId),
      ]);

      if (orderRes.status === 'fulfilled') {
        setSelectedOrder(orderRes.value);
      } else {
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
      }

      if (reportRes.status === 'fulfilled') {
        setReport(reportRes.value);
      } else {
        const reason = reportRes.reason;
        const msg = reason instanceof Error ? reason.message : 'Report not found';
        if (msg.includes('not found') || msg.includes('404')) {
          await handleRunAnalysis(orderId);
        } else {
          throw reason;
        }
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to retrieve delay analysis.';
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

  const handleRunAnalysis = async (orderId?: number) => {
    const targetId = orderId || selectedOrderId;
    if (!targetId) return;

    setAnalyzing(true);
    setError(null);
    try {
      const data = await runDelayAnalysis(targetId, activeActor ? activeActor.id : undefined);
      setReport(data);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Delay analysis failed';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connectivity restricted. Cannot run delay analysis without active SQL access.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadReportAndOrder(selectedOrderId);
    }
  }, [selectedOrderId]);

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

  const formatDuration = (minutes: number | null | undefined): string => {
    if (minutes === null || minutes === undefined) return '—';
    if (minutes === 0) return '0 min';
    const absMin = Math.abs(minutes);
    if (absMin < 60) return `${minutes} min`;
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const sign = minutes < 0 ? '-' : '';
    return `${sign}${h}h ${m > 0 ? `${m}m` : ''}`.trim();
  };

  const stageColumns: Column<StageDelayMetric>[] = [
    {
      key: 'sequence_no',
      header: '#',
      width: '50px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          #{row.sequence_no}
        </span>
      ),
    },
    {
      key: 'stage_code',
      header: 'Operational Stage',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
            {row.stage_code}
          </span>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Status: {row.status}
          </div>
        </div>
      ),
    },
    {
      key: 'planned_duration',
      header: 'Planned SLA',
      render: (row) => (
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {formatDuration(row.planned_duration_minutes)}
        </span>
      ),
    },
    {
      key: 'actual_duration',
      header: 'Actual Elapsed',
      render: (row) => (
        <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-main)' }}>
          {formatDuration(row.actual_duration_minutes)}
        </span>
      ),
    },
    {
      key: 'variance_minutes',
      header: 'Calculated Variance (Δt)',
      render: (row) => {
        if (row.variance_minutes === null || row.variance_minutes === undefined) {
          return <span style={{ color: 'var(--text-light)' }}>—</span>;
        }
        const isExcess = row.variance_minutes > 0;
        const isAhead = row.variance_minutes < 0;
        return (
          <div>
            <span
              style={{
                fontWeight: 700,
                fontSize: '0.85rem',
                color: isExcess ? 'var(--status-amber)' : isAhead ? 'var(--status-green)' : 'var(--text-main)',
              }}
            >
              {isExcess ? `+${row.variance_minutes}` : row.variance_minutes} min
            </span>
            {isExcess && (
              <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: 'var(--status-amber)', fontWeight: 600 }}>
                (Delay)
              </span>
            )}
            {isAhead && (
              <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: 'var(--status-green)', fontWeight: 600 }}>
                (Ahead)
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'epistemology',
      header: 'Classification',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <EpistemologyBadge type={row.actual_duration_minutes !== null ? 'FACT' : 'ESTIMATE'} />
          {row.is_delayed && <Badge label="DELAYED" variant="danger" size="sm" dot />}
        </div>
      ),
    },
    {
      key: 'evidence_link',
      header: 'Evidence',
      render: () => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onNavigate('evidence', { orderId: selectedOrderId || undefined })}
          title="Inspect corroborating evidence artifacts"
        >
          Inspect Artifacts
        </Button>
      ),
    },
  ];

  const graphColumns: Column<DelayGraphEdge>[] = [
    {
      key: 'transition',
      header: 'Propagation Path',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
            {row.from_stage_code}
          </span>
          <span style={{ color: 'var(--text-light)' }}>&rarr;</span>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
            {row.to_stage_code}
          </span>
        </div>
      ),
    },
    {
      key: 'edge_type',
      header: 'Relationship Type',
      render: (row) => (
        <Badge
          label={row.edge_type.replace('_', ' ')}
          variant={row.edge_type === 'STAGE_TRANSITION' ? 'neutral' : 'warning'}
          size="sm"
        />
      ),
    },
    {
      key: 'evidence_class',
      header: 'Epistemology',
      render: (row) => <EpistemologyBadge type={row.evidence_class} />,
    },
    {
      key: 'estimated_delay',
      header: 'Attributed Variance',
      render: (row) => (
        <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>
          {row.estimated_delay_minutes ? `+${row.estimated_delay_minutes} min` : '0 min'}
        </span>
      ),
    },
    {
      key: 'explanation',
      header: 'Causal Chain Narrative',
      render: (row) => (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {row.explanation}
        </span>
      ),
    },
  ];

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
            {report && (
              <Badge
                label={report.is_delayed ? 'DELAY DETECTED' : 'ON SCHEDULE'}
                variant={report.is_delayed ? 'danger' : 'success'}
                dot
                size="sm"
              />
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
            Delay Analysis & Root-Cause Hypotheses
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Multi-stage duration variance decomposition and causal chain graph synthesis.
          </p>
        </div>

        {/* Order Selector and Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            aria-label="Select Target Order"
            value={selectedOrderId || ''}
            onChange={(e) => setSelectedOrderId(Number(e.target.value))}
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
                  {o.external_order_ref} (#{o.order_id})
                </option>
              ))
            )}
          </select>

          <Button
            variant="outline"
            onClick={() => selectedOrderId && loadReportAndOrder(selectedOrderId)}
            disabled={loading || !selectedOrderId}
            title="Refresh delay analysis report"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={() => handleRunAnalysis()}
            loading={analyzing}
            disabled={!selectedOrderId || loading}
            title="Execute delay variance synthesis"
          >
            Run Delay Analysis
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedOrderId && (
              <Button size="sm" variant="outline" onClick={() => loadReportAndOrder(selectedOrderId)}>
                Retry
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Selected Order Summary Context Card */}
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Consignment</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '2px' }}>
                {selectedOrder.external_order_ref}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-light)', marginTop: '2px' }}>
                Internal ID #{selectedOrder.order_id}
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
                  View Timeline &rarr;
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('evidence', { orderId: selectedOrder.order_id })}
                >
                  Evidence Files
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Mandatory Epistemological Guardrail Banner */}
      <div
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          borderLeft: '4px solid var(--status-amber)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <strong style={{ fontSize: '0.825rem', color: 'var(--text-main)' }}>
            Epistemological Guardrail:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Stage duration variances represent calculated mathematical differences between observed durations and SLA baselines.
            Variance alone does NOT constitute proven causal fault. Propagation edges remain structured hypotheses.
          </span>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Decomposing stage variances and assembling delay graph..." />
      ) : report ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Executive Delay Metrics Summary Strip */}
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
                  Delivery Status
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  OVERALL
                </span>
              </div>
              <div style={{ marginTop: '8px' }}>
                <Badge
                  label={report.is_delayed ? 'DELAY DETECTED' : 'ON SCHEDULE'}
                  variant={report.is_delayed ? 'danger' : 'success'}
                  size="md"
                  dot
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Order #{report.order_id} {report.case_id ? `• Case #${report.case_id}` : ''}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Total Delivery Variance
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
                  Δt VARIANCE
                </span>
              </div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  color: (report.total_delivery_variance_minutes || 0) > 0 ? 'var(--status-amber)' : 'var(--status-green)',
                  marginTop: '4px',
                }}
              >
                {report.total_delivery_variance_minutes !== null
                  ? `${report.total_delivery_variance_minutes > 0 ? '+' : ''}${report.total_delivery_variance_minutes} min`
                  : '0 min'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Actual: {formatDuration(report.total_actual_duration_minutes)} vs Planned: {formatDuration(report.total_planned_duration_minutes)}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Primary Bottleneck
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-amber-bg)', color: 'var(--status-amber)', fontWeight: 600 }}>
                  CRITICAL PATH
                </span>
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)', marginTop: '6px' }}>
                {report.primary_delay_stage_code || 'None'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Highest accumulated duration variance
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Intervention Readiness
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  ACTION
                </span>
              </div>
              <div style={{ marginTop: '10px' }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onNavigate('interventions', { caseId: report.case_id || undefined, orderId: report.order_id })}
                  disabled={!report.case_id}
                  title="Formulate counterfactual interventions"
                >
                  Explore Interventions &rarr;
                </Button>
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                {report.case_id ? `Case #${report.case_id} open for modeling` : 'No active incident case logged'}
              </div>
            </Card>
          </div>

          {/* 4-Quadrant Epistemological Taxonomy Breakdown */}
          {report.epistemological_breakdown && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: '16px',
              }}
            >
              <Card padding="16px" style={{ borderLeft: '4px solid var(--status-green)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    FACTS
                  </span>
                  <EpistemologyBadge type="FACT" />
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
                  {report.epistemological_breakdown.facts?.observed_stages_count || 0} stages
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                  {report.epistemological_breakdown.facts?.description || 'Empirically recorded timestamps.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--status-blue)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    VARIANCES
                  </span>
                  <EpistemologyBadge type="VARIANCE" />
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
                  {report.epistemological_breakdown.variances?.stages_with_variance_count || 0} stages
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                  {report.epistemological_breakdown.variances?.description || 'Deviations from planned baseline SLA.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--status-amber)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    HYPOTHESES
                  </span>
                  <EpistemologyBadge type="HYPOTHESIS" />
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
                  {report.epistemological_breakdown.hypotheses?.candidate_edges_count || 0} edges
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                  {report.epistemological_breakdown.hypotheses?.description || 'Synthesized causal chain candidates.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--status-purple)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    ESTIMATES
                  </span>
                  <EpistemologyBadge type="ESTIMATE" />
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
                  {report.epistemological_breakdown.estimates?.total_estimated_delay_minutes || 0} min
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                  {report.epistemological_breakdown.estimates?.description || 'Projected downstream impact.'}
                </p>
              </Card>
            </div>
          )}

          {/* Missing Data Warnings */}
          {report.missing_data_warnings && report.missing_data_warnings.length > 0 && (
            <Alert type="warning">
              <div>
                <strong>Data Completeness Notice:</strong>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: '18px' }}>
                  {report.missing_data_warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </Alert>
          )}

          {/* Stage Duration Metrics Table */}
          <Card
            title="Stage Duration Variance Decomposition"
            subtitle="Observed stage durations mathematically compared against planned baseline SLAs"
          >
            <Table
              columns={stageColumns}
              data={report.stage_metrics}
              keyExtractor={(s) => s.stage_id}
              emptyMessage="No stage metrics computed for this order."
            />
          </Card>

          {/* Causal Chain / Delay Propagation Graph */}
          <Card
            title={`Synthesized Delay Graph (${report.delay_graph.length} Propagation Edges)`}
            subtitle="Structured causal hypotheses linking stage transitions and bottleneck propagation"
          >
            <Table
              columns={graphColumns}
              data={report.delay_graph}
              keyExtractor={(e, idx) => e.edge_id || idx}
              emptyMessage="No delay propagation edges identified."
            />
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No delay analysis generated"
            description="Select an order above and click Run Delay Analysis to synthesize stage duration variances and causal propagation graphs."
            actionLabel="Run Delay Analysis"
            onAction={() => handleRunAnalysis()}
          />
        </Card>
      )}
    </div>
  );
};
