import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OverviewPage } from './OverviewPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, OrderStats } from '../types/api';

describe('OverviewPage Component', () => {
  const mockNavigate = vi.fn();

  const mockStats: OrderStats = {
    total_orders: 148,
    active_orders: 42,
    delivered_orders: 98,
    delayed_orders: 5,
    open_cases_count: 2,
    cancelled_orders: 3,
  };

  const mockOrders: Order[] = [
    {
      order_id: 1,
      external_order_ref: 'ORD-DEMO-001',
      seller_id: 1,
      customer_user_id: 2,
      status: 'DELIVERED',
      placed_at: '2026-11-20T10:00:00Z',
      expected_delivery_at: '2026-11-22T10:00:00Z',
      actual_delivery_at: '2026-11-22T10:00:00Z',
      created_at: '2026-11-20T10:00:00Z',
      seller_business_name: 'Apex Retail Co.',
      customer_name: 'Elena Rostova',
      active_case_id: null,
    },
    {
      order_id: 2,
      external_order_ref: 'ORD-DEMO-002',
      seller_id: 1,
      customer_user_id: 3,
      status: 'DELAYED',
      placed_at: '2026-11-21T10:00:00Z',
      expected_delivery_at: '2026-11-23T10:00:00Z',
      actual_delivery_at: null,
      created_at: '2026-11-21T10:00:00Z',
      seller_business_name: 'Apex Retail Co.',
      customer_name: 'Marcus Vance',
      active_case_id: 10,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading and action buttons', async () => {
    vi.spyOn(api, 'fetchOrderStats').mockResolvedValueOnce(mockStats);
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 10,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OverviewPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Logistics Overview')).toBeInTheDocument();
      expect(
        screen.getByText(/Real-time fulfillment intelligence, stage variance monitoring/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Manage Orders/i })).toBeInTheDocument();
    });
  });

  it('displays real KPI figures and status breakdown from API', async () => {
    vi.spyOn(api, 'fetchOrderStats').mockResolvedValueOnce(mockStats);
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 10,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OverviewPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('148')).toBeInTheDocument();
      expect(screen.getAllByText(/42/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/98/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/3/).length).toBeGreaterThanOrEqual(1);
    });

    // Check Analytics section
    expect(screen.getByText(/Fulfillment Status Breakdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Operational Performance Ratios/i)).toBeInTheDocument();
  });

  it('renders Attention Required section for delayed/case orders', async () => {
    vi.spyOn(api, 'fetchOrderStats').mockResolvedValueOnce(mockStats);
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 10,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OverviewPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Attention Required — Operational Exceptions/i)).toBeInTheDocument();
      expect(screen.getAllByText('ORD-DEMO-002').length).toBeGreaterThanOrEqual(1);
    });

    const investigateBtn = screen.getByRole('button', { name: /Investigate Delay/i });
    expect(investigateBtn).toBeInTheDocument();
    fireEvent.click(investigateBtn);

    expect(mockNavigate).toHaveBeenCalledWith('delay-analysis', {
      orderId: 2,
      caseId: 10,
    });
  });

  it('navigates to orders page on Manage Orders click', async () => {
    vi.spyOn(api, 'fetchOrderStats').mockResolvedValueOnce(mockStats);
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 0,
      limit: 10,
      offset: 0,
      orders: [],
    });

    render(
      <ThemeProvider>
        <OverviewPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Manage Orders/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Manage Orders/i }));
    expect(mockNavigate).toHaveBeenCalledWith('orders');
  });

  it('displays sanitized alert on API connection error with retry button', async () => {
    vi.spyOn(api, 'fetchOrderStats').mockRejectedValueOnce(
      new Error('Client with IP address 1.2.3.4 is not allowed to access the server')
    );
    vi.spyOn(api, 'fetchOrders').mockRejectedValueOnce(
      new Error('Connection failed')
    );

    render(
      <ThemeProvider>
        <OverviewPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Fulfillment Telemetry Notice/i)).toBeInTheDocument();
      expect(screen.getByText(/Database connectivity is restricted by current firewall rules/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry Connection/i })).toBeInTheDocument();
    });
  });
});
