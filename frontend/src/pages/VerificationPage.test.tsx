import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VerificationPage } from './VerificationPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, OperationalDecision, OutcomeVerification } from '../types/api';

describe('VerificationPage Component', () => {
  const mockNavigate = vi.fn();

  const mockOrders: Order[] = [
    {
      order_id: 101,
      external_order_ref: 'ORD-2026-001',
      seller_id: 1,
      customer_user_id: 2,
      status: 'DELIVERED',
      placed_at: '2026-11-20T10:00:00Z',
      expected_delivery_at: '2026-11-23T10:00:00Z',
      actual_delivery_at: '2026-11-23T14:30:00Z',
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
      rationale: 'Expedited carrier transit approved.',
      selected_at: '2026-11-21T15:00:00Z',
      approved_at: '2026-11-21T15:30:00Z',
      scenario_name: 'Standard Carrier Expedited Reroute',
    },
  ];

  const mockVerification: OutcomeVerification = {
    verification_id: 601,
    decision_id: 401,
    measured_at: '2026-11-23T15:00:00Z',
    original_expected_delivery_at: '2026-11-23T10:00:00Z',
    baseline_estimated_delivery_at: '2026-11-24T18:00:00Z',
    predicted_delivery_at: '2026-11-23T14:00:00Z',
    actual_delivery_at: '2026-11-23T14:30:00Z',
    signed_prediction_error_minutes: 30,
    absolute_prediction_error_minutes: 30,
    delivery_variance_minutes: 270,
    outcome_notes: 'Dedicated linehaul truck arrived smoothly; final mile courier experienced a 30-minute gate verification delay.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, selectors, and action buttons', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    vi.spyOn(api, 'fetchDecisionVerification').mockResolvedValueOnce(mockVerification);

    render(
      <ThemeProvider>
        <VerificationPage
          initialOrderId={101}
          initialCaseId={15}
          initialDecisionId={401}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Empirical Outcome Verification' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Decisions/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Re-Verify Outcome/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });
  });

  it('displays executive verification metrics strip', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    vi.spyOn(api, 'fetchDecisionVerification').mockResolvedValueOnce(mockVerification);

    render(
      <ThemeProvider>
        <VerificationPage
          initialOrderId={101}
          initialCaseId={15}
          initialDecisionId={401}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Verification Status')).toBeInTheDocument();
      expect(screen.getByText('Signed Prediction Error')).toBeInTheDocument();
      expect(screen.getByText('Absolute Prediction Error')).toBeInTheDocument();
      expect(screen.getByText('SLA Delivery Variance')).toBeInTheDocument();

      expect(screen.getByText('EMPIRICALLY VERIFIED')).toBeInTheDocument();
      expect(screen.getByText('+30 min')).toBeInTheDocument();
      expect(screen.getByText('+270 min')).toBeInTheDocument();
    });
  });

  it('displays timeline audit comparison cards and auditor notes', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    vi.spyOn(api, 'fetchDecisionVerification').mockResolvedValueOnce(mockVerification);

    render(
      <ThemeProvider>
        <VerificationPage
          initialOrderId={101}
          initialCaseId={15}
          initialDecisionId={401}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('1. Contractual SLA Commitment')).toBeInTheDocument();
      expect(screen.getByText('2. Model Predicted Delivery')).toBeInTheDocument();
      expect(screen.getByText('3. Empirically Observed Delivery')).toBeInTheDocument();
      expect(screen.getByText(/Dedicated linehaul truck arrived smoothly/i)).toBeInTheDocument();
      expect(screen.getByText(/Unmitigated Baseline Projection:/i)).toBeInTheDocument();
    });
  });

  it('navigates to evidence management when clicking Inspect Supporting Evidence', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    vi.spyOn(api, 'fetchDecisionVerification').mockResolvedValueOnce(mockVerification);

    render(
      <ThemeProvider>
        <VerificationPage
          initialOrderId={101}
          initialCaseId={15}
          initialDecisionId={401}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inspect Supporting Evidence/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Inspect Supporting Evidence/i }));

    expect(mockNavigate).toHaveBeenCalledWith('evidence', {
      orderId: 101,
      caseId: 15,
    });
  });

  it('submits outcome verification via modal', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchCaseDecisions').mockResolvedValueOnce(mockDecisions);
    // Decision is not yet verified
    vi.spyOn(api, 'fetchDecisionVerification').mockRejectedValueOnce(new Error('Not found'));

    const verifySpy = vi.spyOn(api, 'verifyDecision').mockResolvedValueOnce(mockVerification);

    render(
      <ThemeProvider>
        <VerificationPage
          initialOrderId={101}
          initialCaseId={15}
          initialDecisionId={401}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Verify Actual Outcome Now/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Verify Actual Outcome Now/i }));

    await waitFor(() => {
      expect(screen.getByText('Record Observed Delivery & Verify Model Accuracy')).toBeInTheDocument();
    });

    const notesInput = screen.getByPlaceholderText(/Expedited air flight arrived on schedule/i);
    fireEvent.change(notesInput, { target: { value: 'Delivered successfully at gate 4.' } });

    const submitBtn = screen.getByRole('button', { name: /Compute Prediction Errors/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(verifySpy).toHaveBeenCalledWith(
        401,
        expect.objectContaining({
          outcome_notes: 'Delivered successfully at gate 4.',
        })
      );
    });
  });
});
