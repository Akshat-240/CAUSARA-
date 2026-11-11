import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { Modal } from '../components/common/Modal';
import { Order, OrderStage, CreateOrderPayload, Seller, User } from '../types/api';
import {
  fetchOrders,
  fetchOrder,
  fetchOrderStages,
  createOrder,
  fetchSellers,
  fetchUsers,
} from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface OrdersPageProps {
  initialOrderId?: number;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

const STATUS_FILTERS = [
  'ALL',
  'PROCESSING',
  'IN_TRANSIT',
  'DISPATCHED',
  'DELIVERED',
  'DELAYED',
  'CANCELLED',
  'PLACED',
];

export const OrdersPage: React.FC<OrdersPageProps> = ({ initialOrderId, onNavigate }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Order Detail
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedStages, setSelectedStages] = useState<OrderStage[]>([]);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);

  // Create Order Modal State & Reference Data
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [createLoading, setCreateLoading] = useState<boolean>(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [availableSellers, setAvailableSellers] = useState<Seller[]>([]);
  const [availableCustomers, setAvailableCustomers] = useState<User[]>([]);
  const [formData, setFormData] = useState<{
    seller_id: string;
    customer_user_id: string;
    external_order_ref: string;
    expected_delivery_days: string;
  }>({
    seller_id: '',
    customer_user_id: '',
    external_order_ref: '',
    expected_delivery_days: '3',
  });

  const loadOrders = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOrders({ status: statusFilter, limit: 50 });
      setOrders(res.orders);
      setTotal(res.total);

      // If initialOrderId was passed, select it
      if (initialOrderId && !selectedOrder) {
        selectOrderById(initialOrderId);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orders.');
    } finally {
      setLoading(false);
    }
  };

  const selectOrderById = async (orderId: number) => {
    setDetailLoading(true);
    try {
      const [ord, stages] = await Promise.all([
        fetchOrder(orderId),
        fetchOrderStages(orderId),
      ]);
      setSelectedOrder(ord);
      setSelectedStages(stages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load order details.');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, [statusFilter]);

  // Load reference sellers and customer users when modal opens
  const handleOpenCreateModal = async () => {
    setIsCreateModalOpen(true);
    setCreateError(null);
    try {
      const [sellersList, customersList] = await Promise.all([
        fetchSellers(),
        fetchUsers({ role: 'CUSTOMER' }),
      ]);
      setAvailableSellers(sellersList);
      setAvailableCustomers(customersList);

      setFormData({
        seller_id: sellersList.length > 0 ? sellersList[0].seller_id.toString() : '',
        customer_user_id: customersList.length > 0 ? customersList[0].user_id.toString() : '',
        external_order_ref: `ORD-${Date.now().toString().slice(-6)}`,
        expected_delivery_days: '3',
      });
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to load sellers or customers');
    }
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.seller_id) {
      setCreateError('Please select a registered seller.');
      return;
    }
    if (!formData.customer_user_id) {
      setCreateError('Please select a customer user.');
      return;
    }
    if (!formData.external_order_ref.trim()) {
      setCreateError('External order reference is required.');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    const now = new Date();
    const days = parseInt(formData.expected_delivery_days, 10) || 3;
    const delivery = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const payload: CreateOrderPayload = {
      seller_id: parseInt(formData.seller_id, 10),
      customer_user_id: parseInt(formData.customer_user_id, 10),
      external_order_ref: formData.external_order_ref.trim(),
      placed_at: now.toISOString(),
      expected_delivery_at: delivery.toISOString(),
    };

    try {
      const newOrder = await createOrder(payload);
      setIsCreateModalOpen(false);
      await loadOrders();
      selectOrderById(newOrder.order_id);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create order.');
    } finally {
      setCreateLoading(false);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.external_order_ref.toLowerCase().includes(q) ||
      (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
      (o.seller_business_name && o.seller_business_name.toLowerCase().includes(q)) ||
      o.order_id.toString().includes(q)
    );
  });

  const orderColumns: Column<Order>[] = [
    {
      key: 'external_order_ref',
      header: 'Reference',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
            {row.external_order_ref}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            #{row.order_id}
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
      render: (row) => row.customer_name || `User #${row.customer_user_id}`,
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
      key: 'placed_at',
      header: 'Placed At',
      render: (row) => new Date(row.placed_at).toLocaleDateString(),
    },
    {
      key: 'expected_delivery_at',
      header: 'Expected Delivery',
      render: (row) => new Date(row.expected_delivery_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={selectedOrder?.order_id === row.order_id ? 'primary' : 'outline'}
          onClick={(e) => {
            e.stopPropagation();
            selectOrderById(row.order_id);
          }}
        >
          {selectedOrder?.order_id === row.order_id ? 'Viewing' : 'Details'}
        </Button>
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
            Order Management
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Consignment catalog with baseline schedules, stage progressions, and delivery commitments.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={handleOpenCreateModal}
        >
          + New Order
        </Button>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {/* Filter and Search Bar */}
      <Card padding="16px" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)',
                  border: statusFilter === s ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                  backgroundColor: statusFilter === s ? 'var(--primary-light)' : '#ffffff',
                  color: statusFilter === s ? 'var(--primary)' : 'var(--text-muted)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.1s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {s}
              </button>
            ))}
          </div>

          <div style={{ width: '280px' }}>
            <input
              type="text"
              placeholder="Search reference, customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 14px',
                fontSize: '0.85rem',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                outline: 'none',
              }}
            />
          </div>
        </div>
      </Card>

      {/* Main Grid: Orders List & Detail Card */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedOrder ? '1fr 1fr' : '1fr',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        <div>
          <Card
            title={`Orders (${filteredOrders.length}${total > filteredOrders.length ? ` of ${total}` : ''})`}
            subtitle="Click an order row to view operational stage breakdown"
          >
            {loading ? (
              <LoadingSpinner message="Retrieving orders from SQL Server..." />
            ) : (
              <Table
                columns={orderColumns}
                data={filteredOrders}
                keyExtractor={(o) => o.order_id}
                emptyMessage="No orders matching filter criteria."
                onRowClick={(row) => selectOrderById(row.order_id)}
              />
            )}
          </Card>
        </div>

        {/* Selected Order Detail Panel */}
        {selectedOrder && (
          <div>
            <Card
              title={`Order: ${selectedOrder.external_order_ref}`}
              subtitle={`ID #${selectedOrder.order_id} • Placed ${new Date(selectedOrder.placed_at).toLocaleDateString()}`}
              action={
                <Button size="sm" variant="ghost" onClick={() => setSelectedOrder(null)}>
                  Close &times;
                </Button>
              }
            >
              {detailLoading ? (
                <LoadingSpinner message="Loading stages..." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Status Banner */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px',
                      backgroundColor: '#f8fafc',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</div>
                      <div style={{ marginTop: '4px' }}>
                        <Badge
                          label={selectedOrder.status}
                          variant={getStatusBadgeVariant(selectedOrder.status)}
                          dot
                        />
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Expected Delivery</div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>
                        {new Date(selectedOrder.expected_delivery_at).toLocaleString()}
                      </div>
                    </div>

                    {selectedOrder.actual_delivery_at && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Actual Delivery</div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--status-green)', marginTop: '4px' }}>
                          {new Date(selectedOrder.actual_delivery_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stage Progression Cards */}
                  <div>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-main)' }}>
                      Planned vs. Observed Operational Stages
                    </h4>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {selectedStages.map((s) => (
                        <div
                          key={s.stage_id}
                          style={{
                            padding: '12px 14px',
                            backgroundColor: '#ffffff',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 600 }}>
                                #{s.sequence_no}
                              </span>
                              <strong style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                {s.stage_code}
                              </strong>
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                              Planned: {s.planned_start_at ? new Date(s.planned_start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'} &rarr;{' '}
                              {s.planned_end_at ? new Date(s.planned_end_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                            </div>
                          </div>

                          <Badge
                            label={s.status}
                            variant={getStatusBadgeVariant(s.status)}
                            size="sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Context Actions */}
                  <div style={{ display: 'flex', gap: '10px', paddingTop: '8px', borderTop: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                    <Button
                      variant="primary"
                      onClick={() => onNavigate('timeline', { orderId: selectedOrder.order_id })}
                    >
                      View Timeline
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => onNavigate('delay-analysis', { orderId: selectedOrder.order_id })}
                    >
                      Run Delay Analysis
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => onNavigate('evidence', { orderId: selectedOrder.order_id })}
                    >
                      Evidence Files
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* Create Order Modal dynamically backed by real sellers and customers */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Order"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)} disabled={createLoading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateOrder}
              loading={createLoading}
              disabled={availableSellers.length === 0 || availableCustomers.length === 0}
            >
              Create Order
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateOrder}>
          {createError && <Alert type="error">{createError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                External Order Reference *
              </label>
              <input
                type="text"
                value={formData.external_order_ref}
                onChange={(e) => setFormData({ ...formData, external_order_ref: e.target.value })}
                placeholder="e.g. ORD-2026-9921"
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Registered Seller *
                </label>
                <select
                  value={formData.seller_id}
                  onChange={(e) => setFormData({ ...formData, seller_id: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                    backgroundColor: '#ffffff',
                  }}
                >
                  {availableSellers.length === 0 ? (
                    <option value="">Loading sellers...</option>
                  ) : (
                    availableSellers.map((s) => (
                      <option key={s.seller_id} value={s.seller_id}>
                        {s.business_name} (#{s.seller_id})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                  Customer User *
                </label>
                <select
                  value={formData.customer_user_id}
                  onChange={(e) => setFormData({ ...formData, customer_user_id: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                    backgroundColor: '#ffffff',
                  }}
                >
                  {availableCustomers.length === 0 ? (
                    <option value="">Loading customers...</option>
                  ) : (
                    availableCustomers.map((c) => (
                      <option key={c.user_id} value={c.user_id}>
                        {c.full_name} ({c.email})
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                Delivery SLA Window (Days from now)
              </label>
              <select
                value={formData.expected_delivery_days}
                onChange={(e) => setFormData({ ...formData, expected_delivery_days: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value="1">1 Day (Express)</option>
                <option value="2">2 Days (Standard Fast)</option>
                <option value="3">3 Days (Default SLA)</option>
                <option value="5">5 Days (Economy)</option>
              </select>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Causara automatically calculates 5 proportional baseline stages based on the selected SLA window.
              </p>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
