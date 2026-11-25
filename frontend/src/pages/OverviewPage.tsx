import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { EmptyState } from '../components/common/EmptyState';
import { Order, OrderStats } from '../types/api';
import { fetchOrders, fetchOrderStats } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface OverviewPageProps {
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsData, ordersRes] = await Promise.all([
        fetchOrderStats(),
        fetchOrders({ limit: 10 }),
      ]);
      setStats(statsData);
      setRecentOrders(ordersRes.orders || []);
    } catch (err: unknown) {
      let rawMsg = err instanceof Error ? err.message : 'Failed to retrieve dashboard metrics.';
      // Sanitize raw SQL/firewall errors to protect internal infrastructure details
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall') || rawMsg.includes('Client with IP')) {
        setError(
          'Database connectivity is restricted by current firewall rules. ' +
          'Ensure your client IP is allowed in Azure SQL Networking or use local database.'
        );
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
    loadData();
  }, []);

  // Filter orders that require immediate operational attention
  const attentionOrders = useMemo(() => {
    return recentOrders.filter(
      (o) =>
        o.status === 'DELAYED' ||
        o.status === 'CANCELLED' ||
        (o.active_case_id !== null && o.active_case_id !== undefined)
    );
  }, [recentOrders]);

  // Status distribution percentages derived strictly from real stats data
  const statusDistribution = useMemo(() => {
    if (!stats || !stats.total_orders || stats.total_orders <= 0) return null;
    const total = stats.total_orders;
    return {
      delivered: {
        count: stats.delivered_orders || 0,
        pct: Math.round(((stats.delivered_orders || 0) / total) * 100),
        color: 'var(--status-green)',
        bg: 'var(--status-green-bg)',
      },
      active: {
        count: stats.active_orders || 0,
        pct: Math.round(((stats.active_orders || 0) / total) * 100),
        color: 'var(--status-blue)',
        bg: 'var(--status-blue-bg)',
      },
      delayed: {
        count: stats.delayed_orders || 0,
        pct: Math.round(((stats.delayed_orders || 0) / total) * 100),
        color: 'var(--status-amber)',
        bg: 'var(--status-amber-bg)',
      },
      cancelled: {
        count: stats.cancelled_orders || 0,
        pct: Math.round(((stats.cancelled_orders || 0) / total) * 100),
        color: 'var(--status-red)',
        bg: 'var(--status-red-bg)',
      },
    };
  }, [stats]);

  const recentColumns: Column<Order>[] = [
    {
      key: 'external_order_ref',
      header: 'Order Reference',
      render: (row) => (
        <div>
          <button
            type="button"
            onClick={() => onNavigate('orders', { orderId: row.order_id })}
            style={{
              background: 'none',
              border: 'none',
              fontWeight: 600,
              color: 'var(--primary)',
              cursor: 'pointer',
              padding: 0,
              fontSize: 'inherit',
              textAlign: 'left',
            }}
          >
            {row.external_order_ref}
          </button>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            ID #{row.order_id} • Placed {row.placed_at ? new Date(row.placed_at).toLocaleDateString() : 'N/A'}
          </div>
        </div>
      ),
    },
    {
      key: 'seller',
      header: 'Seller',
      render: (row) => (
        <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
          {row.seller_business_name || `Seller #${row.seller_id}`}
        </span>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <span style={{ color: 'var(--text-main)' }}>
          {row.customer_name || `User #${row.customer_user_id}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge
          label={row.status}
          variant={getStatusBadgeVariant(row.status)}
          dot
          size="sm"
        />
      ),
    },
    {
      key: 'expected_delivery_at',
      header: 'Expected Delivery',
      render: (row) => (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {row.expected_delivery_at ? new Date(row.expected_delivery_at).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate('timeline', { orderId: row.order_id })}
            title="Inspect chronological order stage events"
          >
            Timeline
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onNavigate('delay-analysis', { orderId: row.order_id })}
            title="Inspect causal delay variance and evidence"
          >
            Delay Analysis
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* A. Page Heading */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '1.65rem',
              fontWeight: 700,
              letterSpacing: '-0.025em',
              color: 'var(--text-main)',
              lineHeight: 1.2,
            }}
          >
            Logistics Overview
          </h2>
          <p
            style={{
              fontSize: '0.85rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              maxWidth: '680px',
            }}
          >
            Real-time fulfillment intelligence, stage variance monitoring, and counterfactual decision telemetry.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <Button
            variant="secondary"
            onClick={loadData}
            loading={loading}
            aria-label="Refresh dashboard data"
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => onNavigate('orders')}
            aria-label="Manage orders"
          >
            Manage Orders
          </Button>
        </div>
      </div>

      {/* Connectivity Alert / Error Notification */}
      {error && (
        <Alert
          type="warning"
          title="Fulfillment Telemetry Notice"
          style={{ marginBottom: 0 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={loadData} loading={loading}>
              Retry Connection
            </Button>
          </div>
        </Alert>
      )}

      {/* B. KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '16px',
        }}
      >
        {/* KPI 1: Total Orders */}
        <Card padding="20px" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              backgroundColor: 'var(--primary)',
            }}
          />
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Total Orders
          </div>
          <div
            style={{
              fontSize: '2.1rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              letterSpacing: '-0.02em',
              margin: '8px 0 4px',
            }}
          >
            {loading ? '—' : (stats?.total_orders ?? 0)}
          </div>
          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
            Total registered order records
          </div>
        </Card>

        {/* KPI 2: Active Fulfillment */}
        <Card padding="20px" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              backgroundColor: 'var(--status-blue)',
            }}
          />
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--status-blue)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Fulfilment
          </div>
          <div
            style={{
              fontSize: '2.1rem',
              fontWeight: 700,
              color: 'var(--status-blue)',
              letterSpacing: '-0.02em',
              margin: '8px 0 4px',
            }}
          >
            {loading ? '—' : (stats?.active_orders ?? 0)}
          </div>
          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
            Processing or in-transit consignments
          </div>
        </Card>

        {/* KPI 3: Delivered Orders */}
        <Card padding="20px" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              backgroundColor: 'var(--status-green)',
            }}
          />
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--status-green)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Delivered Orders
          </div>
          <div
            style={{
              fontSize: '2.1rem',
              fontWeight: 700,
              color: 'var(--status-green)',
              letterSpacing: '-0.02em',
              margin: '8px 0 4px',
            }}
          >
            {loading ? '—' : (stats?.delivered_orders ?? 0)}
          </div>
          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
            Confirmed final handoffs
          </div>
        </Card>

        {/* KPI 4: Active Investigations */}
        <Card padding="20px" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              backgroundColor: 'var(--status-amber)',
            }}
          />
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--status-amber)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Investigations
          </div>
          <div
            style={{
              fontSize: '2.1rem',
              fontWeight: 700,
              color: 'var(--status-amber)',
              letterSpacing: '-0.02em',
              margin: '8px 0 4px',
            }}
          >
            {loading ? '—' : (stats?.open_cases_count ?? 0)}
          </div>
          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
            {stats?.delayed_orders ?? 0} delayed • {stats?.open_cases_count ?? 0} cases open
          </div>
        </Card>

        {/* KPI 5: Cancelled Orders */}
        <Card padding="20px" style={{ position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3px',
              backgroundColor: 'var(--status-red)',
            }}
          />
          <div style={{ fontSize: '0.725rem', fontWeight: 600, color: 'var(--status-red)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Cancelled Orders
          </div>
          <div
            style={{
              fontSize: '2.1rem',
              fontWeight: 700,
              color: 'var(--status-red)',
              letterSpacing: '-0.02em',
              margin: '8px 0 4px',
            }}
          >
            {loading ? '—' : (stats?.cancelled_orders ?? 0)}
          </div>
          <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
            Terminated prior to completion
          </div>
        </Card>
      </div>

      {/* C. Analytics Section */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Analytics 1: Fulfillment Status Distribution */}
        <Card
          title="Fulfillment Status Breakdown"
          subtitle="Proportion of consignments across current operational lifecycle states"
          padding="20px"
        >
          {loading ? (
            <LoadingSpinner message="Calculating status distributions..." size="sm" />
          ) : statusDistribution ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Proportional Segmented Progress Bar */}
              <div
                style={{
                  height: '14px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  overflow: 'hidden',
                  display: 'flex',
                  width: '100%',
                }}
              >
                {statusDistribution.delivered.pct > 0 && (
                  <div
                    style={{
                      width: `${statusDistribution.delivered.pct}%`,
                      backgroundColor: 'var(--status-green)',
                      transition: 'width 0.4s ease',
                    }}
                    title={`Delivered: ${statusDistribution.delivered.count} (${statusDistribution.delivered.pct}%)`}
                  />
                )}
                {statusDistribution.active.pct > 0 && (
                  <div
                    style={{
                      width: `${statusDistribution.active.pct}%`,
                      backgroundColor: 'var(--status-blue)',
                      transition: 'width 0.4s ease',
                    }}
                    title={`Active: ${statusDistribution.active.count} (${statusDistribution.active.pct}%)`}
                  />
                )}
                {statusDistribution.delayed.pct > 0 && (
                  <div
                    style={{
                      width: `${statusDistribution.delayed.pct}%`,
                      backgroundColor: 'var(--status-amber)',
                      transition: 'width 0.4s ease',
                    }}
                    title={`Delayed: ${statusDistribution.delayed.count} (${statusDistribution.delayed.pct}%)`}
                  />
                )}
                {statusDistribution.cancelled.pct > 0 && (
                  <div
                    style={{
                      width: `${statusDistribution.cancelled.pct}%`,
                      backgroundColor: 'var(--status-red)',
                      transition: 'width 0.4s ease',
                    }}
                    title={`Cancelled: ${statusDistribution.cancelled.count} (${statusDistribution.cancelled.pct}%)`}
                  />
                )}
              </div>

              {/* Status Breakdown Legend Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '12px',
                  marginTop: '4px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-green)',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 500 }}>Delivered</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {statusDistribution.delivered.count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({statusDistribution.delivered.pct}%)</span>
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-blue)',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 500 }}>Active</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {statusDistribution.active.count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({statusDistribution.active.pct}%)</span>
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-amber)',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 500 }}>Delayed</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {statusDistribution.delayed.count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({statusDistribution.delayed.pct}%)</span>
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-red)',
                      }}
                    />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontWeight: 500 }}>Cancelled</span>
                  </div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {statusDistribution.cancelled.count} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({statusDistribution.cancelled.pct}%)</span>
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>
              No status records available for distribution calculation.
            </div>
          )}
        </Card>

        {/* Analytics 2: Operational Health Ratios */}
        <Card
          title="Operational Performance Ratios"
          subtitle="Empirical reliability metrics computed directly from database history"
          padding="20px"
        >
          {loading ? (
            <LoadingSpinner message="Evaluating operational ratios..." size="sm" />
          ) : stats && stats.total_orders > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Delivery Completion Rate</span>
                  <span style={{ fontWeight: 600, color: 'var(--status-green)' }}>
                    {((stats.delivered_orders / stats.total_orders) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: 'var(--radius-full)', backgroundColor: 'var(--bg-surface-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (stats.delivered_orders / stats.total_orders) * 100)}%`,
                      backgroundColor: 'var(--status-green)',
                      borderRadius: 'var(--radius-full)',
                    }}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Fulfillment In-Progress Ratio</span>
                  <span style={{ fontWeight: 600, color: 'var(--status-blue)' }}>
                    {((stats.active_orders / stats.total_orders) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: 'var(--radius-full)', backgroundColor: 'var(--bg-surface-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (stats.active_orders / stats.total_orders) * 100)}%`,
                      backgroundColor: 'var(--status-blue)',
                      borderRadius: 'var(--radius-full)',
                    }}
                  />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>Delay Incident Rate</span>
                  <span style={{ fontWeight: 600, color: 'var(--status-amber)' }}>
                    {((stats.delayed_orders / stats.total_orders) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: 'var(--radius-full)', backgroundColor: 'var(--bg-surface-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, (stats.delayed_orders / stats.total_orders) * 100)}%`,
                      backgroundColor: 'var(--status-amber)',
                      borderRadius: 'var(--radius-full)',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginTop: '4px', padding: '10px 12px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-surface-subtle)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                ℹ️ Ratios reflect strictly validated events in Azure SQL. No projected estimates or correlations are inferred without formal evidence.
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '24px 0' }}>
              No operational records available for calculation.
            </div>
          )}
        </Card>
      </div>

      {/* E. Attention Required Section */}
      {attentionOrders.length > 0 && (
        <Card
          title="Attention Required — Operational Exceptions"
          subtitle="Consignments experiencing active delay cases, abnormal variance, or exceptions"
          style={{
            borderLeft: '4px solid var(--status-amber)',
          }}
          action={
            <Badge
              label={`${attentionOrders.length} Exceptions`}
              variant="warning"
              size="sm"
            />
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {attentionOrders.map((order) => (
              <div
                key={order.order_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-color)',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Badge
                    label={order.status}
                    variant={getStatusBadgeVariant(order.status)}
                    dot
                    size="sm"
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.875rem' }}>
                      {order.external_order_ref}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {order.seller_business_name ? `${order.seller_business_name} • ` : ''}
                      Expected {order.expected_delivery_at ? new Date(order.expected_delivery_at).toLocaleDateString() : 'N/A'}
                      {order.active_case_id ? ` • Active Case #${order.active_case_id}` : ''}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onNavigate('timeline', { orderId: order.order_id })}
                  >
                    View Timeline
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      onNavigate('delay-analysis', {
                        orderId: order.order_id,
                        caseId: order.active_case_id ?? undefined,
                      })
                    }
                  >
                    Investigate Delay
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* D. Recent Activity Section */}
      <Card
        title="Recent Order Activity"
        subtitle="Chronological feed of recently ingested consignments and status telemetry"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('orders')}
            aria-label="View all orders"
          >
            View All &rarr;
          </Button>
        }
      >
        {loading ? (
          <LoadingSpinner message="Querying live order repository..." />
        ) : recentOrders.length > 0 ? (
          <Table
            columns={recentColumns}
            data={recentOrders}
            keyExtractor={(o) => o.order_id}
            emptyMessage="No order records in database yet."
            onRowClick={(row) => onNavigate('orders', { orderId: row.order_id })}
          />
        ) : (
          <EmptyState
            title="No Orders Found"
            description="The order repository currently has no records or backend database connectivity is initializing."
            actionLabel="Refresh Data"
            onAction={loadData}
          />
        )}
      </Card>

      {/* Causara Epistemological Integrity Notice */}
      <Card
        style={{
          backgroundColor: 'var(--bg-surface-subtle)',
          border: '1px solid var(--border-color)',
        }}
        padding="18px 20px"
      >
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.35rem', lineHeight: 1 }}>⚖️</span>
          <div>
            <h4
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-main)',
                marginBottom: '4px',
              }}
            >
              Causara Epistemological Integrity Standard
            </h4>
            <p
              style={{
                fontSize: '0.785rem',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Causara enforces strict separation between empirical facts, variance observations, and counterfactual hypotheses.
              Correlation is never presented as proven causation. Every delay finding is backed by immutable timestamps,
              verifiable stage transitions, and traceable intervention records.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
