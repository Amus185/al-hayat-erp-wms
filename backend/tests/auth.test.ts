// Authentication: sessions, refresh-token rotation and reuse detection,
// logout, revocation, CSRF/CORS, and route protection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import { setupTestApp, ADMIN_ID, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const ORIGIN = 'https://al-hayat-erp.pages.dev';
const COOKIE = '__Host-ah_rt';
const BROWSER = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Protection': '1' };

async function raw(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await t.app.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

const setCookieOf = (res: { headers: Headers }) => res.headers.get('set-cookie') || '';
function refreshCookie(res: { headers: Headers }): string | null {
  const m = setCookieOf(res).match(new RegExp(`${COOKIE}=([^;]*)`));
  return m && m[1] ? m[1] : null;
}

async function makeUser(opts: { password?: string; roleId?: string; branchId?: string | null } = {}) {
  const id = randomUUID();
  const email = `u-${id.slice(0, 8)}@test.local`;
  const password = opts.password ?? `Pw-${randomUUID()}`;
  await t.q('INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, $3, $4, $5)',
    [id, email, bcrypt.hashSync(password, 4), 'Auth Test', opts.branchId === undefined ? BRANCH_HQ : opts.branchId]);
  await t.q('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, opts.roleId ?? 'role-branch-user']);
  return { id, email, password };
}

async function browserLogin(email: string, password: string) {
  const res = await raw('POST', '/auth/login', { headers: BROWSER, body: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { access: res.body.accessToken as string, cookie: refreshCookie(res)!, res };
}

const refresh = (cookie: string, extra: Record<string, string> = {}) =>
  raw('POST', '/auth/refresh', { headers: { ...BROWSER, Cookie: `${COOKIE}=${cookie}`, ...extra } });
const me = (access: string) => raw('GET', '/auth/me', { headers: { Authorization: `Bearer ${access}` } });

test('browser login: refresh token only in an HttpOnly, Secure, SameSite=Strict host cookie', async () => {
  const u = await makeUser();
  const { access, cookie, res } = await browserLogin(u.email, u.password);
  assert.equal(res.body.refreshToken, undefined, 'refresh token must not be readable by page script');
  assert.ok(cookie, 'no refresh cookie set');
  const sc = setCookieOf(res);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(sc.includes(attr), `cookie lacks ${attr}: ${sc}`);
  assert.ok(!/Domain=/i.test(sc), 'host-only cookie must not set Domain');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const who = await me(access);
  assert.equal(who.status, 200);
  assert.equal(who.body.user.email, u.email);
});

test('login rejects bad credentials uniformly and throttles repeated failures', async () => {
  const u = await makeUser();
  const wrong = await raw('POST', '/auth/login', { headers: BROWSER, body: { email: u.email, password: 'nope' } });
  const unknown = await raw('POST', '/auth/login', { headers: BROWSER, body: { email: 'nobody@test.local', password: 'nope' } });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body, 'responses must not reveal whether the account exists');
  for (let i = 0; i < 10; i++) await raw('POST', '/auth/login', { headers: BROWSER, body: { email: u.email, password: 'nope' } });
  const blocked = await raw('POST', '/auth/login', { headers: BROWSER, body: { email: u.email, password: u.password } });
  assert.equal(blocked.status, 429, 'correct password still accepted after many failures');
});

test('CSRF: cookie endpoints refuse foreign origins, cross-site requests and missing CSRF header', async () => {
  const u = await makeUser();
  const { cookie } = await browserLogin(u.email, u.password);
  const cases: Record<string, string>[] = [
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Protection': '1' },
    { 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Protection': '1' },
    { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }, // no custom header (e.g. a plain form post)
  ];
  for (const headers of cases) {
    for (const path of ['/auth/refresh', '/auth/logout', '/auth/login']) {
      const r = await raw('POST', path, { headers: { ...headers, Cookie: `${COOKIE}=${cookie}` }, body: { email: u.email, password: u.password } });
      assert.equal(r.status, 403, `${path} accepted ${JSON.stringify(headers)}`);
    }
  }
  // the session survived those attempts
  assert.equal((await refresh(cookie)).status, 200);
});

test('CORS: only allowed origins get CORS headers; unknown origins get none', async () => {
  const pre = (origin: string) => t.app.request('/api/v1/auth/refresh', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-csrf-protection,content-type' },
  });
  const evil = await pre('https://evil.example');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const good = await pre(ORIGIN);
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(good.headers.get('access-control-allow-credentials'), 'true');
  const get = await t.app.request('/api/v1/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
});

test('page reload: the cookie alone restores the session and rotates the refresh token', async () => {
  const u = await makeUser();
  const { cookie } = await browserLogin(u.email, u.password);
  const r1 = await refresh(cookie);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.user.email, u.email);
  const next = refreshCookie(r1)!;
  assert.ok(next && next !== cookie, 'refresh token was not rotated');
  assert.equal((await me(r1.body.accessToken)).status, 200);
  const r2 = await refresh(next);
  assert.equal(r2.status, 200);
});

test('concurrent refreshes with one cookie: one wins, the other gets 409 and the session survives', async () => {
  const u = await makeUser();
  const { cookie } = await browserLogin(u.email, u.password);
  const results = await Promise.all([refresh(cookie), refresh(cookie), refresh(cookie)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409], JSON.stringify(results.map((r) => r.body)));
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.code === 'REFRESH_RACE'));
  const winner = results.find((r) => r.status === 200)!;
  assert.equal((await refresh(refreshCookie(winner)!)).status, 200, 'session was revoked by a benign race');
});

test('refresh-token reuse after the grace window ends the whole session', async () => {
  const u = await makeUser();
  const { cookie } = await browserLogin(u.email, u.password);
  const r1 = await refresh(cookie);
  const stolenUse = refreshCookie(r1)!;
  // the old token was rotated more than the grace window ago
  await t.q(`UPDATE refresh_tokens SET used_at = CURRENT_TIMESTAMP - INTERVAL '5 minutes' WHERE used_at IS NOT NULL AND user_id = $1`, [u.id]);
  const replay = await refresh(cookie);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'REUSE_DETECTED');
  // the legitimate holder is logged out too: both the newest refresh token and the access token die
  assert.equal((await refresh(stolenUse)).status, 401);
  assert.equal((await me(r1.body.accessToken)).status, 401);
});

test('logout ends the session on the server: access token and refresh cookie stop working', async () => {
  const u = await makeUser();
  const { access, cookie } = await browserLogin(u.email, u.password);
  const out = await raw('POST', '/auth/logout', { headers: { ...BROWSER, Cookie: `${COOKIE}=${cookie}` } });
  assert.equal(out.status, 204);
  assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookieOf(out)), 'cookie not cleared');
  assert.equal((await me(access)).status, 401);
  assert.equal((await refresh(cookie)).status, 401);
});

test('logout-all ends every session of the user', async () => {
  const u = await makeUser();
  const a = await browserLogin(u.email, u.password);
  const b = await browserLogin(u.email, u.password);
  assert.equal((await raw('POST', '/auth/logout-all', { headers: { ...BROWSER, Authorization: `Bearer ${a.access}` } })).status, 204);
  assert.equal((await me(b.access)).status, 401);
  assert.equal((await refresh(b.cookie)).status, 401);
});

test('a password change ends every existing session immediately', async () => {
  const u = await makeUser();
  const s = await browserLogin(u.email, u.password);
  const changed = await t.api('POST', `/users/${u.id}/change-password`, { newPassword: 'A-new-password-123' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await me(s.access)).status, 401);
  assert.equal((await refresh(s.cookie)).status, 401);
  assert.equal((await raw('POST', '/auth/login', { headers: BROWSER, body: { email: u.email, password: u.password } })).status, 401);
  await browserLogin(u.email, 'A-new-password-123');
});

test('deactivating a user ends their sessions', async () => {
  const u = await makeUser();
  const s = await browserLogin(u.email, u.password);
  assert.equal((await t.api('PATCH', `/users/${u.id}`, { isActive: false })).status, 200);
  assert.equal((await me(s.access)).status, 401);
  assert.equal((await refresh(s.cookie)).status, 401);
});

test('access tokens: expired, foreign-signed, pre-session and wrong-type tokens are refused', async () => {
  const u = await makeUser();
  const { access } = await browserLogin(u.email, u.password);
  const sid = JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).sid;
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    expired: await sign({ sub: u.id, sid, typ: 'access', pwd_ver: 1, exp: now - 5 }, 'test-access-secret', 'HS256'),
    wrongSecret: await sign({ sub: u.id, sid, typ: 'access', pwd_ver: 1, exp: now + 600 }, 'attacker-secret', 'HS256'),
    noSession: await sign({ sub: u.id, typ: 'access', pwd_ver: 1, exp: now + 600 }, 'test-access-secret', 'HS256'),
    otherUsersSession: await sign({ sub: ADMIN_ID, sid, typ: 'access', pwd_ver: 1, exp: now + 600 }, 'test-access-secret', 'HS256'),
    refreshTyped: await sign({ sub: u.id, sid, typ: 'refresh', pwd_ver: 1, exp: now + 600 }, 'test-access-secret', 'HS256'),
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal((await me(token)).status, 401, `${name} token was accepted`);
  }
});

test('authorization comes from the database, not from token or browser claims', async () => {
  const u = await makeUser();
  // a branch user forging admin claims in their own (validly signed) token
  const forged = await t.tokenFor({ sub: u.id, role: 'admin', branch_id: null, permissions: ['manage_users', 'view_reports'] });
  assert.equal((await t.api('GET', '/users', undefined, forged)).status, 403);
  assert.equal((await t.api('GET', '/accounting/opening-balances', undefined, forged)).status, 403);
  assert.equal((await t.api('GET', '/accounting/balance-sheet?branch_id=branch-cl-show', undefined, forged)).status, 403);
});

test('a non-admin user manager cannot grant the admin role or take over an admin account', async () => {
  const mgrRole = `role-mgr-${randomUUID().slice(0, 6)}`;
  await t.q(`INSERT INTO roles (id, code, name) VALUES ($1, $1, 'User manager')`, [mgrRole]);
  await t.q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, '11111111-1111-1111-1111-111111111111')`, [mgrRole]);
  const mgr = await makeUser({ roleId: mgrRole });
  const token = await t.tokenFor({ sub: mgr.id });
  const victim = await makeUser();
  assert.equal((await t.api('PATCH', `/users/${victim.id}`, { roleIds: ['77777777-7777-7777-7777-777777777777'] }, token)).status, 403);
  assert.equal((await t.api('POST', `/users/${ADMIN_ID}/change-password`, { newPassword: 'taken-over-123' }, token)).status, 403);
  assert.equal((await t.api('PATCH', `/users/${victim.id}`, { fullName: 'Renamed' }, token)).status, 200);
});

test('every API route except sign-in and health requires a valid access token', async () => {
  const PUBLIC = new Set(['/', '/api/v1/health', '/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout']);
  const routes = t.app.routes.filter((r: any) => r.method !== 'ALL' && !PUBLIC.has(r.path) && r.path.startsWith('/api/v1/'));
  assert.ok(routes.length > 100, `only ${routes.length} routes found`);
  const open: string[] = [];
  for (const r of routes) {
    const path = r.path.replace(/:[^/]+/g, 'x').replace(/\*/g, 'x');
    const res = await t.app.request(path, { method: r.method, headers: { 'Content-Type': 'application/json' }, body: ['GET', 'HEAD'].includes(r.method) ? undefined : '{}' });
    if (res.status !== 401) open.push(`${r.method} ${r.path} -> ${res.status}`);
  }
  assert.deepEqual(open, [], 'routes reachable without authentication');
});

test('native clients: refresh token in the body (for secure device storage), rotation and reuse detection', async () => {
  const u = await makeUser();
  const login = await raw('POST', '/auth/login', { headers: { 'X-Client-Type': 'native' }, body: { email: u.email, password: u.password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.ok(login.body.refreshToken);
  assert.equal(setCookieOf(login), '', 'native clients must not get a cookie');
  const r1 = await raw('POST', '/auth/refresh', { headers: { 'X-Client-Type': 'native' }, body: { refreshToken: login.body.refreshToken } });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refreshToken, login.body.refreshToken);
  await t.q(`UPDATE refresh_tokens SET used_at = CURRENT_TIMESTAMP - INTERVAL '5 minutes' WHERE used_at IS NOT NULL AND user_id = $1`, [u.id]);
  const replay = await raw('POST', '/auth/refresh', { headers: { 'X-Client-Type': 'native' }, body: { refreshToken: login.body.refreshToken } });
  assert.equal(replay.status, 401);
  assert.equal((await me(r1.body.accessToken)).status, 401);
  // a browser cannot use the native path to bypass the cookie's protections: it gets no cookie
  const out = await raw('POST', '/auth/logout', { headers: { 'X-Client-Type': 'native' }, body: { refreshToken: r1.body.refreshToken } });
  assert.equal(out.status, 204);
});

test('production refuses to run with a missing or weak signing secret', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET };
  try {
    process.env.NODE_ENV = 'production';
    for (const secret of [undefined, 'short', 'dev-access-secret-1234567890123456']) {
      if (secret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = secret;
      const res = await t.app.request('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...BROWSER }, body: '{}' });
      assert.equal(res.status, 503, `served with secret ${secret === undefined ? '(unset)' : 'weak'}`);
    }
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    process.env.JWT_ACCESS_SECRET = saved.JWT_ACCESS_SECRET;
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
  }
});
