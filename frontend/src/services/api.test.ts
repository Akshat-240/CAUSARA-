import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setAuthToken,
  getAuthToken,
  clearAuthSession,
  registerUnauthorizedHandler,
  fetchOrders,
  fetchDecisionVerification,
} from './api';

describe('API Auth Integration & M2 Verification Handling', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAuthSession();
    registerUnauthorizedHandler(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('attaches Authorization Bearer token to authenticated API requests', async () => {
    setAuthToken('v1.testpayload.testsig');
    expect(getAuthToken()).toBe('v1.testpayload.testsig');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { total: 0, limit: 50, offset: 0, orders: [] },
        meta: { request_id: 'r1', timestamp: '2026-11-25T00:00:00Z' },
      }),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await fetchOrders();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer v1.testpayload.testsig');
  });

  it('clears auth session and triggers unauthorized handler on 401', async () => {
    setAuthToken('v1.expired.token');
    const onUnauthorized = vi.fn();
    registerUnauthorizedHandler(onUnauthorized);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Token expired' },
        meta: { request_id: 'r2', timestamp: '2026-11-25T00:00:00Z' },
      }),
    }) as unknown as typeof fetch;

    await expect(fetchOrders()).rejects.toThrow('Token expired');
    expect(getAuthToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('returns null cleanly when decision verification reports verified=false', async () => {
    setAuthToken('v1.valid.token');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { verified: false, decision_id: 7, decision_status: 'PENDING', verification: null },
        meta: { request_id: 'r3', timestamp: '2026-11-25T00:00:00Z' },
      }),
    }) as unknown as typeof fetch;

    const result = await fetchDecisionVerification(7);
    expect(result).toBeNull();
  });
});
