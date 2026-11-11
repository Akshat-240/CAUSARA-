import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { Modal } from '../components/common/Modal';
import { EvidenceItem, Order, DemoActor } from '../types/api';
import { fetchOrders, fetchEvidence, uploadEvidenceFile } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface EvidencePageProps {
  initialOrderId?: number;
  activeActor: DemoActor | null;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const EvidencePage: React.FC<EvidencePageProps> = ({
  initialOrderId,
  activeActor,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Upload Modal State
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Detail Modal State (inspect hash / metadata)
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);

  useEffect(() => {
    async function loadOrdersList() {
      try {
        const res = await fetchOrders({ limit: 50 });
        setOrders(res.orders);
        if (!selectedOrderId && res.orders.length > 0) {
          setSelectedOrderId(res.orders[0].order_id);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      }
    }
    loadOrdersList();
  }, []);

  useEffect(() => {
    if (initialOrderId) {
      setSelectedOrderId(initialOrderId);
    }
  }, [initialOrderId]);

  const loadEvidence = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchEvidence(orderId);
      setEvidenceList(items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch evidence');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadEvidence(selectedOrderId);
    }
  }, [selectedOrderId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) {
      setUploadError('Please select an order first.');
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
    try {
      await uploadEvidenceFile(selectedOrderId, uploadFile, activeActor.id);
      setIsUploadModalOpen(false);
      setUploadFile(null);
      await loadEvidence(selectedOrderId);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const columns: Column<EvidenceItem>[] = [
    {
      key: 'evidence_id',
      header: 'ID',
      width: '60px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          #{row.evidence_id}
        </span>
      ),
    },
    {
      key: 'file_name',
      header: 'File Name',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
            {row.file_name}
          </span>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {row.content_type}
          </div>
        </div>
      ),
    },
    {
      key: 'sha256_hash',
      header: 'SHA-256 Digest',
      render: (row) => (
        <code
          style={{
            fontFamily: 'monospace',
            fontSize: '0.72rem',
            backgroundColor: '#f1f5f9',
            padding: '2px 6px',
            borderRadius: '4px',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          title={row.sha256_hash || 'No hash recorded'}
          onClick={() => setSelectedEvidence(row)}
        >
          {row.sha256_hash ? `${row.sha256_hash.slice(0, 16)}...` : 'Pending'}
        </code>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => {
        let variant: 'success' | 'warning' | 'neutral' = 'success';
        if (row.status === 'PENDING_UPLOAD') variant = 'warning';
        if (row.status === 'ARCHIVED') variant = 'neutral';
        return <Badge label={row.status} variant={variant} size="sm" />;
      },
    },
    {
      key: 'uploaded_at',
      header: 'Uploaded At',
      render: (row) =>
        row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : '—',
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setSelectedEvidence(row)}
        >
          Inspect Integrity
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
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-main)' }}>
            Corroborating Evidence
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Cryptographically verified artifacts (PODs, dispatch receipts, exception logs) corroborating delay claims.
          </p>
        </div>

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
                {o.external_order_ref} (#{o.order_id})
              </option>
            ))}
          </select>

          <Button
            variant="primary"
            onClick={() => setIsUploadModalOpen(true)}
            disabled={!selectedOrderId}
          >
            + Upload Evidence
          </Button>
        </div>
      </div>

      <Alert type="info" style={{ marginBottom: '20px' }}>
        <strong>Integrity Assurance:</strong> Every evidence item is hashed using SHA-256 upon upload.
        Causara links evidence to specific order events or delay cases to substantiate root-cause hypotheses.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {loading ? (
        <LoadingSpinner message="Loading evidence repository..." />
      ) : (
        <Card
          title={`Evidence Repository (${evidenceList.length} files)`}
          subtitle={`Verified records attached to Order #${selectedOrderId}`}
        >
          <Table
            columns={columns}
            data={evidenceList}
            keyExtractor={(e) => e.evidence_id}
            emptyMessage="No evidence files uploaded for this order yet."
          />
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
                Target Order
              </label>
              <input
                type="text"
                value={`Order #${selectedOrderId}`}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  backgroundColor: '#f1f5f9',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              />
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
                Uploading Actor
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
                  backgroundColor: '#f1f5f9',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}
              />
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
                Select File (PDF, PNG, JPG, TXT up to 10MB) *
              </label>
              <input
                type="file"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setUploadFile(e.target.files[0]);
                  }
                }}
                accept=".pdf,.png,.jpg,.jpeg,.txt,.log,.json"
                required
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                }}
              />
              {uploadFile && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Size: {(uploadFile.size / 1024).toFixed(1)} KB • Type: {uploadFile.type || 'plain'}
                </div>
              )}
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
            <div
              style={{
                padding: '12px',
                backgroundColor: '#f8fafc',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cryptographic Hash (SHA-256)</div>
              <code
                style={{
                  display: 'block',
                  marginTop: '6px',
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  wordBreak: 'break-all',
                  backgroundColor: '#ffffff',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  color: '#0f172a',
                }}
              >
                {selectedEvidence.sha256_hash || 'Hash pending computation'}
              </code>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Evidence ID</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>#{selectedEvidence.evidence_id}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Order ID</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>#{selectedEvidence.order_id}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Content Type</div>
                <div style={{ fontSize: '0.85rem' }}>{selectedEvidence.content_type}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Status</div>
                <div style={{ marginTop: '2px' }}>
                  <Badge label={selectedEvidence.status} variant="success" size="sm" />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Uploaded By User</div>
                <div style={{ fontSize: '0.85rem' }}>User #{selectedEvidence.uploaded_by}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Uploaded At</div>
                <div style={{ fontSize: '0.85rem' }}>
                  {selectedEvidence.uploaded_at ? new Date(selectedEvidence.uploaded_at).toLocaleString() : '—'}
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Storage URI</div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-light)',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  marginTop: '4px',
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
