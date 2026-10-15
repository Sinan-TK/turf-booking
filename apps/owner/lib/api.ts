const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const PORTAL = 'owner';

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// The session lives in httpOnly cookies set by the API (JS never sees a
// token), so every request is sent with credentials. When the short-lived
// access cookie has expired the API answers 401; we then exchange the
// refresh cookie for a new pair (one refresh at a time, shared by all
// in-flight requests) and replay the original request once.
let refreshing: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/auth/${PORTAL}/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

const NO_REFRESH_PATH = /\/(login|refresh|logout|forgot-password|reset-password)$/;

function send(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res = await send(path, options);
  if (res.status === 401 && !NO_REFRESH_PATH.test(path) && (await refreshSession())) {
    res = await send(path, options);
  }

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => undefined)
    : undefined;

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body && String(body.message)) ||
      res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
