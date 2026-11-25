import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersPage } from './OrdersPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, OrderStage, Seller, User } from '../types/api';

describe('OrdersPage Component', () => {
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

  const mockStages: OrderStage[] = [
    {
      stage_id: 1,
      order_id: 101,
      sequence_no: 1,
      stage_code: 'ORDER_PLACED',
      planned_start_at: '2026-11-20T10:00:00Z',
      planned_end_at: '2026-11-20T12:00:00Z',
      actual_start_at: '2026-11-20T10:00:00Z',
      actual_end_at: '2026-11-20T11:45:00Z',
      status: 'COMPLETED',
    },
    {
      stage_id: 2,
      order_id: 101,
      sequence_no: 2,
      stage_code: 'WAREHOUSE_PICKING',
      planned_start_at: '2026-11-20T12:00:00Z',
      planned_end_at: '2026-11-21T12:00:00Z',
      actual_start_at: '2026-11-20T12:05:00Z',
      actual_end_at: null,
      status: 'IN_PROGRESS',
    },
  ];

  const mockSellers: Seller[] = [
    {
      seller_id: 1,
      owner_user_id: 10,
      business_name: 'Apex Retail Co.',
    },
    {
      seller_id: 2,
      owner_user_id: 11,
      business_name: 'Nordic Logistics',
    },
  ];

  const mockCustomers: User[] = [
    {
      user_id: 2,
      full_name: 'Elena Rostova',
      email: 'elena@example.com',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      user_id: 3,
      full_name: 'Marcus Vance',
      email: 'marcus@example.com',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading and action buttons', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Orders' })).toBeInTheDocument();
      expect(
        screen.getByText(/Consignment catalog with baseline schedules, stage progressions/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ New Order/i })).toBeInTheDocument();
    });
  });

  it('displays orders table with correct columns and data', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-002')).toBeInTheDocument();
      expect(screen.getByText('Elena Rostova')).toBeInTheDocument();
      expect(screen.getByText('Marcus Vance')).toBeInTheDocument();
      expect(screen.getByText('Apex Retail Co.')).toBeInTheDocument();
      expect(screen.getByText('Nordic Logistics')).toBeInTheDocument();
      expect(screen.getAllByText('PROCESSING').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('DELIVERED').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('filters orders with search query input', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search reference, customer, seller/i);
    fireEvent.change(searchInput, { target: { value: 'Marcus' } });

    expect(screen.queryByText('ORD-2026-001')).not.toBeInTheDocument();
    expect(screen.getByText('ORD-2026-002')).toBeInTheDocument();
  });

  it('selects an order and displays detailed stage progression panel', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchOrderStages').mockResolvedValueOnce(mockStages);

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });

    const detailsButtons = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Order: ORD-2026-001')).toBeInTheDocument();
      expect(screen.getByText('Planned vs. Observed Operational Stages')).toBeInTheDocument();
      expect(screen.getByText('ORDER_PLACED')).toBeInTheDocument();
      expect(screen.getByText('WAREHOUSE_PICKING')).toBeInTheDocument();
    });
  });

  it('navigates to timeline, delay analysis, and evidence from details panel', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchOrderStages').mockResolvedValueOnce(mockStages);

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });

    const detailsButtons = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('View Timeline')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('View Timeline'));
    expect(mockNavigate).toHaveBeenCalledWith('timeline', { orderId: 101 });

    fireEvent.click(screen.getByText('Run Delay Analysis'));
    expect(mockNavigate).toHaveBeenCalledWith('delay-analysis', { orderId: 101 });

    fireEvent.click(screen.getByText('Evidence Files'));
    expect(mockNavigate).toHaveBeenCalledWith('evidence', { orderId: 101 });
  });

  it('opens create order modal and populates seller/customer options', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchSellers').mockResolvedValueOnce(mockSellers);
    vi.spyOn(api, 'fetchUsers').mockResolvedValueOnce(mockCustomers);

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ New Order/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create New Order' })).toBeInTheDocument();
      expect(screen.getByLabelText(/External Order Reference/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Registered Seller/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Customer User/i)).toBeInTheDocument();
    });
  });

  it('displays sanitized error message when database connection fails', async () => {
    vi.spyOn(api, 'fetchOrders').mockRejectedValueOnce(
      new Error('Cannot open server "causara-sql" requested by the login. Client with IP address is not allowed.')
    );

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Database connectivity is restricted by current firewall rules/i)
      ).toBeInTheDocument();
    });
  });

  it('displays EmptyState when no orders match search and provides reset action', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });

    render(
      <ThemeProvider>
        <OrdersPage onNavigate={mockNavigate} />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search reference, customer, seller/i);
    fireEvent.change(searchInput, { target: { value: 'NON_EXISTENT_QUERY_xyz' } });

    expect(screen.getByText('No orders found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear Filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
    expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
  });
});
