import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DecisionsPage } from './DecisionsPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, OperationalDecision, DecisionScenario, DemoActor } from '../types/api';

describe('DecisionsPage Component', () => {
  const mockNavigate = vi.fn();

  const mockActors: DemoActor[] = [
    {
      id: 1,
      name: 'Elena Rostova',
      email: 'elena@causara.com',
      role: 'MANAGER',
      label: 'Elena Rostova (Operations Manager)',
    },
    {
      id: 2,
      name: 'Marcus Vance',
      email: 'marcus@causara.com',
      role: 'ANALYST',
      label: 'Marcus Vance (Logistics Analyst)',
    },
  ];

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
  ];

  const mockDecisions: OperationalDecision[] = [
    {
      decision_id: 401,
      case_id: 15,
      scenario_id: 301,
      decided_by: 2,
      approved_by: 1,
      decision_status: 'APPROVED',
      rationale: 'Expedited carrier transit approved to prevent contractual SLA penalty.',
      selected_at: '2026-11-21T15:00:00Z',
      approved_at: '2026-11-21T15:30:00Z',
      scenario_name: 'Standard Carrier Expedited Reroute',
      predicted_time_saved_minutes: 360,
      estimated_cost: 150.0,
      risk_level: 'LOW',
      confidence_score: 0.88,
      decided_by_name: 'Marcus Vance',
      approved_by_name: 'Elena Rostova',
    },
    {
      decision_id: 402,
      case_id: 15,
      scenario_id: 302,
      decided_by: 2,
      approved_by: null,
      decision_status: 'PENDING',
      rationale: 'Alternative dual-facility split scenario awaiting budgetary confirmation.',
      selected_at: '2026-11-21T16:00:00Z',
      approved_at: null,
      scenario_name: 'Dual Facility Cross-Dock & Local Air',
      predicted_time_saved_minutes: 720,
      estimated_cost: 420.0,
      risk_level: 'HIGH',
      confidence_score: 0.65,
      decided_by_name: 'Marcus Vance',
      approved_by_name: null,
    },
  ];

  const mockScenarios: DecisionScenario[] = [
    {
      scenario_id: 301,
      case_id: 15,
      scenario_name: 'Standard Carrier Expedited Reroute',
      status: 'READY',
      predicted_time_saved_minutes: 360,
      estimated_cost: 150.0,
      risk_level: 'LOW',
      confidence_score: 0.88,
      cosmos_document_id: 'doc-301',
      model_version: 'v1.4.2',
      created_at: '2026-11-21T14:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, action buttons, and order selector', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Operational Decisions & Governance' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Record Decision/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Simulator/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });
  });

  it('displays overview metrics and recorded decisions', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Recorded Decisions')).toBeInTheDocument();
      expect(screen.getByText('Approved Decisions')).toBeInTheDocument();
      expect(screen.getByText('Pending Authorization')).toBeInTheDocument();
      expect(screen.getByText('Active Signer')).toBeInTheDocument();

      // Decision cards
      expect(screen.getByText(/Decision #401: Standard Carrier Expedited Reroute/i)).toBeInTheDocument();
      expect(screen.getByText(/Decision #402: Dual Facility Cross-Dock & Local Air/i)).toBeInTheDocument();
      expect(screen.getByText(/Expedited carrier transit approved to prevent contractual SLA penalty/i)).toBeInTheDocument();
    });
  });

  it('filters decisions by status pills', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Decision #401:/i)).toBeInTheDocument();
    });

    // Click PENDING status pill
    const pendingButton = screen.getByRole('button', { name: /^PENDING$/i });
    fireEvent.click(pendingButton);

    expect(screen.getByText(/Decision #402:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Decision #401:/i)).not.toBeInTheDocument();

    // Click All Statuses pill to reset
    const allButton = screen.getByRole('button', { name: /All Statuses/i });
    fireEvent.click(allButton);

    expect(screen.getByText(/Decision #401:/i)).toBeInTheDocument();
  });

  it('filters decisions with text search', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Decision #401:/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search scenario name, rationale, user\.\.\./i);
    fireEvent.change(searchInput, { target: { value: 'Dual Facility' } });

    expect(screen.getByText(/Decision #402:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Decision #401:/i)).not.toBeInTheDocument();
  });

  it('opens and closes decision specifications detail modal', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Decision #401:/i)).toBeInTheDocument();
    });

    const inspectButtons = screen.getAllByRole('button', { name: /Inspect Specifications/i });
    fireEvent.click(inspectButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Audit Justification & Rationale/i)).toBeInTheDocument();
    });

    const closeButtons = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText(/Audit Justification & Rationale/i)).not.toBeInTheDocument();
    });
  });

  it('approves a pending decision when manager clicks Approve Decision', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    const approveSpy = vi.spyOn(api, 'approveDecision').mockResolvedValueOnce({
      ...mockDecisions[1],
      decision_status: 'APPROVED',
      approved_by: 1,
      approved_at: '2026-11-21T16:30:00Z',
    });

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]} // Elena Rostova (MANAGER)
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Approve Decision \(Manager\)/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Approve Decision \(Manager\)/i }));

    await waitFor(() => {
      expect(approveSpy).toHaveBeenCalledWith(402, 1);
    });
  });

  it('records an operational decision from modal', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);

    const recordSpy = vi.spyOn(api, 'recordDecision').mockResolvedValueOnce({
      decision_id: 403,
      case_id: 15,
      scenario_id: 301,
      decided_by: 1,
      approved_by: null,
      decision_status: 'PENDING',
      rationale: 'Customer SLA critical path requires expedited carrier.',
      selected_at: '2026-11-21T17:00:00Z',
      approved_at: null,
    });

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Record Decision/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /\+ Record Decision/i }));

    await waitFor(() => {
      expect(screen.getByText('Decision Rationale & Governance Justification *')).toBeInTheDocument();
    });

    const rationaleInput = screen.getByPlaceholderText(/Explain why this scenario was selected over alternatives/i);
    fireEvent.change(rationaleInput, { target: { value: 'Customer SLA critical path requires expedited carrier.' } });

    const submitBtn = screen.getByRole('button', { name: /Commit Decision Record/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordSpy).toHaveBeenCalledWith(
        15,
        expect.objectContaining({
          scenario_id: 301,
          decided_by: 1,
          rationale: 'Customer SLA critical path requires expedited carrier.',
        })
      );
    });
  });

  it('navigates to verification when clicking Verify Actual Outcome', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);

    render(
      <ThemeProvider>
        <DecisionsPage
          initialOrderId={101}
          initialCaseId={15}
          actors={mockActors}
          activeActor={mockActors[0]}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify Actual Outcome/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Verify Actual Outcome/i }));

    expect(mockNavigate).toHaveBeenCalledWith('verification', {
      caseId: 15,
      orderId: 101,
      decisionId: 401,
    });
  });
});
