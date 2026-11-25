import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimelinePage } from './TimelinePage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, ReconstructedTimeline, EvidenceItem } from '../types/api';

describe('TimelinePage Component', () => {
  const mockNavigate = vi.fn();

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

  const mockTimeline: ReconstructedTimeline = {
    order_id: 101,
    order_status: 'PROCESSING',
    reconstructed_at: '2026-11-21T14:30:00Z',
    summary: {
      order_id: 101,
      reconstructed_order_status: 'PROCESSING',
      total_events: 3,
      valid_event_count: 3,
      out_of_order_count: 0,
      duplicate_count: 0,
      conflict_count: 0,
      is_complete: true,
      has_anomalies: false,
      warnings: [],
      customer_summary: 'Consignment was packaged on schedule and handed over to carrier.',
    },
    stage_progression: [
      {
        stage_id: 1,
        stage_code: 'ORDER_PLACED',
        sequence_no: 1,
        status: 'COMPLETED',
        planned_start_at: '2026-11-20T10:00:00Z',
        planned_end_at: '2026-11-20T12:00:00Z',
        actual_start_at: '2026-11-20T10:00:00Z',
        actual_end_at: '2026-11-20T11:45:00Z',
        planned_duration_minutes: 120,
        actual_duration_minutes: 105,
        variance_minutes: -15,
        time_lost_minutes: 0,
        time_recovered_minutes: 15,
        event_count: 1,
        event_ids: [1],
        anomalies: [],
      },
      {
        stage_id: 2,
        stage_code: 'WAREHOUSE_PICKING',
        sequence_no: 2,
        status: 'IN_PROGRESS',
        planned_start_at: '2026-11-20T12:00:00Z',
        planned_end_at: '2026-11-21T12:00:00Z',
        actual_start_at: '2026-11-20T12:05:00Z',
        actual_end_at: null,
        planned_duration_minutes: 1440,
        actual_duration_minutes: 1500,
        variance_minutes: 60,
        time_lost_minutes: 60,
        time_recovered_minutes: 0,
        event_count: 2,
        event_ids: [2, 3],
        anomalies: ['PICKING_HOLD_DELAY'],
      },
    ],
    timeline: [
      {
        event_id: 1,
        order_id: 101,
        stage_id: 1,
        stage_code: 'ORDER_PLACED',
        event_type: 'ORDER_CREATED',
        occurred_at: '2026-11-20T10:00:00Z',
        received_at: '2026-11-20T10:00:02Z',
        source_type: 'ECOMMERCE_CHECKOUT',
        source_provider: 'Shopify Gateway',
        idempotency_key: 'evt-001',
        description: 'Customer submitted payment and placed consignment.',
        sequence_position: 1,
        validation_status: 'VALID',
        anomalies: [],
      },
      {
        event_id: 2,
        order_id: 101,
        stage_id: 2,
        stage_code: 'WAREHOUSE_PICKING',
        event_type: 'PICKING_STARTED',
        occurred_at: '2026-11-20T12:05:00Z',
        received_at: '2026-11-20T12:05:10Z',
        source_type: 'WMS_AUTOMATION',
        source_provider: 'Apex WMS Hub',
        idempotency_key: 'evt-002',
        description: 'Fulfillment operator assigned order to bin #14.',
        sequence_position: 2,
        validation_status: 'VALID',
        anomalies: [],
      },
      {
        event_id: 3,
        order_id: 101,
        stage_id: 2,
        stage_code: 'WAREHOUSE_PICKING',
        event_type: 'PACKAGE_SCANNED',
        occurred_at: '2026-11-21T13:05:00Z',
        received_at: '2026-11-21T13:05:04Z',
        source_type: 'BARCODE_SCANNER',
        source_provider: 'Zebra TC52',
        idempotency_key: 'evt-003',
        description: 'Item scanned into dispatch consolidation tote.',
        sequence_position: 3,
        validation_status: 'VALID',
        anomalies: ['PICKING_HOLD_DELAY'],
      },
    ],
  };

  const mockEvidence: EvidenceItem[] = [
    {
      evidence_id: 501,
      order_id: 101,
      event_id: 3,
      case_id: null,
      uploaded_by: 2,
      blob_uri: 'https://causaraevidence.blob.core.windows.net/evidence/tote_scan_log.pdf',
      file_name: 'tote_scan_log.pdf',
      content_type: 'application/pdf',
      sha256_hash: 'a1b2c3d4e5f6',
      status: 'ACTIVE',
      uploaded_at: '2026-11-21T13:10:00Z',
      completed_at: '2026-11-21T13:10:05Z',
      upload_expires_at: null,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, back action, and order context', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidence);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Order Timeline' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reconstruct Timeline/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
      expect(screen.getByText('Elena Rostova')).toBeInTheDocument();
      expect(screen.getByText('Apex Retail Co.')).toBeInTheDocument();
    });
  });

  it('displays the Analytical Epistemology Distinction Banner', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce([]);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Analytical Distinction System:/i)).toBeInTheDocument();
      expect(screen.getByText(/A. Observed Facts:/i)).toBeInTheDocument();
      expect(screen.getByText(/B. Measured Variances:/i)).toBeInTheDocument();
      expect(screen.getByText(/C. Hypotheses:/i)).toBeInTheDocument();
      expect(screen.getByText(/D. Estimates:/i)).toBeInTheDocument();
    });
  });

  it('renders planned vs actual stage progression with variance metrics', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce([]);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText('Planned vs. Actual Operational Stage Progression')
      ).toBeInTheDocument();
      expect(screen.getByText('ORDER_PLACED')).toBeInTheDocument();
      expect(screen.getByText('WAREHOUSE_PICKING')).toBeInTheDocument();
      expect(screen.getByText('-15 min')).toBeInTheDocument();
      expect(screen.getByText('+60 min')).toBeInTheDocument();
    });
  });

  it('renders chronological visual timeline with occurred and received timestamps', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidence);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORDER_CREATED')).toBeInTheDocument();
      expect(screen.getByText('PICKING_STARTED')).toBeInTheDocument();
      expect(screen.getByText('PACKAGE_SCANNED')).toBeInTheDocument();
      expect(screen.getAllByText('Occurred At (Source System)').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Received At (Causara Log)').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays linked evidence and allows navigating to Evidence module', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce(mockEvidence);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('tote_scan_log.pdf')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('tote_scan_log.pdf'));
    expect(mockNavigate).toHaveBeenCalledWith('evidence', { orderId: 101 });
  });

  it('switches between Visual Timeline and Event Table views', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce([]);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Visual Timeline')).toBeInTheDocument();
      expect(screen.getByText('Event Table')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Event Table'));

    await waitFor(() => {
      expect(screen.getByText('Event & Stage')).toBeInTheDocument();
      expect(screen.getByText('Source Origin')).toBeInTheDocument();
    });
  });

  it('navigates to delay analysis and orders when context buttons are clicked', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchTimeline').mockResolvedValueOnce(mockTimeline);
    vi.spyOn(api, 'fetchEvidence').mockResolvedValueOnce([]);

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Back to Orders/i }));
    expect(mockNavigate).toHaveBeenCalledWith('orders', { orderId: 101 });

    fireEvent.click(screen.getByRole('button', { name: /Delay Analysis →/i }));
    expect(mockNavigate).toHaveBeenCalledWith('delay-analysis', { orderId: 101 });
  });

  it('handles and sanitizes Azure SQL firewall connection error', async () => {
    vi.spyOn(api, 'fetchOrders').mockRejectedValueOnce(
      new Error('Cannot open server "causara-sql" requested by the login. Client with IP address is not allowed.')
    );

    render(
      <ThemeProvider>
        <TimelinePage initialOrderId={101} onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Database connectivity is restricted by firewall rules/i)
      ).toBeInTheDocument();
    });
  });
});
