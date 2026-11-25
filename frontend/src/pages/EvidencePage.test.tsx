import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvidencePage } from './EvidencePage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, EvidenceItem, DemoActor } from '../types/api';

describe('EvidencePage Component', () => {
  const mockNavigate = vi.fn();

  const mockActor: DemoActor = {
    id: 1,
    name: 'Elena Rostova',
    email: 'elena@causara.com',
    role: 'MANAGER',
    label: 'Elena Rostova (Operations Manager)',
  };

  const mockOrders: Order[] = [
    {
      order_id: 101,
      external_order_ref: 'ORD-2026-001',
      seller_id: 1,
      customer_user_id: 2,
      status: 'PROCESSING',
      placed_at: '2026-11-20T10:00:00Z',
      expected_delivery_at: '2026-11-25T10:00:00Z',
      actual_delivery_at: null,
      created_at: '2026-11-20T10:00:00Z',
      seller_business_name: 'Apex Retail Co.',
      customer_name: 'Elena Rostova',
      active_case_id: null,
    },
    {
      order_id: 102,
      external_order_ref: 'ORD-2026-002',
      seller_id: 2,
      customer_user_id: 3,
      status: 'DELIVERED',
      placed_at: '2026-11-18T08:00:00Z',
      expected_delivery_at: '2026-11-21T18:00:00Z',
      actual_delivery_at: '2026-11-21T16:30:00Z',
      created_at: '2026-11-18T08:00:00Z',
      seller_business_name: 'Nordic Logistics',
      customer_name: 'Marcus Vance',
      active_case_id: null,
    },
  ];

  const mockEvidenceList: EvidenceItem[] = [
    {
      evidence_id: 501,
      order_id: 101,
      event_id: 2,
      case_id: null,
      uploaded_by: 1,
      blob_uri: 'https://causaraevidence.blob.core.windows.net/evidence/dispatch_receipt.pdf',
      file_name: 'dispatch_receipt.pdf',
      content_type: 'application/pdf',
      sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      status: 'ACTIVE',
      uploaded_at: '2026-11-20T14:30:00Z',
      completed_at: '2026-11-20T14:30:05Z',
      upload_expires_at: null,
    },
    {
      evidence_id: 502,
      order_id: 101,
      event_id: 3,
      case_id: 10,
      uploaded_by: 1,
      blob_uri: 'https://causaraevidence.blob.core.windows.net/evidence/warehouse_incident_log.png',
      file_name: 'warehouse_incident_log.png',
      content_type: 'image/png',
      sha256_hash: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      status: 'ACTIVE',
      uploaded_at: '2026-11-21T10:15:00Z',
      completed_at: '2026-11-21T10:15:02Z',
      upload_expires_at: null,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, order selector, and action buttons', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidenceList);

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Evidence Management' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Upload Evidence/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });
  });

  it('displays overview metrics and evidence records table', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidenceList);

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Total Evidence Files')).toBeInTheDocument();
      expect(screen.getByText('Integrity Verified')).toBeInTheDocument();
      expect(screen.getByText('dispatch_receipt.pdf')).toBeInTheDocument();
      expect(screen.getByText('warehouse_incident_log.png')).toBeInTheDocument();
      expect(screen.getByText('Triggered by Event #2')).toBeInTheDocument();
      expect(screen.getByText('Attached to Case #10')).toBeInTheDocument();
    });
  });

  it('filters evidence records with search query input', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidenceList);

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('dispatch_receipt.pdf')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search file name, type, hash/i);
    fireEvent.change(searchInput, { target: { value: 'incident' } });

    expect(screen.queryByText('dispatch_receipt.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('warehouse_incident_log.png')).toBeInTheDocument();
  });

  it('opens and closes the upload evidence modal', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidenceList);

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Upload Evidence/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Upload Evidence/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Upload Corroborating Evidence' })).toBeInTheDocument();
      expect(screen.getByText(/Target Order/i)).toBeInTheDocument();
      expect(screen.getByText(/Submitting Actor/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Upload Corroborating Evidence' })).not.toBeInTheDocument();
    });
  });

  it('opens the evidence integrity modal and displays full SHA-256 digest', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidenceList);

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('dispatch_receipt.pdf')).toBeInTheDocument();
    });

    const inspectButtons = screen.getAllByRole('button', { name: /Inspect/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Evidence Integrity: dispatch_receipt.pdf/i })
      ).toBeInTheDocument();
      expect(screen.getByText('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBeInTheDocument();
      expect(screen.getByText('✓ VERIFIED IMMUTABLE')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Copy Hash/i })).toBeInTheDocument();
    });

    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeButtons[0]);
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: /Evidence Integrity: dispatch_receipt.pdf/i })
      ).not.toBeInTheDocument();
    });
  });

  it('handles sanitized Azure SQL firewall error message', async () => {
    vi.spyOn(api, 'fetchOrders').mockRejectedValueOnce(
      new Error('Cannot open server "causara-sql" requested by the login. Client with IP address is not allowed.')
    );

    render(
      <ThemeProvider>
        <EvidencePage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Database connectivity restricted by firewall rules/i)
      ).toBeInTheDocument();
    });
  });
});
