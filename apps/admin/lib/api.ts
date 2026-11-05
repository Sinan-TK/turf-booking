const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const PORTAL = 'admin';

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

let sessionEnded: (() => void) | null = null;

/** The app's reaction to "you are no longer signed in" (a request refused even after a refresh). Pass null to remove it. */
export function onSessionEnded(handler: (() => void) | null): void {
  sessionEnded = handler;
}

const NO_REFRESH_PATH =/\/(login|refresh|logout|forgot-password|reset-password)$/;

function send(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    // A file upload (FormData) sets its own multipart Content-Type, boundary included.
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  onResponse?: (res: Response) => void,
): Promise<T> {
  let res = await send(path, options);
  if (res.status === 401 && !NO_REFRESH_PATH.test(path)) {
    if (await refreshSession()) res = await send(path, options);
    // Still refused after a refresh: the login was blocked, or the session ended. Tell the app, which sends the person to sign in.
    if (res.status === 401) sessionEnded?.();
  }

  onResponse?.(res);

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
  /** GET a plain-text answer (a list to copy). */
  getText: async (path: string): Promise<string> => {
    let res = await send(path, {});
    if (res.status === 401 && (await refreshSession())) res = await send(path, {});
    if (!res.ok) throw new ApiError(res.status, res.statusText, undefined);
    return res.text();
  },
  /** GET a page of a list: the rows plus the total match count the API
   * reports in the X-Total-Count header. */
  getPage: async <T>(path: string): Promise<{ rows: T[]; total: number }> => {
    let total: number | null = null;
    const rows = await request<T[]>(path, {}, (res) => {
      const header = res.headers.get('x-total-count');
      total = header === null ? null : Number(header);
    });
    return { rows, total: total ?? rows.length };
  },
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** POST a multipart form (a file upload). */
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};
