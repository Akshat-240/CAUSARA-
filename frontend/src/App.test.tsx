import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from './App';
import * as api from './services/api';

describe('Causara Application Shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Causara title and description', async () => {
    vi.spyOn(api, 'fetchHealth').mockResolvedValueOnce({
      status: 'healthy',
      service: 'causara-api',
      version: '1.0.0',
      environment: 'development',
    });

    render(<App />);
    expect(screen.getByText(/Caus/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Explainable Order Delay Intelligence & Intervention Analysis Platform/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Operational')).toBeInTheDocument();
      expect(screen.getByText('causara-api')).toBeInTheDocument();
    });
  });

  it('displays error state when backend is unreachable', async () => {
    vi.spyOn(api, 'fetchHealth').mockRejectedValueOnce(
      new Error('Connection refused')
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(screen.getByText(/Connection Error: Connection refused/i)).toBeInTheDocument();
    });
  });
});
