import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
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
      setRecentOrders(ordersRes.orders);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const columns: Column<Order>[] = [
    {
      key: 'external_order_ref',
      header: 'Order Reference',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
            {row.external_order_ref}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ID #{row.order_id}
          </div>
        </div>
      ),
    },
    {
      key: 'seller',
      header: 'Seller',
      render: (row) => row.seller_business_name || `Seller #${row.seller_id}`,
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => row.customer_name || `Customer #${row.customer_user_id}`,
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
      render: (row) => new Date(row.expected_delivery_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate('timeline', { orderId: row.order_id })}
          >
            Timeline
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onNavigate('delay-analysis', { orderId: row.order_id })}
          >
            Delay Analysis
          </Button>
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
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>
            Logistics Overview
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Real-time fulfillment metrics derived strictly from active database records.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" onClick={loadData} loading={loading}>
            Refresh
          </Button>
          <Button variant="primary" onClick={() => onNavigate('orders')}>
            Manage Orders
          </Button>
        </div>
      </div>

      {error && (
        <Alert type="error" title="Data Retrieval Error">
          {error}
        </Alert>
      )}

      {/* KPI Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '28px',
        }}
      >
        <Card padding="18px">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Total Orders
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '8px' }}>
            {loading ? '—' : stats?.total_orders ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Ingested order records
          </div>
        </Card>

        <Card padding="18px">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--status-blue)', textTransform: 'uppercase' }}>
            Active Fulfillment
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--status-blue)', marginTop: '8px' }}>
            {loading ? '—' : stats?.active_orders ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            In-progress or in-transit
          </div>
        </Card>

        <Card padding="18px">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--status-green)', textTransform: 'uppercase' }}>
            Delivered Orders
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '8px' }}>
            {loading ? '—' : stats?.delivered_orders ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Verified deliveries
          </div>
        </Card>

        <Card padding="18px">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--status-amber)', textTransform: 'uppercase' }}>
            Active Investigations
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--status-amber)', marginTop: '8px' }}>
            {loading ? '—' : stats?.open_cases_count ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {stats?.open_cases_count ?? 0} open cases • {stats?.delayed_orders ?? 0} delayed
          </div>
        </Card>

        <Card padding="18px">
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--status-red)', textTransform: 'uppercase' }}>
            Cancelled Orders
          </div>
          <div style={{ fontSize: '1.85rem', fontWeight: 700, color: 'var(--status-red)', marginTop: '8px' }}>
            {loading ? '—' : stats?.cancelled_orders ?? 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Pre-dispatch or transit exceptions
          </div>
        </Card>
      </div>

      {/* Recent Orders Section */}
      <Card
        title="Recent Order Activity"
        subtitle="Chronological feed of recently ingested consignments"
        action={
          <Button variant="ghost" size="sm" onClick={() => onNavigate('orders')}>
            View All &rarr;
          </Button>
        }
      >
        {loading ? (
          <LoadingSpinner message="Querying live order repository..." />
        ) : (
          <Table
            columns={columns}
            data={recentOrders}
            keyExtractor={(o) => o.order_id}
            emptyMessage="No order records in database yet."
            onRowClick={(row) => onNavigate('orders', { orderId: row.order_id })}
          />
        )}
      </Card>

      {/* Causara Domain Integrity Notice */}
      <div style={{ marginTop: '24px' }}>
        <Card style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.5rem' }}>⚖️</span>
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                Causara Epistemological Integrity Notice
              </h4>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Causara distinguishes between arithmetic duration variance and causal blame.
                Correlation is never presented as proven causation. Every delay finding is backed by
                immutable events, verifiable timeline sequences, and transparent counterfactual scenarios.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
