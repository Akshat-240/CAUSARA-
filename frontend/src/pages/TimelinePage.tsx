import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { EmptyState } from '../components/common/EmptyState';
import { Order, ReconstructedTimeline, TimelineEvent, ReconstructedStage, EvidenceItem } from '../types/api';
import { fetchOrders, fetchOrder, fetchTimeline, reconstructTimeline, fetchEvidence } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface TimelinePageProps {
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const TimelinePage: React.FC<TimelinePageProps> = ({ initialOrderId, onNavigate }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [timelineData, setTimelineData] = useState<ReconstructedTimeline | null>(null);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [reconstructing, setReconstructing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'visual' | 'table'>('visual');

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
        const rawMsg = err instanceof Error ? err.message : 'Failed to load order list';
        if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
          setError('Database connectivity is restricted by firewall rules. Please verify Azure SQL access.');
        } else {
          setError(rawMsg);
        }
      }
    }
    loadOrdersList();
  }, []);

  // Sync when initialOrderId changes from navigation prop
  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  // Load order details, timeline, and associated evidence for selected order
  const loadOrderAndTimeline = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [orderRes, timelineRes, evidenceRes] = await Promise.allSettled([
        fetchOrder(orderId),
        fetchTimeline(orderId),
        fetchEvidence(orderId),
      ]);

      if (orderRes.status === 'fulfilled') {
        setSelectedOrder(orderRes.value);
      } else {
        // Fallback to finding in preloaded orders array
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
      }

      if (evidenceRes.status === 'fulfilled') {
        setEvidenceList(evidenceRes.value || []);
      } else {
        setEvidenceList([]);
      }

      if (timelineRes.status === 'fulfilled') {
        setTimelineData(timelineRes.value);
      } else {
        // If 404 or not reconstructed yet, attempt automatic reconstruction
        const reason = timelineRes.reason;
        const msg = reason instanceof Error ? reason.message : 'Timeline not found';
        if (msg.includes('not found') || msg.includes('404')) {
          await handleReconstruct(orderId);
        } else {
          throw reason;
        }
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to retrieve timeline.';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connectivity is restricted by firewall rules. Ensure client IP is allowed in Azure SQL.');
      } else if (rawMsg.includes('Connection refused') || rawMsg.includes('Failed to fetch') || rawMsg.includes('503')) {
        setError('Backend service is temporarily unavailable. Please verify API server status.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReconstruct = async (orderId?: number) => {
    const targetId = orderId || selectedOrderId;
    if (!targetId) return;

    setReconstructing(true);
    setError(null);
    try {
      const data = await reconstructTimeline(targetId);
      setTimelineData(data);
      // Re-fetch evidence in case new linkages appeared
      try {
        const ev = await fetchEvidence(targetId);
        setEvidenceList(ev || []);
      } catch {
        // Non-critical
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Reconstruction failed';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connectivity restricted. Cannot reconstruct timeline without active SQL access.');
      } else {
        setError(rawMsg);
      }
    } finally {
      setReconstructing(false);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadOrderAndTimeline(selectedOrderId);
    }
  }, [selectedOrderId]);

  // Evidence lookup map by event_id
  const evidenceByEventId = useMemo(() => {
    const map = new Map<number, EvidenceItem[]>();
    evidenceList.forEach((item) => {
      if (item.event_id) {
        const existing = map.get(item.event_id) || [];
        existing.push(item);
        map.set(item.event_id, existing);
      }
    });
    return map;
  }, [evidenceList]);

  // Formatters
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
    if (minutes === null || minutes === undefined) return '— Unavailable';
    if (minutes === 0) return '0 min';
    const absMin = Math.abs(minutes);
    if (absMin < 60) return `${minutes} min`;
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const sign = minutes < 0 ? '-' : '';
    return `${sign}${h}h ${m > 0 ? `${m}m` : ''}`.trim();
  };

  const timelineEvents = useMemo(() => {
    return Array.isArray(timelineData?.timeline) ? timelineData.timeline : [];
  }, [timelineData]);

  // Table columns for dense event audit view
  const eventColumns: Column<TimelineEvent>[] = [
    {
      key: 'sequence_position',
      header: '#',
      width: '50px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          #{row.sequence_position}
        </span>
      ),
    },
    {
      key: 'event_type',
      header: 'Event & Stage',
      render: (row) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
              {row.event_type}
            </span>
            <span
              style={{
                fontSize: '0.65rem',
                padding: '1px 5px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-subtle)',
                color: 'var(--text-muted)',
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
              title="Category A: Observed Fact"
            >
              FACT
            </span>
          </div>
          {row.stage_code && (
            <div style={{ fontSize: '0.75rem', color: 'var(--primary)', marginTop: '2px', fontWeight: 500 }}>
              Stage: {row.stage_code}
            </div>
          )}
          {row.description && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'occurred_at',
      header: 'Occurred At (Source)',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <div style={{ color: 'var(--text-main)', fontWeight: 500 }}>
            {formatDateTime(row.occurred_at)}
          </div>
          <div style={{ color: 'var(--text-light)', fontSize: '0.72rem', marginTop: '2px' }}>
            Original event timestamp
          </div>
        </div>
      ),
    },
    {
      key: 'received_at',
      header: 'Received At (Causara)',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <div style={{ color: 'var(--text-main)' }}>
            {formatDateTime(row.received_at)}
          </div>
          <div style={{ color: 'var(--text-light)', fontSize: '0.72rem', marginTop: '2px' }}>
            Ingestion timestamp
          </div>
        </div>
      ),
    },
    {
      key: 'source_type',
      header: 'Source Origin',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.source_type}</span>
          {row.source_provider && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {row.source_provider}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'validation_status',
      header: 'Validation',
      render: (row) => {
        let variant: 'success' | 'warning' | 'danger' | 'info' = 'success';
        if (row.validation_status === 'OUT_OF_ORDER') variant = 'warning';
        if (row.validation_status === 'DUPLICATE') variant = 'info';
        if (row.validation_status === 'CONFLICT') variant = 'danger';
        return <Badge label={row.validation_status} variant={variant} size="sm" dot />;
      },
    },
    {
      key: 'evidence',
      header: 'Evidence',
      render: (row) => {
        const evItems = evidenceByEventId.get(row.event_id) || [];
        if (evItems.length === 0) {
          return <span style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>—</span>;
        }
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {evItems.map((ev) => (
              <button
                key={ev.evidence_id}
                type="button"
                onClick={() => onNavigate('evidence', { orderId: row.order_id })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.725rem',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                title={`Evidence file: ${ev.file_name} (${ev.status})`}
              >
                <span>📎</span>
                <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.file_name}
                </span>
              </button>
            ))}
          </div>
        );
      },
    },
    {
      key: 'anomalies',
      header: 'Anomalies',
      render: (row) => (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {row.anomalies && row.anomalies.length > 0 ? (
            row.anomalies.map((a, i) => (
              <Badge key={i} label={a} variant="warning" size="sm" />
            ))
          ) : (
            <span style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>None</span>
          )}
        </div>
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
            {selectedOrder && (
              <Badge
                label={selectedOrder.status}
                variant={getStatusBadgeVariant(selectedOrder.status)}
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
            Order Timeline
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Deterministic chronological reconstruction of ingested order events with anomaly detection.
          </p>
        </div>

        {/* Order Selector and Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            aria-label="Select Order"
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
                  {o.external_order_ref} ({o.status})
                </option>
              ))
            )}
          </select>

          <Button
            variant="outline"
            onClick={() => selectedOrderId && loadOrderAndTimeline(selectedOrderId)}
            disabled={loading || !selectedOrderId}
            title="Refresh order timeline"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={() => handleReconstruct()}
            loading={reconstructing}
            disabled={!selectedOrderId || loading}
            title="Execute factual timeline reconstruction"
          >
            Reconstruct Timeline
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedOrderId && (
              <Button size="sm" variant="outline" onClick={() => loadOrderAndTimeline(selectedOrderId)}>
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
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Order Reference</div>
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
                  : 'Pending final handover'}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifySelf: 'start' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Context Modules</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('delay-analysis', { orderId: selectedOrder.order_id })}
                >
                  Delay Analysis &rarr;
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate('evidence', { orderId: selectedOrder.order_id })}
                >
                  Evidence ({evidenceList.length})
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
            Analytical Distinction System:
          </strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Causara preserves rigorous boundaries between empirical evidence and interpretive models.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-green)' }} />
            <span><strong>A. Observed Facts:</strong> Immutable event timestamps from source logs.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-blue)' }} />
            <span><strong>B. Measured Variances:</strong> Calculated &Delta;t differences from SLA baseline.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-amber)' }} />
            <span><strong>C. Hypotheses:</strong> Unverified candidate delay causes.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--status-purple)' }} />
            <span><strong>D. Estimates:</strong> Projected baseline schedules &amp; simulations.</span>
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner message="Reconstructing and retrieving chronological timeline..." />
      ) : timelineData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Plain-Language Customer Synthesis */}
          {timelineData.summary?.customer_summary && (
            <Card style={{ backgroundColor: 'var(--bg-surface-subtle)', borderColor: 'var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>💬</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                      Operational Narrative Synthesis
                    </h4>
                    <span
                      style={{
                        fontSize: '0.675rem',
                        padding: '1px 6px',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: 'var(--bg-surface)',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                        border: '1px solid var(--border-color)',
                      }}
                    >
                      FACT SYNTHESIS
                    </span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.5, margin: 0 }}>
                    {timelineData.summary.customer_summary}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Metric KPI Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '16px',
            }}
          >
            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Recorded Events
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
                  OBSERVED FACT
                </span>
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
                {timelineData.summary?.total_events || timelineEvents.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', marginTop: '4px' }}>
                {timelineData.summary?.valid_event_count || 0} verified chronological events
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Pipeline Anomalies
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  AUDIT
                </span>
              </div>
              <div
                style={{
                  fontSize: '1.75rem',
                  fontWeight: 700,
                  color: timelineData.summary?.has_anomalies ? 'var(--status-amber)' : 'var(--status-green)',
                  marginTop: '6px',
                }}
              >
                {(timelineData.summary?.out_of_order_count || 0) +
                  (timelineData.summary?.duplicate_count || 0) +
                  (timelineData.summary?.conflict_count || 0)}
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {timelineData.summary?.out_of_order_count || 0} out-of-order, {timelineData.summary?.duplicate_count || 0} duplicates
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Net Stage Variance
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
                  MEASURED VARIANCE
                </span>
              </div>
              {(() => {
                const totalVariance = (timelineData.stage_progression || []).reduce(
                  (acc, s) => acc + (s.variance_minutes || 0),
                  0
                );
                const hasDelay = totalVariance > 0;
                return (
                  <>
                    <div
                      style={{
                        fontSize: '1.75rem',
                        fontWeight: 700,
                        color: hasDelay ? 'var(--status-amber)' : 'var(--status-green)',
                        marginTop: '6px',
                      }}
                    >
                      {totalVariance > 0 ? `+${totalVariance} min` : `${totalVariance} min`}
                    </div>
                    <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {hasDelay ? 'Cumulative stage delay detected' : 'Stages executing on schedule'}
                    </div>
                  </>
                );
              })()}
            </Card>

            <Card padding="16px">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Reconstruction State
                </span>
                <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
                  INTEGRITY
                </span>
              </div>
              <div style={{ marginTop: '10px' }}>
                <Badge
                  label={timelineData.summary?.is_complete ? 'Complete Sequence' : 'Partial Sequence'}
                  variant={timelineData.summary?.is_complete ? 'success' : 'warning'}
                  size="md"
                />
              </div>
              <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Reconstructed: {formatDateTime(timelineData.reconstructed_at)}
              </div>
            </Card>
          </div>

          {/* Planned vs. Actual Operational Stage Progression */}
          {timelineData.stage_progression && timelineData.stage_progression.length > 0 && (
            <Card
              title="Planned vs. Actual Operational Stage Progression"
              subtitle="Mathematical comparison between baseline SLA schedules and observed execution milestones"
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '16px',
                }}
              >
                {timelineData.stage_progression.map((stage: ReconstructedStage) => {
                  const hasVariance = stage.variance_minutes !== null && stage.variance_minutes !== undefined;
                  const isDelayed = hasVariance && stage.variance_minutes! > 0;
                  const isAhead = hasVariance && stage.variance_minutes! < 0;

                  return (
                    <div
                      key={stage.stage_id}
                      style={{
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        border: isDelayed
                          ? '1px solid var(--status-amber-border)'
                          : '1px solid var(--border-color)',
                        backgroundColor: isDelayed
                          ? 'var(--status-amber-bg)'
                          : 'var(--bg-surface)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        transition: 'background-color 0.15s ease, border-color 0.15s ease',
                      }}
                    >
                      {/* Stage Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              color: 'var(--primary)',
                              backgroundColor: 'var(--primary-subtle)',
                              padding: '2px 6px',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          >
                            #{stage.sequence_no}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                            {stage.stage_code}
                          </span>
                        </div>
                        <Badge
                          label={stage.status}
                          variant={getStatusBadgeVariant(stage.status)}
                          size="sm"
                          dot
                        />
                      </div>

                      {/* Timestamps Comparison Grid */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: '10px',
                          fontSize: '0.775rem',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                        }}
                      >
                        <div>
                          <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                            Planned SLA
                          </div>
                          <div>Start: {formatDateTime(stage.planned_start_at)}</div>
                          <div>End: {formatDateTime(stage.planned_end_at)}</div>
                          <div style={{ color: 'var(--text-light)', marginTop: '4px' }}>
                            Duration: {formatDuration(stage.planned_duration_minutes)}
                          </div>
                        </div>

                        <div>
                          <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: '2px' }}>
                            Actual Observed
                          </div>
                          <div>Start: {formatDateTime(stage.actual_start_at)}</div>
                          <div>End: {formatDateTime(stage.actual_end_at)}</div>
                          <div style={{ color: 'var(--text-light)', marginTop: '4px' }}>
                            Duration: {formatDuration(stage.actual_duration_minutes)}
                          </div>
                        </div>
                      </div>

                      {/* Variance & Evidence Footer */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--border-color)',
                          fontSize: '0.8rem',
                        }}
                      >
                        <div>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>
                            Duration Variance (&Delta;t)
                          </span>
                          <span
                            style={{
                              fontWeight: 700,
                              color: isDelayed
                                ? 'var(--status-amber)'
                                : isAhead
                                ? 'var(--status-green)'
                                : 'var(--text-main)',
                            }}
                          >
                            {stage.variance_minutes !== null && stage.variance_minutes !== undefined
                              ? `${stage.variance_minutes > 0 ? '+' : ''}${stage.variance_minutes} min`
                              : '— Unavailable'}
                          </span>
                          {isDelayed && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '0.675rem',
                                color: 'var(--status-amber)',
                                fontWeight: 600,
                              }}
                            >
                              (Delay)
                            </span>
                          )}
                          {isAhead && (
                            <span
                              style={{
                                marginLeft: '6px',
                                fontSize: '0.675rem',
                                color: 'var(--status-green)',
                                fontWeight: 600,
                              }}
                            >
                              (Ahead)
                            </span>
                          )}
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>
                            Recorded Events
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                            {stage.event_count || (stage.event_ids ? stage.event_ids.length : 0)}
                          </span>
                        </div>
                      </div>

                      {/* Anomalies if present */}
                      {stage.anomalies && stage.anomalies.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {stage.anomalies.map((anom, idx) => (
                            <Badge key={idx} label={anom} variant="warning" size="sm" />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Chronological Event History */}
          <Card
            title={`Chronological Event Sequence (${timelineEvents.length})`}
            subtitle="Immutable event logs ordered chronologically with source timestamps"
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Button
                  size="sm"
                  variant={viewMode === 'visual' ? 'primary' : 'outline'}
                  onClick={() => setViewMode('visual')}
                >
                  Visual Timeline
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'table' ? 'primary' : 'outline'}
                  onClick={() => setViewMode('table')}
                >
                  Event Table
                </Button>
              </div>
            }
          >
            {timelineEvents.length === 0 ? (
              <EmptyState
                title="No events recorded"
                description="No immutable order events have been ingested into this timeline yet."
                actionLabel="Reconstruct Timeline"
                onAction={() => handleReconstruct()}
              />
            ) : viewMode === 'table' ? (
              <Table
                columns={eventColumns}
                data={timelineEvents}
                keyExtractor={(e) => e.event_id}
                emptyMessage="No events found for this order."
              />
            ) : (
              /* Connected Visual Vertical Timeline */
              <div style={{ position: 'relative', paddingLeft: '32px', margin: '16px 0' }}>
                {/* Vertical Connector Line */}
                <div
                  style={{
                    position: 'absolute',
                    top: '16px',
                    bottom: '16px',
                    left: '11px',
                    width: '2px',
                    backgroundColor: 'var(--border-color)',
                  }}
                />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {timelineEvents.map((event: TimelineEvent, idx: number) => {
                    const isOutOfOrder = event.validation_status === 'OUT_OF_ORDER';
                    const isConflict = event.validation_status === 'CONFLICT';
                    const nodeColor = isConflict
                      ? 'var(--status-red)'
                      : isOutOfOrder
                      ? 'var(--status-amber)'
                      : 'var(--status-green)';

                    const linkedEvidence = evidenceByEventId.get(event.event_id) || [];

                    return (
                      <div key={event.event_id} style={{ position: 'relative' }}>
                        {/* Chronological Connector Node */}
                        <div
                          style={{
                            position: 'absolute',
                            left: '-32px',
                            top: '16px',
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--bg-surface)',
                            border: `3px solid ${nodeColor}`,
                            boxShadow: 'var(--shadow-sm)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            color: 'var(--text-main)',
                            zIndex: 1,
                          }}
                        >
                          {idx + 1}
                        </div>

                        {/* Event Card */}
                        <div
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-md)',
                            padding: '16px',
                            boxShadow: 'var(--shadow-sm)',
                            transition: 'border-color 0.15s ease',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: '12px',
                              flexWrap: 'wrap',
                              marginBottom: '10px',
                            }}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  style={{
                                    fontWeight: 700,
                                    fontSize: '0.95rem',
                                    color: 'var(--text-main)',
                                    letterSpacing: '-0.01em',
                                  }}
                                >
                                  {event.event_type}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.65rem',
                                    padding: '1px 6px',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--status-green-bg)',
                                    color: 'var(--status-green)',
                                    fontWeight: 600,
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  OBSERVED FACT
                                </span>
                              </div>

                              {event.stage_code && (
                                <div
                                  style={{
                                    fontSize: '0.775rem',
                                    color: 'var(--primary)',
                                    fontWeight: 600,
                                    marginTop: '2px',
                                  }}
                                >
                                  Associated Stage: {event.stage_code}
                                </div>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <Badge
                                label={event.validation_status}
                                variant={
                                  event.validation_status === 'VALID'
                                    ? 'success'
                                    : event.validation_status === 'OUT_OF_ORDER'
                                    ? 'warning'
                                    : event.validation_status === 'DUPLICATE'
                                    ? 'info'
                                    : 'danger'
                                }
                                size="sm"
                                dot
                              />
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 600 }}>
                                #{event.sequence_position}
                              </span>
                            </div>
                          </div>

                          {event.description && (
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 12px 0' }}>
                              {event.description}
                            </p>
                          )}

                          {/* Dual Timestamps & Origin Metadata */}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                              gap: '12px',
                              padding: '10px 12px',
                              backgroundColor: 'var(--bg-surface-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.775rem',
                            }}
                          >
                            <div>
                              <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                                Occurred At (Source System)
                              </div>
                              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                                {formatDateTime(event.occurred_at)}
                              </div>
                            </div>

                            <div>
                              <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                                Received At (Causara Log)
                              </div>
                              <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>
                                {formatDateTime(event.received_at)}
                              </div>
                            </div>

                            <div>
                              <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                                Source Provider
                              </div>
                              <div style={{ color: 'var(--text-main)', marginTop: '2px' }}>
                                {event.source_type}
                                {event.source_provider ? ` (${event.source_provider})` : ''}
                              </div>
                            </div>
                          </div>

                          {/* Linked Evidence Files */}
                          {linkedEvidence.length > 0 && (
                            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                                Attached Evidence Artifacts:
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {linkedEvidence.map((ev) => (
                                  <button
                                    key={ev.evidence_id}
                                    type="button"
                                    onClick={() => onNavigate('evidence', { orderId: event.order_id })}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      padding: '4px 10px',
                                      fontSize: '0.75rem',
                                      borderRadius: 'var(--radius-sm)',
                                      backgroundColor: 'var(--bg-surface)',
                                      border: '1px solid var(--border-color)',
                                      color: 'var(--primary)',
                                      cursor: 'pointer',
                                      boxShadow: 'var(--shadow-sm)',
                                    }}
                                  >
                                    <span>📎</span>
                                    <strong>{ev.file_name}</strong>
                                    <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
                                      ({ev.status})
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Anomalies list */}
                          {event.anomalies && event.anomalies.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                              {event.anomalies.map((anom, i) => (
                                <Badge key={i} label={`Anomaly: ${anom}`} variant="warning" size="sm" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No timeline reconstructed"
            description="Select an order above or click Reconstruct Timeline to generate the chronological event history."
            actionLabel="Reconstruct Timeline"
            onAction={() => handleReconstruct()}
          />
        </Card>
      )}
    </div>
  );
};
