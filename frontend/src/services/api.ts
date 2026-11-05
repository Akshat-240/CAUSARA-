import { HealthData, HealthResponse, ApiErrorResponse } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/**
 * Fetch service health status from backend REST API.
 */
export async function fetchHealth(): Promise<HealthData> {
  const url = `${API_BASE_URL}/health`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status} (${response.statusText})`;
    try {
      const errorJson: ApiErrorResponse = await response.json();
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // Fallback to HTTP status
    }
    throw new Error(errorMessage);
  }

  const json: HealthResponse = await response.json();
  return json.data;
}
