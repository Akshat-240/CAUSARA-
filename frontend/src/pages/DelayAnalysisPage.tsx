import React, { useEffect, useState } from 'react';
import { Card } from '../components/common/Card';
import { Badge, EpistemologyBadge } from '../components/common/Badge';
import { Button } from '../components/common/Button';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { Alert } from '../components/common/Alert';
import { Table, Column } from '../components/common/Table';
import { DelayAnalysisReport, Order, StageDelayMetric, DelayGraphEdge, DemoActor } from '../types/api';
import { fetchOrders, fetchDelayAnalysis, runDelayAnalysis } from '../services/api';
import { NavigationTab } from '../components/layout/Sidebar';

interface DelayAnalysisPageProps {
  initialOrderId?: number;
  activeActor: DemoActor | null;
  onNavigate: (tab: NavigationTab, params?: { orderId?: number; caseId?: number }) => void;
}

export const DelayAnalysisPage: React.FC<DelayAnalysisPageProps> = ({
  initialOrderId,
  activeActor,
  onNavigate,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(initialOrderId || null);
  const [report, setReport] = useState<DelayAnalysisReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadReport = async (orderId: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDelayAnalysis(orderId);
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Report not found';
      if (msg.includes('not found') || msg.includes('404')) {
        await handleRunAnalysis(orderId);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRunAnalysis = async (orderId?: number) => {
    const targetId = orderId || selectedOrderId;
    if (!targetId) return;

    setAnalyzing(true);
    setError(null);
    try {
      const data = await runDelayAnalysis(targetId, activeActor ? activeActor.id : undefined);
      setReport(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delay analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedOrderId) {
      loadReport(selectedOrderId);
    }
  }, [selectedOrderId]);

  const stageColumns: Column<StageDelayMetric>[] = [
    {
      key: 'sequence_no',
      header: '#',
      width: '50px',
      render: (row) => (
        <span style={{ fontWeight: 600, color: 'var(--text-light)', fontSize: '0.8rem' }}>
          {row.sequence_no}
        </span>
      ),
    },
    {
      key: 'stage_code',
      header: 'Stage Code',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.85rem' }}>
            {row.stage_code}
          </span>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Status: {row.status}
          </div>
        </div>
      ),
    },
    {
      key: 'planned_duration',
      header: 'Planned SLA',
      render: (row) => (
        <span style={{ fontSize: '0.85rem' }}>
          {row.planned_duration_minutes !== null ? `${row.planned_duration_minutes} min` : '—'}
        </span>
      ),
    },
    {
      key: 'actual_duration',
      header: 'Actual Elapsed',
      render: (row) => (
        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
          {row.actual_duration_minutes !== null ? `${row.actual_duration_minutes} min` : '—'}
        </span>
      ),
    },
    {
      key: 'variance_minutes',
      header: 'Calculated Variance',
      render: (row) => {
        if (row.variance_minutes === null) return <span style={{ color: 'var(--text-light)' }}>—</span>;
        const isExcess = row.variance_minutes > 0;
        return (
          <span
            style={{
              fontWeight: 700,
              fontSize: '0.85rem',
              color: isExcess ? 'var(--status-red)' : 'var(--status-green)',
            }}
          >
            {isExcess ? `+${row.variance_minutes}` : row.variance_minutes} min
          </span>
        );
      },
    },
    {
      key: 'epistemology',
      header: 'Classification',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <EpistemologyBadge type={row.actual_duration_minutes !== null ? 'FACT' : 'ESTIMATE'} />
          {row.is_delayed && <Badge label="DELAYED" variant="danger" size="sm" />}
        </div>
      ),
    },
  ];

  const graphColumns: Column<DelayGraphEdge>[] = [
    {
      key: 'transition',
      header: 'Propagation Path',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
            {row.from_stage_code}
          </span>
          <span style={{ color: 'var(--text-light)' }}>&rarr;</span>
          <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '0.85rem' }}>
            {row.to_stage_code}
          </span>
        </div>
      ),
    },
    {
      key: 'edge_type',
      header: 'Relationship Type',
      render: (row) => (
        <Badge
          label={row.edge_type}
          variant={row.edge_type === 'STAGE_TRANSITION' ? 'neutral' : 'warning'}
          size="sm"
        />
      ),
    },
    {
      key: 'evidence_class',
      header: 'Epistemology',
      render: (row) => <EpistemologyBadge type={row.evidence_class} />,
    },
    {
      key: 'estimated_delay',
      header: 'Attributed Variance',
      render: (row) => (
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
          {row.estimated_delay_minutes ? `${row.estimated_delay_minutes} min` : '0 min'}
        </span>
      ),
    },
    {
      key: 'explanation',
      header: 'Causal Chain Explanation',
      render: (row) => (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {row.explanation}
        </span>
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
            Delay Analysis & Root-Cause Hypotheses
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Multi-stage duration variance decomposition and causal chain graph synthesis.
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
            onClick={() => handleRunAnalysis()}
            loading={analyzing}
            disabled={!selectedOrderId}
          >
            Run Delay Analysis
          </Button>
        </div>
      </div>

      {/* Mandatory Epistemological Guardrail Banner */}
      <Alert type="warning" title="Epistemological Guardrail" style={{ marginBottom: '24px' }}>
        <strong>Distinguish Facts from Inferences:</strong> Stage duration variances represent
        calculated differences between actual recorded durations and scheduled SLA baselines.
        Variance alone does NOT constitute proven causal fault. Propagation edges remain structured
        hypotheses subject to corroborating evidence and verification.
      </Alert>

      {error && <Alert type="error" style={{ marginBottom: '20px' }}>{error}</Alert>}

      {loading ? (
        <LoadingSpinner message="Decomposing stage variances and assembling delay graph..." />
      ) : report ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Executive Delay Metrics Summary */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
            }}
          >
            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Delivery Status
              </div>
              <div style={{ marginTop: '6px' }}>
                <Badge
                  label={report.is_delayed ? 'DELAY DETECTED' : 'ON SCHEDULE'}
                  variant={report.is_delayed ? 'danger' : 'success'}
                  size="md"
                  dot
                />
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                Order #{report.order_id} • Case #{report.case_id || 'N/A'}
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Total Delivery Variance
              </div>
              <div
                style={{
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  color: (report.total_delivery_variance_minutes || 0) > 0 ? 'var(--status-red)' : 'var(--status-green)',
                  marginTop: '4px',
                }}
              >
                {report.total_delivery_variance_minutes !== null
                  ? `${report.total_delivery_variance_minutes > 0 ? '+' : ''}${report.total_delivery_variance_minutes} min`
                  : '0 min'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Actual {report.total_actual_duration_minutes ?? 0}m vs Planned {report.total_planned_duration_minutes ?? 0}m
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Primary Bottleneck Stage
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)', marginTop: '4px' }}>
                {report.primary_delay_stage_code || 'None'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Highest accumulated duration variance
              </div>
            </Card>

            <Card padding="16px">
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                Intervention Readiness
              </div>
              <div style={{ marginTop: '10px' }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => onNavigate('interventions', { caseId: report.case_id || undefined, orderId: report.order_id })}
                  disabled={!report.case_id}
                >
                  Explore Interventions &rarr;
                </Button>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                Formulate recovery scenarios
              </div>
            </Card>
          </div>

          {/* 4-Quadrant Epistemological Taxonomy Breakdown */}
          {report.epistemological_breakdown && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
              }}
            >
              <Card padding="16px" style={{ borderLeft: '4px solid var(--badge-fact-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--badge-fact-text)' }}>
                    FACTS
                  </span>
                  <EpistemologyBadge type="FACT" />
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '8px' }}>
                  {report.epistemological_breakdown.facts?.observed_stages_count || 0} stages
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {report.epistemological_breakdown.facts?.description || 'Empirically recorded timestamps.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--badge-variance-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--badge-variance-text)' }}>
                    VARIANCES
                  </span>
                  <EpistemologyBadge type="VARIANCE" />
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '8px' }}>
                  {report.epistemological_breakdown.variances?.stages_with_variance_count || 0} stages
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {report.epistemological_breakdown.variances?.description || 'Deviations from planned baseline SLA.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--badge-hypothesis-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--badge-hypothesis-text)' }}>
                    HYPOTHESES
                  </span>
                  <EpistemologyBadge type="HYPOTHESIS" />
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '8px' }}>
                  {report.epistemological_breakdown.hypotheses?.candidate_edges_count || 0} edges
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {report.epistemological_breakdown.hypotheses?.description || 'Synthesized causal chain candidates.'}
                </p>
              </Card>

              <Card padding="16px" style={{ borderLeft: '4px solid var(--badge-estimate-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--badge-estimate-text)' }}>
                    ESTIMATES
                  </span>
                  <EpistemologyBadge type="ESTIMATE" />
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '8px' }}>
                  {report.epistemological_breakdown.estimates?.total_estimated_delay_minutes || 0} min
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {report.epistemological_breakdown.estimates?.description || 'Projected downstream impact.'}
                </p>
              </Card>
            </div>
          )}

          {/* Missing Data Warnings */}
          {report.missing_data_warnings && report.missing_data_warnings.length > 0 && (
            <Alert type="warning" title="Data Completeness Notice">
              <ul style={{ margin: 0, paddingLeft: '18px' }}>
                {report.missing_data_warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}

          {/* Stage Duration Metrics Table */}
          <Card
            title="Stage Duration Variance Decomposition"
            subtitle="Observed durations compared against baseline SLA durations"
          >
            <Table
              columns={stageColumns}
              data={report.stage_metrics}
              keyExtractor={(s) => s.stage_id}
              emptyMessage="No stage metrics computed."
            />
          </Card>

          {/* Causal Chain / Delay Propagation Graph */}
          <Card
            title={`Synthesized Delay Graph (${report.delay_graph.length} Propagation Edges)`}
            subtitle="Causal hypotheses linking stage transitions and bottleneck propagation"
          >
            <Table
              columns={graphColumns}
              data={report.delay_graph}
              keyExtractor={(e, idx) => e.edge_id || idx}
              emptyMessage="No delay propagation edges identified."
            />
          </Card>
        </div>
      ) : (
        <Card>
          <div style={{ padding: '32px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)' }}>
              Select an order above and click &quot;Run Delay Analysis&quot; to synthesize delay graphs.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
};
