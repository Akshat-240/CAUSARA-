import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InterventionsPage } from './InterventionsPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, CandidateIntervention } from '../types/api';

describe('InterventionsPage Component', () => {
  const mockNavigate = vi.fn();

  const mockOrders: Order[] = [
    {
      order_id: 101,
      external_order_ref: 'ORD-2026-001',
      seller_id: 1,
      customer_user_id: 2,
      status: 'DELAYED',
      placed_at: '2026-11-20T10:00:00Z',
      expected_delivery_at: '2026-11-23T10:00:00Z',
      actual_delivery_at: null,
      created_at: '2026-11-20T10:00:00Z',
      seller_business_name: 'Apex Retail Co.',
      customer_name: 'Elena Rostova',
      active_case_id: 15,
    },
    {
      order_id: 102,
      external_order_ref: 'ORD-2026-002',
      seller_id: 2,
      customer_user_id: 3,
      status: 'PROCESSING',
      placed_at: '2026-11-21T08:00:00Z',
      expected_delivery_at: '2026-11-26T18:00:00Z',
      actual_delivery_at: null,
      created_at: '2026-11-21T08:00:00Z',
      seller_business_name: 'Nordic Logistics',
      customer_name: 'Marcus Vance',
      active_case_id: null,
    },
  ];

  const mockCandidates: CandidateIntervention[] = [
    {
      intervention_id: 201,
      intervention_code: 'EXPEDITE_CARRIER_DISPATCH',
      name: 'Expedited Carrier Linehaul',
      intervention_type: 'CARRIER_UPGRADE',
      applicable_stage_code: 'DISPATCH',
      rationale: 'Reroute stalled batch to express dedicated linehaul truck to recover transit SLA.',
      preconditions: 'Carrier freight manifest can be updated before 18:00 cutoff.',
      expected_time_saved_minutes: 360,
      estimated_cost: 120.0,
      risk_level: 'LOW',
    },
    {
      intervention_id: 202,
      intervention_code: 'SPLIT_ORDER_FULFILLMENT',
      name: 'Split Warehouse Fulfillment',
      intervention_type: 'FACILITY_TRANSFER',
      applicable_stage_code: 'SELLER_PROCESSING',
      rationale: 'Fulfill available inventory from Secondary Hub while backordering remaining item.',
      preconditions: 'Inventory confirmed available at secondary distribution center.',
      expected_time_saved_minutes: 720,
      estimated_cost: 250.0,
      risk_level: 'MEDIUM',
    },
    {
      intervention_id: 203,
      intervention_code: 'SAME_DAY_COURIER_DIRECT',
      name: 'Direct Hot-Shot Courier',
      intervention_type: 'LAST_MILE_COURIER',
      applicable_stage_code: 'LAST_MILE',
      rationale: 'Deploy point-to-point courier bypass to deliver directly to customer doorstep.',
      preconditions: 'Customer delivery address is within local metro dispatch radius.',
      expected_time_saved_minutes: 180,
      estimated_cost: 450.0,
      risk_level: 'HIGH',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, order selector, and navigation action buttons', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Candidate Interventions' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Simulate Scenarios/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });
  });

  it('renders overview metrics strip and intervention candidate cards', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Available Levers')).toBeInTheDocument();
      expect(screen.getByText('Max Delay Recovery')).toBeInTheDocument();
      expect(screen.getByText('Applicable Stages')).toBeInTheDocument();

      // Cards
      expect(screen.getByText('Expedited Carrier Linehaul')).toBeInTheDocument();
      expect(screen.getByText('Split Warehouse Fulfillment')).toBeInTheDocument();
      expect(screen.getByText('Direct Hot-Shot Courier')).toBeInTheDocument();
    });
  });

  it('filters candidates by risk level pills', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Expedited Carrier Linehaul')).toBeInTheDocument();
    });

    // Click LOW Risk filter
    const lowRiskButton = screen.getByRole('button', { name: /LOW Risk/i });
    fireEvent.click(lowRiskButton);

    expect(screen.getByText('Expedited Carrier Linehaul')).toBeInTheDocument();
    expect(screen.queryByText('Split Warehouse Fulfillment')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct Hot-Shot Courier')).not.toBeInTheDocument();

    // Click All Risks filter to reset
    const allRiskButton = screen.getByRole('button', { name: /All Risks/i });
    fireEvent.click(allRiskButton);

    expect(screen.getByText('Split Warehouse Fulfillment')).toBeInTheDocument();
  });

  it('filters candidates by text search input', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Expedited Carrier Linehaul')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search intervention name, stage, domain\.\.\./i);
    fireEvent.change(searchInput, { target: { value: 'Courier' } });

    expect(screen.getByText('Direct Hot-Shot Courier')).toBeInTheDocument();
    expect(screen.queryByText('Expedited Carrier Linehaul')).not.toBeInTheDocument();
    expect(screen.queryByText('Split Warehouse Fulfillment')).not.toBeInTheDocument();
  });

  it('opens and closes candidate intervention detail modal', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Expedited Carrier Linehaul')).toBeInTheDocument();
    });

    // Click "Inspect Details" button on the first candidate
    const viewButtons = screen.getAllByRole('button', { name: /Inspect Details/i });
    fireEvent.click(viewButtons[0]);

    // Modal should appear
    await waitFor(() => {
      expect(screen.getByText(/Intervention Lever:/i)).toBeInTheDocument();
      expect(screen.getByText('Operational Preconditions')).toBeInTheDocument();
      expect(screen.getAllByText(/Carrier freight manifest can be updated/i).length).toBeGreaterThanOrEqual(1);
    });

    // Close modal
    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText(/Intervention Lever:/i)).not.toBeInTheDocument();
    });
  });

  it('handles navigation to simulator and orders', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 2,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    render(
      <ThemeProvider>
        <InterventionsPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Simulate Scenarios/i })).toBeInTheDocument();
    });

    // Click Simulate Scenarios
    fireEvent.click(screen.getByRole('button', { name: /Simulate Scenarios/i }));
    expect(mockNavigate).toHaveBeenCalledWith('scenarios', { caseId: 15, orderId: 101 });

    // Click Back to Orders
    fireEvent.click(screen.getByRole('button', { name: /Back to Orders/i }));
    expect(mockNavigate).toHaveBeenCalledWith('orders', { orderId: 101 });
  });

  it('displays empty state when order has no active case', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: [{ ...mockOrders[1], active_case_id: null }],
    });

    render(
      <ThemeProvider>
        <InterventionsPage
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('No Active Delay Case')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Run Delay Analysis to Create Case/i })).toBeInTheDocument();
    });
  });
});
