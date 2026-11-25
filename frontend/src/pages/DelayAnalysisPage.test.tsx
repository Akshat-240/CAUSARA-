import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DelayAnalysisPage } from './DelayAnalysisPage';
import * as api from '../services/api';
import { ThemeProvider } from '../context/ThemeContext';
import type { Order, DelayAnalysisReport, DemoActor } from '../types/api';

describe('DelayAnalysisPage Component', () => {
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

  const mockReport: DelayAnalysisReport = {
    order_id: 101,
    case_id: 15,
    order_status: 'DELAYED',
    is_delayed: true,
    total_planned_duration_minutes: 2880,
    total_actual_duration_minutes: 4410,
    total_delivery_variance_minutes: 1530,
    primary_delay_stage_code: 'SELLER_PROCESSING',
    stage_metrics: [
      {
        stage_id: 1,
        stage_code: 'SELLER_PROCESSING',
        sequence_no: 1,
        status: 'COMPLETED',
        planned_start_at: '2026-11-20T10:00:00Z',
        planned_end_at: '2026-11-20T18:00:00Z',
        actual_start_at: '2026-11-20T10:00:00Z',
        actual_end_at: '2026-11-21T20:00:00Z',
        planned_duration_minutes: 480,
        actual_duration_minutes: 2040,
        variance_minutes: 1560,
        excess_duration_minutes: 1560,
        time_recovered_minutes: 0,
        is_delayed: true,
        has_missing_data: false,
        event_count: 3,
        source_event_ids: [1, 2, 3],
        anomalies: ['PICKING_HOLD_DELAY'],
      },
      {
        stage_id: 2,
        stage_code: 'DISPATCH',
        sequence_no: 2,
        status: 'COMPLETED',
        planned_start_at: '2026-11-21T20:00:00Z',
        planned_end_at: '2026-11-22T02:00:00Z',
        actual_start_at: '2026-11-21T20:00:00Z',
        actual_end_at: '2026-11-22T01:30:00Z',
        planned_duration_minutes: 360,
        actual_duration_minutes: 330,
        variance_minutes: -30,
        excess_duration_minutes: 0,
        time_recovered_minutes: 30,
        is_delayed: false,
        has_missing_data: false,
        event_count: 2,
        source_event_ids: [4, 5],
        anomalies: [],
      },
    ],
    delay_graph: [
      {
        edge_id: 1,
        case_id: 15,
        from_stage_id: 1,
        from_stage_code: 'SELLER_PROCESSING',
        to_stage_id: 2,
        to_stage_code: 'DISPATCH',
        edge_type: 'STAGE_TRANSITION',
        evidence_class: 'FACT',
        estimated_delay_minutes: 1560,
        explanation: 'Fulfillment operator picking queue backlog propagated into carrier handover schedule.',
      },
    ],
    epistemological_breakdown: {
      facts: {
        description: 'Empirically recorded timestamps from WMS and carrier logs.',
        observed_stages_count: 2,
        records: [],
      },
      variances: {
        description: 'Calculated SLA duration discrepancies.',
        stages_with_variance_count: 2,
        records: [],
      },
      hypotheses: {
        description: 'Candidate causal transition propagation paths.',
        candidate_edges_count: 1,
      },
      estimates: {
        description: 'Projected downstream SLA impact.',
        total_estimated_delay_minutes: 1530,
      },
    },
    missing_data_warnings: ['Linehaul carrier GPS feed had a 15-minute telemetry gap.'],
    disclaimer: 'Variances represent mathematical observations against baseline schedules.',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockClear();
  });

  it('renders page heading, order selector, and Run Delay Analysis button', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchDelayAnalysis').mockResolvedValueOnce(mockReport);

    render(
      <ThemeProvider>
        <DelayAnalysisPage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 2, name: /Delay Analysis & Root-Cause Hypotheses/i })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Run Delay Analysis/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Back to Orders/i })).toBeInTheDocument();
      expect(screen.getByText('ORD-2026-001')).toBeInTheDocument();
    });
  });

  it('displays Epistemological Guardrail Banner and 4-Quadrant taxonomy breakdown', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchDelayAnalysis').mockResolvedValueOnce(mockReport);

    render(
      <ThemeProvider>
        <DelayAnalysisPage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Epistemological Guardrail:/i)).toBeInTheDocument();
      expect(screen.getByText('FACTS')).toBeInTheDocument();
      expect(screen.getByText('VARIANCES')).toBeInTheDocument();
      expect(screen.getByText('HYPOTHESES')).toBeInTheDocument();
      expect(screen.getByText('ESTIMATES')).toBeInTheDocument();
    });
  });

  it('displays executive metrics and stage duration variance decomposition', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchDelayAnalysis').mockResolvedValueOnce(mockReport);

    render(
      <ThemeProvider>
        <DelayAnalysisPage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('DELAY DETECTED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('+1530 min')).toBeInTheDocument();
      expect(screen.getAllByText('SELLER_PROCESSING').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('+1560 min').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('-30 min')).toBeInTheDocument();
    });
  });

  it('displays synthesized delay propagation graph (causal chain)', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchDelayAnalysis').mockResolvedValueOnce(mockReport);

    render(
      <ThemeProvider>
        <DelayAnalysisPage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Synthesized Delay Graph \(1 Propagation Edges\)/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/Fulfillment operator picking queue backlog/i)).toBeInTheDocument();
    });
  });

  it('navigates to interventions when Explore Interventions is clicked', async () => {
    vi.spyOn(api, 'fetchOrders').mockResolvedValueOnce({
      total: 1,
      limit: 50,
      offset: 0,
      orders: mockOrders,
    });
    vi.spyOn(api, 'fetchOrder').mockResolvedValueOnce(mockOrders[0]);
    vi.spyOn(api, 'fetchDelayAnalysis').mockResolvedValueOnce(mockReport);

    render(
      <ThemeProvider>
        <DelayAnalysisPage
          initialOrderId={101}
          activeActor={mockActor}
          onNavigate={mockNavigate}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Explore Interventions →/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Explore Interventions →/i }));
    expect(mockNavigate).toHaveBeenCalledWith('interventions', { caseId: 15, orderId: 101 });
  });

  it('handles sanitized Azure SQL firewall error message', async () => {
    vi.spyOn(api, 'fetchOrders').mockRejectedValueOnce(
      new Error('Cannot open server "causara-sql" requested by the login. Client with IP address is not allowed.')
    );

    render(
      <ThemeProvider>
        <DelayAnalysisPage
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
