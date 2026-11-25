import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScenariosPage } from './ScenariosPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, DecisionScenario, CandidateIntervention } from '../types/api';

describe('ScenariosPage Component', () => {
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
      cosmos_document_id: 'doc-scenario-301',
      model_version: 'v1.4.2-causal-linear',
      created_at: '2026-11-21T14:00:00Z',
      interventions: [
        {
          intervention_id: 201,
          intervention_code: 'EXPEDITE_CARRIER_DISPATCH',
          name: 'Expedited Carrier Linehaul',
          intervention_type: 'CARRIER_UPGRADE',
          description: 'Expedite linehaul transit between origin DC and regional sort facility.',
          estimated_cost_contribution: 150.0,
        },
      ],
      assumptions: ['Standard transit network has available capacity', 'Dispatch cutoff met before 18:00'],
    },
    {
      scenario_id: 302,
      case_id: 15,
      scenario_name: 'Dual Facility Cross-Dock & Local Air',
      status: 'READY',
      predicted_time_saved_minutes: 720,
      estimated_cost: 420.0,
      risk_level: 'HIGH',
      confidence_score: 0.65,
      cosmos_document_id: 'doc-scenario-302',
      model_version: 'v1.4.2-causal-linear',
      created_at: '2026-11-21T14:30:00Z',
      interventions: [
        {
          intervention_id: 202,
          intervention_code: 'SPLIT_ORDER_FULFILLMENT',
          name: 'Split Warehouse Fulfillment',
          intervention_type: 'FACILITY_TRANSFER',
          description: 'Split inventory picking across primary and secondary distribution centers.',
          estimated_cost_contribution: 270.0,
        },
        {
          intervention_id: 203,
          intervention_code: 'SAME_DAY_COURIER_DIRECT',
          name: 'Direct Hot-Shot Courier',
          intervention_type: 'LAST_MILE_COURIER',
          description: 'Direct air freight courier to destination hub.',
          estimated_cost_contribution: 150.0,
        },
      ],
      assumptions: ['Secondary DC inventory holds necessary SKU count', 'Air courier flight schedule confirmed'],
    },
  ];

  const mockCandidates: CandidateIntervention[] = [
    {
      intervention_id: 201,
      intervention_code: 'EXPEDITE_CARRIER_DISPATCH',
      name: 'Expedited Carrier Linehaul',
      intervention_type: 'CARRIER_UPGRADE',
      applicable_stage_code: 'DISPATCH',
      rationale: 'Reroute stalled batch to express linehaul.',
      preconditions: 'Cutoff met before 18:00.',
      expected_time_saved_minutes: 360,
      estimated_cost: 150.0,
      risk_level: 'LOW',
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
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);

    render(
      <ThemeProvider>
        <ScenariosPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Scenario Simulator' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /\+ Custom Scenario/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /⚡ Auto-Generate Options/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
    });
  });

  it('displays overview metrics strip and evaluated scenarios', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);

    render(
      <ThemeProvider>
        <ScenariosPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Evaluated Scenarios')).toBeInTheDocument();
      expect(screen.getByText('Max Recovery Projected')).toBeInTheDocument();
      expect(screen.getByText('Peak Model Confidence')).toBeInTheDocument();

      // Scenarios rendered
      expect(screen.getByText('Standard Carrier Expedited Reroute')).toBeInTheDocument();
      expect(screen.getByText('Dual Facility Cross-Dock & Local Air')).toBeInTheDocument();
    });
  });

  it('navigates to operational decision when clicking Record Decision with this Scenario', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);

    render(
      <ThemeProvider>
        <ScenariosPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Standard Carrier Expedited Reroute')).toBeInTheDocument();
    });

    const recordButtons = screen.getAllByRole('button', { name: /Record Decision with this Scenario/i });
    fireEvent.click(recordButtons[0]);

    expect(mockNavigate).toHaveBeenCalledWith('decisions', {
      caseId: 15,
      orderId: 101,
      scenarioId: 301,
    });
  });

  it('triggers auto-generation of scenarios on button click', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);
    const autoGenSpy = vi.spyOn(api, 'autoGenerateScenarios').mockResolvedValueOnce(mockScenarios);

    render(
      <ThemeProvider>
        <ScenariosPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /⚡ Auto-Generate Options/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /⚡ Auto-Generate Options/i }));

    await waitFor(() => {
      expect(autoGenSpy).toHaveBeenCalledWith(15);
    });
  });

  it('opens custom scenario modal and allows simulation creation', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseScenarios').mockResolvedValueOnce(mockScenarios);
    vi.spyOn(api, 'fetchCandidateInterventions').mockResolvedValueOnce(mockCandidates);

    const simulateSpy = vi.spyOn(api, 'simulateScenario').mockResolvedValueOnce({
      scenario_id: 303,
      case_id: 15,
      scenario_name: 'Custom Express Option',
      status: 'READY',
      predicted_time_saved_minutes: 360,
      estimated_cost: 150.0,
      risk_level: 'LOW',
      confidence_score: 0.88,
      cosmos_document_id: 'doc-scenario-303',
      model_version: 'v1.4.2-causal-linear',
      created_at: '2026-11-21T15:00:00Z',
      interventions: [],
    });

    render(
      <ThemeProvider>
        <ScenariosPage
          initialOrderId={101}
          initialCaseId={15}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /\+ Custom Scenario/i })).toBeInTheDocument();
    });

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /\+ Custom Scenario/i }));

    await waitFor(() => {
      expect(screen.getByText('Simulate Custom Counterfactual Scenario')).toBeInTheDocument();
    });

    // Fill name
    const nameInput = screen.getByPlaceholderText(/e\.g\. Expedited Air Freight \+ Same-Day Sorting/i);
    fireEvent.change(nameInput, { target: { value: 'Custom Express Option' } });

    // Select candidate checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    // Click Simulate Counterfactual
    const simulateButton = screen.getByRole('button', { name: /Simulate Counterfactual/i });
    fireEvent.click(simulateButton);

    await waitFor(() => {
      expect(simulateSpy).toHaveBeenCalledWith(
        15,
        expect.objectContaining({
          scenario_name: 'Custom Express Option',
          intervention_ids: [201],
        })
      );
    });
  });
});
