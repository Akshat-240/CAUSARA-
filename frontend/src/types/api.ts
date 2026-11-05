/**
 * Causara standardized API response and health data types.
 */

export interface ApiMeta {
  request_id: string;
  timestamp: string;
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
  meta: ApiMeta;
}

export interface HealthData {
  status: string;
  service: string;
  version: string;
  environment: string;
}

export type HealthResponse = ApiSuccessResponse<HealthData>;
