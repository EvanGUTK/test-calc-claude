import type {
  AngleModeDto,
  ErrorResponse,
  EvaluateResponse,
  StateResponse,
  ValidateResponse,
} from '../api-types.ts';

/** A non-2xx API response, carrying the server's structured error. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: ErrorResponse['error'];

  constructor(status: number, detail: ErrorResponse['error']) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value as { error: unknown };
  return typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const payload: unknown = await response.json();
  if (!response.ok) {
    if (isErrorResponse(payload)) throw new ApiError(response.status, payload.error);
    throw new Error(`Request failed with status ${response.status}`);
  }
  return payload as T;
}

export function fetchState(): Promise<StateResponse> {
  return request('GET', '/api/state');
}

export function validate(input: string): Promise<ValidateResponse> {
  return request('POST', '/api/validate', { input });
}

export function evaluate(input: string, angleMode: AngleModeDto): Promise<EvaluateResponse> {
  return request('POST', '/api/evaluate', { input, angleMode });
}

export function deleteVariable(name: string): Promise<StateResponse> {
  return request('DELETE', `/api/variables/${encodeURIComponent(name)}`);
}

export function clearHistory(): Promise<StateResponse> {
  return request('DELETE', '/api/history');
}
