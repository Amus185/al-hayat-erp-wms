// ─── Al Hayat ERP+WMS — API Client ───
// Authentication model: staff sign in with Better Auth (src/lib/auth-client.ts),
// which keeps the session in an HttpOnly, SameSite=Strict cookie that script
// cannot read. In production the API is reached same-origin at /api/v1
// through the Pages proxy, so the cookie goes with every request. Each request
// also carries X-CSRF-Protection, which the server requires for cookie
// sessions (a cross-site page cannot add it).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const GET_CACHE_TTL = 30_000;
const CACHEABLE_PATHS = ['/categories', '/branches', '/warehouses', '/accounting/fiscal-periods', '/accounting/chart-of-accounts'];
const getCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

// Legacy builds kept tokens in localStorage; remove them on load.
try {
  for (const key of ['access_token', 'refresh_token', 'auth_user']) localStorage.removeItem(key);
} catch { /* storage unavailable */ }

let sessionExpiredHandler: (() => void) | null = null;

/** Called when the session has ended (signed out elsewhere, expired, revoked). */
export function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

/** The signed-in user's ERP profile, or null when there is no live session. */
export async function fetchProfile<U>(): Promise<U | null> {
  const res = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'same-origin', headers: buildHeaders() });
  if (!res.ok) return null;
  const body = await res.json() as { user: U };
  return body.user;
}

/** fetch with the session cookie; a 401 means the session ended. */
async function authorizedFetch(url: string, init: RequestInit, retryOnNetworkError = 0): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i <= retryOnNetworkError; i += 1) {
    try {
      const res = await fetch(url, { ...init, credentials: 'same-origin', headers: buildHeaders(init.headers as Record<string, string>) });
      if (res.status === 401) sessionExpiredHandler?.();
      return res;
    } catch (error) {
      lastError = error;
      if (i < retryOnNetworkError) await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastError;
}

async function fetchGetWithRetry(url: string, attempts = 2): Promise<Response> {
  return authorizedFetch(url, { method: 'GET' }, attempts);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: Record<string, unknown> | null
  ) {
    const detailsList = Array.isArray(body?.details) ? (body!.details as string[]) : undefined;
    const detailSuffix = detailsList && detailsList.length > 0 ? ` Details: ${detailsList.join('; ')}` : '';
    super((body?.message as string ?? `API error ${status}: ${statusText}`) + detailSuffix);
    this.name = 'ApiError';
  }
}

function buildHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-CSRF-Protection': '1',
    ...extra,
  };
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    // authorizedFetch already notified the app
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
  const response = await authorizedFetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}

export async function apiPatch<T>(
  path: string,
  body?: unknown
): Promise<T> {
  const response = await authorizedFetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}

export async function apiDelete<T = void>(
  path: string
): Promise<T> {
  const response = await authorizedFetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
  });
  invalidateApiCache();
  return handleResponse<T>(response);
}
