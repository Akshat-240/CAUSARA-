import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
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
  'PLACED',
  'PROCESSING',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'DELAYED',
  'CANCELLED',
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
      setOrders(res.orders || []);
      setTotal(res.total || 0);

      // If initialOrderId was passed, select it
      if (initialOrderId && !selectedOrder) {
        selectOrderById(initialOrderId);
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to fetch orders.';
      // Sanitize database firewall/connection errors
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

  const selectOrderById = async (orderId: number) => {
    setDetailLoading(true);
    try {
      const [ord, stages] = await Promise.all([
        fetchOrder(orderId),
        fetchOrderStages(orderId),
      ]);
      setSelectedOrder(ord);
      setSelectedStages(stages || []);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to load order details.';
      if (rawMsg.includes('Cannot open server') || rawMsg.includes('firewall')) {
        setError('Database connection error while retrieving order details.');
      } else {
        setError(rawMsg);
      }
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

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase().trim();
    return orders.filter((o) => {
      return (
        o.external_order_ref.toLowerCase().includes(q) ||
        (o.customer_name && o.customer_name.toLowerCase().includes(q)) ||
        (o.seller_business_name && o.seller_business_name.toLowerCase().includes(q)) ||
        o.order_id.toString().includes(q)
      );
    });
  }, [orders, searchQuery]);

  const hasActiveFilters = statusFilter !== 'ALL' || searchQuery.trim().length > 0;

  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setSearchQuery('');
  };

  const formatShortDate = (dateStr: string) => {
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

  const formatDateTime = (dateStr: string | null | undefined) => {
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

  const orderColumns: Column<Order>[] = [
    {
      key: 'external_order_ref',
      header: 'Reference',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--primary)' }}>
            {row.external_order_ref}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            ID #{row.order_id}
          </div>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => (
        <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
          {row.customer_name || `Customer #${row.customer_user_id}`}
        </span>
      ),
    },
    {
      key: 'seller',
      header: 'Seller',
      render: (row) => (
        <span style={{ color: 'var(--text-muted)' }}>
          {row.seller_business_name || `Seller #${row.seller_id}`}
        </span>
      ),
    },
    {
      key: 'placed_at',
      header: 'Placed Date',
      render: (row) => (
        <span style={{ color: 'var(--text-muted)' }}>
          {formatShortDate(row.placed_at)}
        </span>
      ),
    },
    {
      key: 'expected_delivery_at',
      header: 'Expected Delivery',
      render: (row) => {
        const isPastDue =
          row.status !== 'DELIVERED' &&
          row.status !== 'CANCELLED' &&
          new Date(row.expected_delivery_at).getTime() < Date.now();
        return (
          <div>
            <span
              style={{
                color: isPastDue ? 'var(--status-amber)' : 'var(--text-main)',
                fontWeight: isPastDue ? 600 : 400,
              }}
            >
              {formatShortDate(row.expected_delivery_at)}
            </span>
            {isPastDue && (
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: '6px',
                  fontSize: '0.7rem',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  backgroundColor: 'var(--status-amber-bg)',
                  color: 'var(--status-amber)',
                  fontWeight: 600,
                }}
              >
                Overdue
              </span>
            )}
          </div>
        );
      },
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
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant={selectedOrder?.order_id === row.order_id ? 'primary' : 'outline'}
          onClick={(e) => {
            e.stopPropagation();
            if (selectedOrder?.order_id === row.order_id) {
              setSelectedOrder(null);
            } else {
              selectOrderById(row.order_id);
            }
          }}
        >
          {selectedOrder?.order_id === row.order_id ? 'Viewing' : 'Details'}
        </Button>
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
          <h2
            style={{
              fontSize: '1.625rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Orders
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '6px',
              marginBottom: 0,
            }}
          >
            Consignment catalog with baseline schedules, stage progressions, and delivery commitments.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Button
            variant="outline"
            onClick={loadOrders}
            disabled={loading}
            title="Reload orders from database"
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={handleOpenCreateModal}
          >
            + New Order
          </Button>
        </div>
      </div>

      {error && <Alert type="error">{error}</Alert>}

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
            {STATUS_FILTERS.map((s) => {
              const isActive = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
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
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = 'var(--secondary)';
                      e.currentTarget.style.color = 'var(--text-main)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }
                  }}
                >
                  {s === 'ALL' ? 'All Orders' : s.replace('_', ' ')}
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
                placeholder="Search reference, customer, seller..."
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
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.boxShadow = 'var(--focus-ring)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.boxShadow = 'none';
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

      {/* Main Grid: Orders Table & Selected Order Detail Drawer */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: selectedOrder
            ? 'minmax(0, 1.4fr) minmax(360px, 1fr)'
            : '1fr',
          gap: '24px',
          alignItems: 'start',
        }}
      >
        {/* Table Container */}
        <div>
          <Card
            title={`Orders (${filteredOrders.length}${total > filteredOrders.length ? ` of ${total}` : ''})`}
            subtitle="Click an order row or select Details to inspect operational stage progression"
          >
            {loading ? (
              <LoadingSpinner message="Retrieving orders from SQL Server..." />
            ) : filteredOrders.length === 0 ? (
              <EmptyState
                title="No orders found"
                description={
                  hasActiveFilters
                    ? 'No orders match your current filter and search criteria.'
                    : 'No orders have been recorded in the platform catalog yet.'
                }
                actionLabel={hasActiveFilters ? 'Clear Filters' : '+ Create Order'}
                onAction={hasActiveFilters ? handleClearFilters : handleOpenCreateModal}
              />
            ) : (
              <Table
                columns={orderColumns}
                data={filteredOrders}
                keyExtractor={(o) => o.order_id}
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
              subtitle={`Internal ID #${selectedOrder.order_id} • Placed ${formatShortDate(selectedOrder.placed_at)}`}
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedOrder(null)}
                  title="Close details panel"
                >
                  Close &times;
                </Button>
              }
            >
              {detailLoading ? (
                <LoadingSpinner message="Loading stage progression..." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {/* Status & Delivery Summary Banner */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '12px',
                      padding: '16px',
                      backgroundColor: 'var(--bg-surface-subtle)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</div>
                      <div style={{ marginTop: '6px' }}>
                        <Badge
                          label={selectedOrder.status}
                          variant={getStatusBadgeVariant(selectedOrder.status)}
                          dot
                        />
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Expected Delivery</div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: 'var(--text-main)',
                          marginTop: '6px',
                        }}
                      >
                        {formatDateTime(selectedOrder.expected_delivery_at)}
                      </div>
                    </div>

                    {selectedOrder.actual_delivery_at && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Actual Delivery</div>
                        <div
                          style={{
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            color: 'var(--status-green)',
                            marginTop: '6px',
                          }}
                        >
                          {formatDateTime(selectedOrder.actual_delivery_at)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Customer and Seller Attribution */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '12px',
                      padding: '12px 14px',
                      backgroundColor: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        Customer
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        {selectedOrder.customer_name || `User #${selectedOrder.customer_user_id}`}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
                        Seller
                      </div>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        {selectedOrder.seller_business_name || `Seller #${selectedOrder.seller_id}`}
                      </div>
                    </div>
                  </div>

                  {/* Stage Progression Cards */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '10px',
                      }}
                    >
                      <h4
                        style={{
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          color: 'var(--text-main)',
                          margin: 0,
                        }}
                      >
                        Planned vs. Observed Operational Stages
                      </h4>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {selectedStages.length} Stages
                      </span>
                    </div>

                    {selectedStages.length === 0 ? (
                      <div
                        style={{
                          padding: '20px',
                          textAlign: 'center',
                          fontSize: '0.85rem',
                          color: 'var(--text-muted)',
                          backgroundColor: 'var(--bg-surface-subtle)',
                          borderRadius: 'var(--radius-md)',
                          border: '1px dashed var(--border-color)',
                        }}
                      >
                        No operational stages recorded for this consignment.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {selectedStages.map((s) => (
                          <div
                            key={s.stage_id}
                            style={{
                              padding: '12px 14px',
                              backgroundColor: 'var(--bg-surface)',
                              borderRadius: 'var(--radius-md)',
                              border: '1px solid var(--border-color)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              transition: 'border-color 0.15s ease',
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span
                                  style={{
                                    fontSize: '0.75rem',
                                    color: 'var(--primary)',
                                    fontWeight: 700,
                                    backgroundColor: 'var(--primary-subtle)',
                                    padding: '1px 6px',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  #{s.sequence_no}
                                </span>
                                <strong
                                  style={{
                                    fontSize: '0.85rem',
                                    color: 'var(--text-main)',
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  {s.stage_code}
                                </strong>
                              </div>

                              <div
                                style={{
                                  fontSize: '0.75rem',
                                  color: 'var(--text-muted)',
                                  marginTop: '4px',
                                }}
                              >
                                <span>
                                  Planned: {formatDateTime(s.planned_start_at)} &rarr;{' '}
                                  {formatDateTime(s.planned_end_at)}
                                </span>
                                {s.actual_end_at && (
                                  <div style={{ color: 'var(--status-green)', marginTop: '2px' }}>
                                    Completed: {formatDateTime(s.actual_end_at)}
                                  </div>
                                )}
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
                    )}
                  </div>

                  {/* Context Actions */}
                  <div
                    style={{
                      display: 'flex',
                      gap: '10px',
                      paddingTop: '16px',
                      borderTop: '1px solid var(--border-color)',
                      flexWrap: 'wrap',
                    }}
                  >
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

      {/* Create Order Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Order"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={createLoading}
            >
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
              <label
                htmlFor="external_order_ref"
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                External Order Reference *
              </label>
              <input
                id="external_order_ref"
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
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label
                  htmlFor="seller_id"
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '6px',
                  }}
                >
                  Registered Seller *
                </label>
                <select
                  id="seller_id"
                  value={formData.seller_id}
                  onChange={(e) => setFormData({ ...formData, seller_id: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    outline: 'none',
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
                <label
                  htmlFor="customer_user_id"
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '6px',
                  }}
                >
                  Customer User *
                </label>
                <select
                  id="customer_user_id"
                  value={formData.customer_user_id}
                  onChange={(e) => setFormData({ ...formData, customer_user_id: e.target.value })}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.875rem',
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--text-main)',
                    outline: 'none',
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
              <label
                htmlFor="expected_delivery_days"
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                Delivery SLA Window (Days from now)
              </label>
              <select
                id="expected_delivery_days"
                value={formData.expected_delivery_days}
                onChange={(e) => setFormData({ ...formData, expected_delivery_days: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.875rem',
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-main)',
                  outline: 'none',
                }}
              >
                <option value="1">1 Day (Express)</option>
                <option value="2">2 Days (Standard Fast)</option>
                <option value="3">3 Days (Default SLA)</option>
                <option value="5">5 Days (Economy)</option>
              </select>
              <p
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginTop: '6px',
                  marginBottom: 0,
                }}
              >
                Causara automatically calculates 5 proportional baseline stages based on the selected SLA window.
              </p>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
