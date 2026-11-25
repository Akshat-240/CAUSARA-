import React, { useEffect, useState, useMemo } from 'react';
import { Card } from '../components/common/Card';
import { Badge, getStatusBadgeVariant } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { Modal } from '../components/common/Modal';
import { EmptyState } from '../components/common/EmptyState';
import { EvidenceItem, Order, DemoActor } from '../types/api';
import { fetchOrders, fetchOrder, fetchEvidence, uploadEvidenceFile } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface EvidencePageProps {
  initialOrderId?: number;
  activeActor: DemoActor | null;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

const STATUS_FILTERS = ['ALL', 'ACTIVE', 'PENDING_UPLOAD', 'ARCHIVED'];

export const EvidencePage: React.FC<EvidencePageProps> = ({
  initialOrderId,
  activeActor,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);

  // Detail Modal State (inspect hash / metadata)
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);

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

  // Load evidence and order context for selected order
  const loadEvidenceAndOrder = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const [orderRes, evidenceRes] = await Promise.allSettled([
        fetchOrder(orderId),
        fetchEvidence(orderId),
      ]);

      if (orderRes.status === 'fulfilled') {
        setSelectedOrder(orderRes.value);
      } else {
        const found = orders.find((o) => o.order_id === orderId);
        if (found) setSelectedOrder(found);
      }

      if (evidenceRes.status === 'fulfilled') {
        setEvidenceList(evidenceRes.value || []);
      } else {
        throw evidenceRes.reason;
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Failed to fetch evidence';
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
    if (selectedOrderId) {
      loadEvidenceAndOrder(selectedOrderId);
    }
  }, [selectedOrderId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) {
      setUploadError('Please select a target order first.');
      return;
    }
    if (!activeActor) {
      setUploadError('Please select an active operational actor in the header first.');
      return;
    }
    if (!uploadFile) {
      setUploadError('Please select a file to upload.');
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    setUploadSuccessMessage(null);
    try {
      await uploadEvidenceFile(selectedOrderId, uploadFile, activeActor.id);
      setIsUploadModalOpen(false);
      setUploadFile(null);
      setUploadSuccessMessage(`Successfully uploaded and verified ${uploadFile.name}`);
      await loadEvidenceAndOrder(selectedOrderId);
      setTimeout(() => setUploadSuccessMessage(null), 5000);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    try {
      navigator.clipboard.writeText(hash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Fallback
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
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

  // Filtered evidence items
  const filteredEvidence = useMemo(() => {
    return evidenceList.filter((item) => {
      const matchesStatus = statusFilter === 'ALL' || item.status === statusFilter;
      if (!matchesStatus) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.file_name.toLowerCase().includes(q) ||
        item.content_type.toLowerCase().includes(q) ||
        item.evidence_id.toString().includes(q) ||
        (item.sha256_hash && item.sha256_hash.toLowerCase().includes(q))
      );
    });
  }, [evidenceList, statusFilter, searchQuery]);

  const hasActiveFilters = statusFilter !== 'ALL' || searchQuery.trim().length > 0;

  const handleClearFilters = () => {
    setStatusFilter('ALL');
    setSearchQuery('');
  };

  const verifiedCount = useMemo(() => {
    return evidenceList.filter((e) => e.sha256_hash && e.status === 'ACTIVE').length;
  }, [evidenceList]);

  const columns: Column<EvidenceItem>[] = [
    {
      key: 'evidence_id',
      header: 'ID',
      width: '70px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          #{row.evidence_id}
        </span>
      ),
    },
    {
      key: 'file_name',
      header: 'Document & Format',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem', lineHeight: 1 }} aria-hidden="true">
            {row.content_type.includes('pdf') ? '📄' : row.content_type.includes('image') ? '🖼️' : '📎'}
          </span>
          <div>
            <div
              style={{
                fontWeight: 600,
                color: 'var(--primary)',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              onClick={() => setSelectedEvidence(row)}
              title="Click to inspect metadata"
            >
              {row.file_name}
            </div>
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {row.content_type}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'order_association',
      header: 'Association',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>
            Order #{row.order_id}
          </span>
          {row.event_id && (
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Triggered by Event #{row.event_id}
            </div>
          )}
          {row.case_id && (
            <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Attached to Case #{row.case_id}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'sha256_hash',
      header: 'SHA-256 Digest',
      render: (row) => (
        <div>
          {row.sha256_hash ? (
            <code
              style={{
                fontFamily: 'monospace',
                fontSize: '0.725rem',
                backgroundColor: 'var(--bg-surface-subtle)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Click to inspect full digest"
              onClick={() => setSelectedEvidence(row)}
            >
              <span>{row.sha256_hash.slice(0, 14)}...</span>
              <span style={{ color: 'var(--status-green)', fontSize: '0.75rem' }}>✓</span>
            </code>
          ) : (
            <span style={{ fontSize: '0.75rem', color: 'var(--status-amber)' }}>
              Pending Digest
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Integrity Status',
      render: (row) => {
        let variant: 'success' | 'warning' | 'neutral' = 'success';
        if (row.status === 'PENDING_UPLOAD') variant = 'warning';
        if (row.status === 'ARCHIVED') variant = 'neutral';
        return <Badge label={row.status} variant={variant} size="sm" dot />;
      },
    },
    {
      key: 'uploaded_at',
      header: 'Uploaded Timestamp',
      render: (row) => (
        <div style={{ fontSize: '0.8rem' }}>
          <div style={{ color: 'var(--text-main)' }}>
            {formatShortDate(row.uploaded_at)}
          </div>
          <div style={{ color: 'var(--text-light)', fontSize: '0.725rem', marginTop: '2px' }}>
            {formatDateTime(row.uploaded_at)}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedEvidence(row)}
            title="Inspect cryptographic integrity and audit metadata"
          >
            Inspect
          </Button>
          {row.blob_uri && row.blob_uri.startsWith('http') && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(row.blob_uri, '_blank', 'noopener,noreferrer')}
              title="Open artifact storage URI"
            >
              Download
            </Button>
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
            Evidence Management
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
              marginBottom: 0,
            }}
          >
            Cryptographically verified artifacts (PODs, dispatch receipts, exception logs) corroborating operational delay claims.
          </p>
        </div>

        {/* Order Selector and Primary Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <select
            aria-label="Target Order"
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
            onClick={() => selectedOrderId && loadEvidenceAndOrder(selectedOrderId)}
            disabled={loading || !selectedOrderId}
            title="Reload evidence records"
          >
            Refresh
          </Button>

          <Button
            variant="primary"
            onClick={() => setIsUploadModalOpen(true)}
            disabled={!selectedOrderId}
            title="Upload new proof artifact"
          >
            + Upload Evidence
          </Button>
        </div>
      </div>

      {uploadSuccessMessage && (
        <Alert type="success">{uploadSuccessMessage}</Alert>
      )}

      {error && (
        <Alert type="error">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <span>{error}</span>
            {selectedOrderId && (
              <Button size="sm" variant="outline" onClick={() => loadEvidenceAndOrder(selectedOrderId)}>
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
                  : 'In fulfillment pipeline'}
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
                  onClick={() => onNavigate('delay-analysis', { orderId: selectedOrder.order_id })}
                >
                  Delay Analysis &rarr;
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Evidence Overview Metrics Strip */}
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
              Total Evidence Files
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              CATALOG
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
            {evidenceList.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Attached to Order #{selectedOrderId || '—'}
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Integrity Verified
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-green-bg)', color: 'var(--status-green)', fontWeight: 600 }}>
              SHA-256
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--status-green)', marginTop: '6px' }}>
            {verifiedCount}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {evidenceList.length > 0
              ? `${Math.round((verifiedCount / evidenceList.length) * 100)}% verified with hash`
              : 'No artifacts loaded'}
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Active Evidence
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--status-blue-bg)', color: 'var(--status-blue)', fontWeight: 600 }}>
              AUDIT READY
            </span>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '6px' }}>
            {evidenceList.filter((e) => e.status === 'ACTIVE').length}
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Status: ACTIVE corroboration
          </div>
        </Card>

        <Card padding="16px">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Storage Provider
            </span>
            <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-subtle)', color: 'var(--text-muted)', fontWeight: 600 }}>
              SECURITY
            </span>
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '10px' }}>
            Azure Blob Storage
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Tamper-evident hash registry
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
                >
                  {s === 'ALL' ? 'All Files' : s.replace('_', ' ')}
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
                placeholder="Search file name, type, hash..."
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

      {/* Main Evidence Repository Card */}
      {loading ? (
        <LoadingSpinner message="Retrieving corroborated evidence artifacts..." />
      ) : (
        <Card
          title={`Evidence Repository (${filteredEvidence.length}${evidenceList.length > filteredEvidence.length ? ` of ${evidenceList.length}` : ''})`}
          subtitle={`Corroborating documentation registered for Order #${selectedOrderId || '—'}`}
        >
          {filteredEvidence.length === 0 ? (
            <EmptyState
              title={hasActiveFilters ? 'No evidence matches filters' : 'No evidence files found'}
              description={
                hasActiveFilters
                  ? 'No evidence records match your current filter and search query.'
                  : 'No proof artifacts (PODs, scan receipts, incident logs) have been uploaded for this order yet.'
              }
              actionLabel={hasActiveFilters ? 'Clear Filters' : '+ Upload Evidence'}
              onAction={hasActiveFilters ? handleClearFilters : () => setIsUploadModalOpen(true)}
            />
          ) : (
            <Table
              columns={columns}
              data={filteredEvidence}
              keyExtractor={(e) => e.evidence_id}
              emptyMessage="No evidence files uploaded for this order yet."
            />
          )}
        </Card>
      )}

      {/* Upload Modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title="Upload Corroborating Evidence"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsUploadModalOpen(false)}
              disabled={uploadLoading}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              loading={uploadLoading}
              disabled={!uploadFile}
            >
              Upload & Verify SHA-256
            </Button>
          </>
        }
      >
        <form onSubmit={handleUpload}>
          {uploadError && <Alert type="error">{uploadError}</Alert>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label
                  htmlFor="upload_target_order"
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '6px',
                  }}
                >
                  Target Order
                </label>
                <input
                  id="upload_target_order"
                  type="text"
                  value={selectedOrder ? `${selectedOrder.external_order_ref} (#${selectedOrder.order_id})` : `Order #${selectedOrderId}`}
                  disabled
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="upload_actor"
                  style={{
                    display: 'block',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    marginBottom: '6px',
                  }}
                >
                  Submitting Actor
                </label>
                <input
                  id="upload_actor"
                  type="text"
                  value={activeActor ? `${activeActor.name} (${activeActor.role})` : 'Elena Rostova (MANAGER)'}
                  disabled
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="evidence_file_input"
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  marginBottom: '6px',
                }}
              >
                Select Evidence Artifact (PDF, PNG, JPG, TXT up to 10MB) *
              </label>
              <div
                style={{
                  border: '2px dashed var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '24px 16px',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-surface)',
                  cursor: 'pointer',
                }}
                onClick={() => document.getElementById('evidence_file_input')?.click()}
              >
                <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: '8px' }}>📂</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', display: 'block' }}>
                  {uploadFile ? uploadFile.name : 'Click to select or drag and drop artifact'}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                  PDF, PNG, JPG, TXT, LOG, JSON (Max 10MB)
                </span>
              </div>
              <input
                id="evidence_file_input"
                type="file"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setUploadFile(e.target.files[0]);
                  }
                }}
                accept=".pdf,.png,.jpg,.jpeg,.txt,.log,.json"
                style={{ display: 'none' }}
              />
              {uploadFile && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-surface-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.775rem',
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                    {uploadFile.name} ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </span>
                  <button
                    type="button"
                    onClick={() => setUploadFile(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--status-red)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            <div
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                lineHeight: 1.4,
              }}
            >
              🔒 <strong>Tamper-Evident Hashing:</strong> Uploaded artifacts are computed into an immutable SHA-256 cryptographic digest before storage. The hash is anchored to the order audit trail.
            </div>
          </div>
        </form>
      </Modal>

      {/* Evidence Integrity Modal */}
      {selectedEvidence && (
        <Modal
          isOpen={!!selectedEvidence}
          onClose={() => setSelectedEvidence(null)}
          title={`Evidence Integrity: ${selectedEvidence.file_name}`}
          footer={
            <Button variant="primary" onClick={() => setSelectedEvidence(null)}>
              Close
            </Button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Cryptographic SHA-256 Block */}
            <div
              style={{
                padding: '14px',
                backgroundColor: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Cryptographic Hash (SHA-256)
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--status-green)',
                    fontWeight: 600,
                    backgroundColor: 'var(--status-green-bg)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  ✓ VERIFIED IMMUTABLE
                </span>
              </div>
              <code
                style={{
                  display: 'block',
                  marginTop: '8px',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  wordBreak: 'break-all',
                  backgroundColor: 'var(--bg-surface)',
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                }}
              >
                {selectedEvidence.sha256_hash || 'Hash pending computation'}
              </code>
              {selectedEvidence.sha256_hash && (
                <div style={{ marginTop: '8px', textAlign: 'right' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCopyHash(selectedEvidence.sha256_hash!)}
                  >
                    {copiedHash ? '✓ Copied Digest' : 'Copy Hash'}
                  </Button>
                </div>
              )}
            </div>

            {/* Metadata Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '12px',
                padding: '12px 14px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Evidence ID</div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>#{selectedEvidence.evidence_id}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Order ID</div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>#{selectedEvidence.order_id}</div>
              </div>
              {selectedEvidence.event_id && (
                <div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Event ID</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>#{selectedEvidence.event_id}</div>
                </div>
              )}
              {selectedEvidence.case_id && (
                <div>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Case ID</div>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>#{selectedEvidence.case_id}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Content Type</div>
                <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>{selectedEvidence.content_type}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Verification Status</div>
                <div style={{ marginTop: '2px' }}>
                  <Badge label={selectedEvidence.status} variant="success" size="sm" dot />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Uploaded By</div>
                <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>User #{selectedEvidence.uploaded_by}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)' }}>Uploaded At</div>
                <div style={{ fontWeight: 500, color: 'var(--text-main)' }}>
                  {formatDateTime(selectedEvidence.uploaded_at)}
                </div>
              </div>
            </div>

            {/* Sanitized Storage URI */}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Storage Location URI
              </div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  marginTop: '4px',
                  backgroundColor: 'var(--bg-surface-subtle)',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {selectedEvidence.blob_uri}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
