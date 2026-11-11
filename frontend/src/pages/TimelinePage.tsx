import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { Order, ReconstructedTimeline, TimelineEvent } from '../types/api';
import { fetchOrders, fetchTimeline, reconstructTimeline } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface TimelinePageProps {
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const TimelinePage: React.FC<TimelinePageProps> = ({ initialOrderId, onNavigate }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [timelineData, setTimelineData] = useState<ReconstructedTimeline | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [reconstructing, setReconstructing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load orders list for selector
  useEffect(() => {
    async function loadOrdersList() {
      try {
        const res = await fetchOrders({ limit: 50 });
        setOrders(res.orders);
        if (!selectedOrderId && res.orders.length > 0) {
          setSelectedOrderId(res.orders[0].order_id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load order list');
      }
    }
    loadOrdersList();
  }, []);

  // When initialOrderId changes from navigation prop
  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  // Load timeline for selected order
  const loadTimeline = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTimeline(orderId);
      setTimelineData(data);
    } catch (err: unknown) {
      // If timeline is not yet reconstructed, try to trigger reconstruction
      const msg = err instanceof Error ? err.message : 'Timeline not found';
      if (msg.includes('not found') || msg.includes('404')) {
        await handleReconstruct(orderId);
      } else {
        setError(msg);
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reconstruction failed');
    } finally {
      setReconstructing(false);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadTimeline(selectedOrderId);
    }
  }, [selectedOrderId]);

  const eventColumns: Column<TimelineEvent>[] = [
    {
      key: 'sequence_position',
      header: '#',
      width: '50px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          {row.sequence_position}
        </span>
      ),
    },
    {
      key: 'event_type',
      header: 'Event Type',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
            {row.event_type}
          </span>
          {row.stage_code && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Stage: {row.stage_code}
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
          <div>{new Date(row.occurred_at).toLocaleDateString()}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            {new Date(row.occurred_at).toLocaleTimeString()}
          </div>
        </div>
      ),
    },
    {
      key: 'received_at',
      header: 'Received At (Causara)',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <div>{new Date(row.received_at).toLocaleDateString()}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            {new Date(row.received_at).toLocaleTimeString()}
          </div>
        </div>
      ),
    },
    {
      key: 'source_type',
      header: 'Source',
      render: (row) => (
        <div>
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{row.source_type}</span>
          {row.source_provider && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>
              {row.source_provider}
            </span>
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
        return <Badge label={row.validation_status} variant={variant} size="sm" />;
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
            Factual Order Timeline
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Deterministic chronological reconstruction of ingested order events with anomaly detection.
          </p>
        </div>

        {/* Order Selector and Reconstruct Action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select
            value={selectedOrderId || ''}
            onChange={(e) => setSelectedOrderId(Number(e.target.value))}
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
                {o.external_order_ref} ({o.status})
              </option>
            ))}
          </select>

          <Button
            variant="primary"
            onClick={() => handleReconstruct()}
            loading={reconstructing}
            disabled={!selectedOrderId}
          >
            Reconstruct Timeline
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Epistemological Rule:</strong> This timeline presents empirical, verified facts
        extracted from immutable event logs. Observed stage durations or order anomalies reflect
        recorded history, not confirmed causal fault.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {loading ? (
        <LoadingSpinner message="Reconstructing and loading timeline events..." />
      ) : timelineData ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Customer Explanation Banner */}
          {timelineData.summary?.customer_summary && (
            <Card style={{ backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '1.3rem' }}>💬</span>
                <div>
                  <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0369a1', marginBottom: '4px' }}>
                    Plain-Language Summary
                  </h4>
                  <p style={{ fontSize: '0.875rem', color: '#0c4a6e', lineHeight: 1.5 }}>
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
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
            }}
          >
            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Total Recorded Events
              </div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '4px' }}>
                {timelineData.summary?.total_events || timelineData.timeline.length}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--status-green)', marginTop: '4px' }}>
                {timelineData.summary?.valid_event_count || 0} valid events
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Order Status
              </div>
              <div style={{ marginTop: '6px' }}>
                <Badge
                  label={timelineData.order_status}
                  variant={getStatusBadgeVariant(timelineData.order_status)}
                  size="md"
                  dot
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Order #{timelineData.order_id}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Detected Anomalies
              </div>
              <div
                style={{
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  color: timelineData.summary?.has_anomalies ? 'var(--status-yellow)' : 'var(--status-green)',
                  marginTop: '4px',
                }}
              >
                {(timelineData.summary?.out_of_order_count || 0) +
                  (timelineData.summary?.duplicate_count || 0) +
                  (timelineData.summary?.conflict_count || 0)}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {timelineData.summary?.out_of_order_count || 0} out-of-order, {timelineData.summary?.duplicate_count || 0} dups
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Next Action
              </div>
              <div style={{ marginTop: '10px' }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onNavigate('delay-analysis', { orderId: timelineData.order_id })}
                >
                  Analyze Delays &rarr;
                </Button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Calculate duration variances
              </div>
            </Card>
          </div>

          {/* Reconstructed Operational Stages */}
          {timelineData.stage_progression && timelineData.stage_progression.length > 0 && (
            <Card
              title="Operational Stage Progression"
              subtitle="Reconstructed stage timelines with duration variance metrics"
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                {timelineData.stage_progression.map((stage) => {
                  const hasDelay = (stage.variance_minutes || 0) > 0;
                  return (
                    <div
                      key={stage.stage_id}
                      style={{
                        padding: '12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                        backgroundColor: hasDelay ? '#fef2f2' : '#ffffff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stage.stage_code}</span>
                        <Badge label={stage.status} variant={getStatusBadgeVariant(stage.status)} size="sm" />
                      </div>

                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                        <div>Planned: {stage.planned_duration_minutes ?? '—'} min</div>
                        <div>Actual: {stage.actual_duration_minutes ?? '—'} min</div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: hasDelay ? 'var(--status-red)' : 'var(--status-green)',
                            marginTop: '2px',
                          }}
                        >
                          Variance: {stage.variance_minutes !== null ? `${stage.variance_minutes > 0 ? '+' : ''}${stage.variance_minutes} min` : '—'}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Chronological Event Log */}
          <Card
            title={`Chronological Events (${timelineData.timeline.length})`}
            subtitle="Normalized sequence ordered by occurred_at timestamp"
          >
            <Table
              columns={eventColumns}
              data={timelineData.timeline}
              keyExtractor={(e) => e.event_id}
              emptyMessage="No events found for this order."
            />
          </Card>
        </div>
      ) : (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Select an order above to view its reconstructed factual timeline.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};
