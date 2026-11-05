import React, { useEffect, useState } from 'react';
import { fetchHealth } from './services/api';
import { HealthData } from './types/api';
import './App.css';

export const App: React.FC = () => {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const checkConnectivity = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHealth();
      setHealth(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect to backend service';
      setError(message);
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConnectivity();
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">
          Caus<span>ara</span>
        </h1>
        <p className="app-subtitle">
          Explainable Order Delay Intelligence & Intervention Analysis Platform
        </p>
      </header>

      <main>
        <section className="status-card" aria-label="System Connectivity Status">
          <div className="status-card-header">
            <h2>Backend API Connectivity</h2>
            <div
              className={`status-badge ${loading ? 'loading' : error ? 'error' : 'healthy'}`}
              role="status"
            >
              <span className="status-dot" aria-hidden="true"></span>
              <span>
                {loading ? 'Checking Connection...' : error ? 'Disconnected' : 'Operational'}
              </span>
            </div>
          </div>

          {loading && <p>Probing backend health endpoint at /api/v1/health...</p>}

          {error && (
            <div>
              <p className="error-message">Connection Error: {error}</p>
              <p className="detail-label" style={{ marginTop: '0.5rem' }}>
                Ensure the Flask backend is running on port 5000.
              </p>
            </div>
          )}

          {health && (
            <div className="details-grid">
              <div className="detail-item">
                <span className="detail-label">Service</span>
                <span className="detail-value">{health.service}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Status</span>
                <span className="detail-value">{health.status}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">API Version</span>
                <span className="detail-value">{health.version}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Environment</span>
                <span className="detail-value">{health.environment}</span>
              </div>
            </div>
          )}

          <div className="actions">
            <button
              className="btn-refresh"
              onClick={checkConnectivity}
              disabled={loading}
              type="button"
            >
              {loading ? 'Verifying...' : 'Test Connection'}
            </button>
          </div>
        </section>
      </main>

      <footer className="footer-info">
        <p>Milestone M0: Application Foundation | React + TypeScript + Flask REST API</p>
      </footer>
    </div>
  );
};

export default App;
