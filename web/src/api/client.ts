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

// ── Request activity ────────────────────────────────────────────────────────
// The app shows a progress bar while any request is running, so a click that
// waits on the server always gives visible feedback (see ActivityBar).
let activeRequests = 0;
const activityListeners = new Set<(active: number) => void>();
const emitActivity = () => activityListeners.forEach((fn) => fn(activeRequests));

/** Subscribe to the number of running requests; returns the unsubscribe function. */
export function onApiActivity(fn: (active: number) => void): () => void {
  activityListeners.add(fn);
  fn(activeRequests);
  return () => { activityListeners.delete(fn); };
}

// Only requests a person caused (started shortly after a click, tap or key)
// show the bar; background polling such as notifications does not.
let lastInteraction = 0;

// ── Activity, for the inactivity sign-out ──────────────────────────────────
// Any sign of a person (click, tap, key, scroll, mouse movement) counts. It is
// shared between tabs through localStorage, so working in one tab keeps the
// others signed in too. Requests sent within a minute of it carry
// X-User-Activity, which is what keeps the session alive on the server.
const ACTIVITY_KEY = 'ah_last_activity';
let lastActivity = Date.now();
let lastShared = 0;

/** Marks the person as active now (also called by "Stay signed in"). */
export function markActivity() {
  lastActivity = Date.now();
  if (lastActivity - lastShared > 5000) {
    lastShared = lastActivity;
    try { localStorage.setItem(ACTIVITY_KEY, String(lastActivity)); } catch { /* storage unavailable */ }
  }
}

/** The last time a person used the app, in any tab. */
export function getLastActivity(): number {
  let shared = 0;
  try { shared = Number(localStorage.getItem(ACTIVITY_KEY)) || 0; } catch { /* storage unavailable */ }
  return Math.max(lastActivity, shared);
}

const isRecentlyActive = () => Date.now() - getLastActivity() < 60_000;

if (typeof window !== 'undefined') {
  const note = () => { lastInteraction = Date.now(); markActivity(); };
  window.addEventListener('pointerdown', note, true);
  window.addEventListener('keydown', note, true);
  let moved = 0;
  const passive = () => { const now = Date.now(); if (now - moved > 2000) { moved = now; markActivity(); } };
  for (const ev of ['mousemove', 'wheel', 'scroll', 'touchstart']) window.addEventListener(ev, passive, { capture: true, passive: true });
}

function tracked<T>(work: () => Promise<T>): Promise<T> {
  if (Date.now() - lastInteraction > 1500) return work();
  activeRequests += 1;
  emitActivity();
  return work().finally(() => {
    activeRequests -= 1;
    emitActivity();
  });
}

/** fetch with the session cookie; a 401 means the session ended. */
function authorizedFetch(url: string, init: RequestInit, retryOnNetworkError = 0): Promise<Response> {
  return tracked(() => authorizedFetchOnce(url, init, retryOnNetworkError));
}

async function authorizedFetchOnce(url: string, init: RequestInit, retryOnNetworkError = 0): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i <= retryOnNetworkError; i += 1) {
    try {
      const res = await fetch(url, { ...init, credentials: 'same-origin', headers: buildHeaders(init.headers as Record<string, string>) });
      if (res.status === 401) {
        // Say why on the sign-in page when it was the inactivity rule.
        res.clone().json().then((b: any) => {
          if (b?.reason === 'idle') try { sessionStorage.setItem('ah_signout_reason', 'idle'); } catch { /* ignore */ }
        }).catch(() => {}).finally(() => sessionExpiredHandler?.());
      }
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
    ...(isRecentlyActive() ? { 'X-User-Activity': '1' } : {}),
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
// The same change sent again while the first is still running (a double
// click, a second tap while the screen waits) shares the first request instead
// of being applied twice.
const inFlightMutations = new Map<string, Promise<unknown>>();

function mutate<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const key = `${method} ${path} ${payload ?? ''}`;
  const existing = inFlightMutations.get(key);
  if (existing) return existing as Promise<T>;
  const request = (async () => {
    const response = await authorizedFetch(`${API_BASE_URL}${path}`, { method, body: payload });
    invalidateApiCache();
    return handleResponse<T>(response);
  })().finally(() => inFlightMutations.delete(key));
  inFlightMutations.set(key, request);
  return request;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return mutate<T>('POST', path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return mutate<T>('PATCH', path, body);
}

export function apiDelete<T = void>(path: string): Promise<T> {
  return mutate<T>('DELETE', path);
}

/**
 * Downloads a file the API produces (e.g. a CSV export) with the session
 * cookie, and saves it under the name the server gives.
 */
export async function apiDownload(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<void> {
  const res = await authorizedFetch(`${API_BASE_URL}${path}${buildQueryString(params)}`, { method: 'GET' });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;
    throw new ApiError(res.status, res.statusText, body);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
