const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

import { describeApiError } from './api-error';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include', // sends the httpOnly customer_session cookie set by POST /customer-auth/verify
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => undefined)
    : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, describeApiError(body, res.statusText), body);
  }

  return body as T;
}

/** A page of a list: the rows, and where the next page starts (null when this was the last). */
export interface Page<T> {
  data: T;
  nextCursor: string | null;
  /** For search: how many days the day picker should offer (the venues' "book up to n days ahead"). */
  advanceDays: number | null;
  /** For paged lists: how many rows there are in all (X-Total-Count). */
  total?: number | null;
}

async function requestPage<T>(path: string): Promise<Page<T>> {
  const res = await fetch(`${API_URL}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  const body = (await res.json().catch(() => undefined)) as unknown;
  if (!res.ok) {
    throw new ApiError(res.status, describeApiError(body, res.statusText), body);
  }
  const advance = Number(res.headers.get('X-Advance-Days'));
  return { data: body as T, nextCursor: res.headers.get('X-Next-Cursor'), advanceDays: Number.isInteger(advance) && advance > 0 ? advance : null, total: res.headers.get('X-Total-Count') !== null ? Number(res.headers.get('X-Total-Count')) : null };
}

export const api = {
  getPage: <T>(path: string) => requestPage<T>(path),
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
