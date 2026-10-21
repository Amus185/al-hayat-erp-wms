// ─── Al Hayat ERP+WMS — API Client ───
// Authentication model (see docs/audit/AUTHENTICATION.md):
// - The access token lives only in memory (this module). It is never written
//   to localStorage/sessionStorage, so it disappears when the tab closes.
// - The refresh token is an HttpOnly cookie script cannot read. In production
//   the API is reached same-origin at /api/v1 through the Pages proxy.
// - On reload, or when the access token expires, the client calls
//   /auth/refresh once (shared across tabs) and retries the request.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const GET_CACHE_TTL = 30_000;
const CACHEABLE_PATHS = ['/categories', '/branches', '/warehouses', '/accounting/fiscal-periods', '/accounting/chart-of-accounts'];
const getCache = new Map<string, { expiresAt: number; value: unknown }>();
const inFlightGets = new Map<string, Promise<unknown>>();

// Legacy builds kept tokens in localStorage; remove them on load.
try {
  for (const key of ['access_token', 'refresh_token', 'auth_user']) localStorage.removeItem(key);
} catch { /* storage unavailable */ }

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Called once when the session cannot be renewed (signed out elsewhere, expired, revoked). */
export function onSessionExpired(handler: () => void) {
  sessionExpiredHandler = handler;
}

/** Headers for cookie-bearing auth calls: proves the request comes from our page (CSRF). */
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' };

export interface AuthSession<U = unknown> { accessToken: string; expiresIn: number; user: U }

let refreshInFlight: Promise<AuthSession | null> | null = null;

async function refreshOnce(): Promise<AuthSession | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: AUTH_HEADERS });
    if (res.ok) {
      const session = await res.json() as AuthSession;
      accessToken = session.accessToken;
      return session;
    }
    // 409: another tab/request rotated the cookie a moment ago; its response
    // set the new cookie, so try again with it.
    if (res.status === 409) { await new Promise((r) => setTimeout(r, 150 * (attempt + 1))); continue; }
    break;
  }
  accessToken = null;
  return null;
}

/**
 * Renew the session from the refresh cookie. Concurrent callers in this tab
 * share one request; across tabs a Web Lock serialises them, so one cookie
 * is rotated once.
 */
export function refreshSession<U = unknown>(): Promise<AuthSession<U> | null> {
  if (!refreshInFlight) {
    const run = () => refreshOnce();
    const locks = (typeof navigator !== 'undefined' ? (navigator as any).locks : undefined);
    refreshInFlight = (locks ? locks.request('al-hayat-auth-refresh', run) : run())
      .finally(() => { refreshInFlight = null; }) as Promise<AuthSession | null>;
  }
  return refreshInFlight as Promise<AuthSession<U> | null>;
}

export async function loginRequest<U>(credentials: { email: string; password: string }): Promise<AuthSession<U>> {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST', credentials: 'include', headers: AUTH_HEADERS, body: JSON.stringify(credentials),
  });
  const body = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, res.statusText, body);
  accessToken = (body as AuthSession).accessToken;
  return body as AuthSession<U>;
}

/** End this session on the server and forget the in-memory token. */
export async function logoutRequest(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include', headers: AUTH_HEADERS });
  } finally {
    accessToken = null;
    invalidateApiCache();
  }
}

/**
 * fetch with the access token; on 401, renew the session once and retry.
 * If the session cannot be renewed the user is sent to sign in.
 */
async function authorizedFetch(url: string, init: RequestInit, retryOnNetworkError = 0): Promise<Response> {
  const attempt = async () => {
    let lastError: unknown;
    for (let i = 0; i <= retryOnNetworkError; i += 1) {
      try {
        return await fetch(url, { ...init, credentials: 'same-origin', headers: buildHeaders(init.headers as Record<string, string>) });
      } catch (error) {
        lastError = error;
        if (i < retryOnNetworkError) await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
      }
    }
    throw lastError;
  };
  let res = await attempt();
  if (res.status === 401) {
    const renewed = await refreshSession();
    if (renewed) {
      res = await attempt();
    }
    if (res.status === 401) {
      accessToken = null;
      sessionExpiredHandler?.();
    }
  }
  return res;
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    // authorizedFetch already tried to renew the session and notified the app
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
