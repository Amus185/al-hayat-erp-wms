// ─── Al Hayat ERP+WMS — API Client ───
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const GET_CACHE_TTL = 30_000;
const CACHEABLE_PATHS = ['/categories', '/branches', '/warehouses', '/accounting/fiscal-periods', '/accounting/chart-of-accounts'];
const getCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

async function fetchGetWithRetry(url: string, attempts = 2): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, { method: 'GET', headers: buildHeaders() });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: Record<string, unknown> | null
  ) {
    super(body?.message as string ?? `API error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

function getToken(): string | null {
  return localStorage.getItem('access_token');
}

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_user');
    // Redirect to login if not already there
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Unauthorized', null);
  }

  let body: Record<string, unknown> | null = null;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    body = await response.json();
  }

  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, body);
  }

  return body as T;
}

function buildQueryString(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function apiGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const qs = buildQueryString(params);
  const url = `${API_BASE_URL}${path}${qs}`;
  const cacheable = CACHEABLE_PATHS.some((candidate) => path === candidate);
  const cached = getCache.get(url);
  if (cacheable && cached && cached.expiresAt > Date.now()) return cached.value as T;
  const existing = inFlightGets.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetchGetWithRetry(url)
    .then(handleResponse<T>)
    .then((data) => {
      if (cacheable) getCache.set(url, { value: data, expiresAt: Date.now() + GET_CACHE_TTL });
      return data;
    })
    .finally(() => inFlightGets.delete(url));
  inFlightGets.set(url, request);
  return request;
}

/** Call after a mutation when a cached lookup may have changed. */
export function invalidateApiCache(path?: string) {
  for (const key of getCache.keys()) {
    if (!path || key.includes(path)) getCache.delete(key);
  }
}
export async function apiPost<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}

export async function apiPatch<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: buildHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}

export async function apiDelete<T = void>(
  path: string
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}

// Unauthenticated POST (for login)
export async function apiPublicPost<T>(
  path: string,
  body: unknown
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> | null = null;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    parsed = await response.json();
  }
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText, parsed);
  }
  return parsed as T;
}
