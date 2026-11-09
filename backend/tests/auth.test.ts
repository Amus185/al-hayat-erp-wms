// Authentication with Better Auth: session cookie, sign-in throttling,
// sign-out, revocation (password change, deactivation, ban), CSRF/CORS, the
// mobile bearer flow, existing passwords, and route protection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { setupTestApp, ADMIN_ID, BRANCH_HQ, TEST_AUTH_SECRET, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const ORIGIN = 'https://al-hayat-erp.pages.dev';
const COOKIE = '__Secure-better-auth.session_token';
const BROWSER = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Protection': '1' };

async function raw(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await t.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

const setCookieOf = (res: { headers: Headers }) => res.headers.getSetCookie().join('\n');
function sessionCookie(res: { headers: Headers }): string | null {
  const m = setCookieOf(res).match(new RegExp(`${COOKIE.replace('.', '\\.')}=([^;]*)`));
  return m && m[1] ? m[1] : null;
}

/** A staff user created through the ERP's Users API, as administrators do. */
async function makeUser(opts: { password?: string; roleIds?: string[]; branchId?: string | null } = {}) {
  const email = `u-${randomUUID().slice(0, 8)}@test.local`;
  const password = opts.password ?? `Pw-${randomUUID()}`;
  const res = await t.api('POST', '/users', {
    email, password, fullName: 'Auth Test',
    branchId: opts.branchId === undefined ? BRANCH_HQ : opts.branchId,
    roleIds: opts.roleIds ?? ['role-branch-user'],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id as string, email, password };
}

const signIn = (email: string, password: string, headers: Record<string, string> = BROWSER) =>
  raw('POST', '/api/auth/sign-in/email', { headers, body: { email, password } });

async function browserSignIn(email: string, password: string) {
  const res = await signIn(email, password);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const cookie = sessionCookie(res);
  assert.ok(cookie, 'no session cookie set');
  return { cookie: cookie!, res };
}

const withCookie = (cookie: string, extra: Record<string, string> = BROWSER) => ({ ...extra, Cookie: `${COOKIE}=${cookie}` });
const me = (cookie: string, extra: Record<string, string> = BROWSER) => raw('GET', '/api/v1/auth/me', { headers: withCookie(cookie, extra) });

test('browser sign-in: the session lives only in an HttpOnly, Secure, SameSite=Strict cookie', async () => {
  const u = await makeUser();
  const { cookie, res } = await browserSignIn(u.email, u.password);
  assert.equal(res.body.token, undefined, 'session token must not be readable by page script');
  assert.equal(res.headers.get('set-auth-token'), null, 'bearer token must not reach a browser');
  const sc = setCookieOf(res);
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(sc.includes(attr), `cookie lacks ${attr}: ${sc}`);
  assert.ok(!/Domain=/i.test(sc), 'host-only cookie must not set Domain');
  const who = await me(cookie);
  assert.equal(who.status, 200, JSON.stringify(who.body));
  assert.equal(who.body.user.email, u.email);
  assert.equal(who.body.user.branchId, BRANCH_HQ);
  // get-session through Better Auth does not leak the token either
  const session = await raw('GET', '/api/auth/get-session', { headers: withCookie(cookie) });
  assert.equal(session.status, 200);
  assert.equal(session.body.session.token, undefined);
});

test('passwords set before Better Auth keep working (bcrypt carried over)', async () => {
  const id = randomUUID();
  const email = `legacy-${id.slice(0, 8)}@test.local`;
  await t.q('INSERT INTO users (id, email, password_hash, full_name, branch_id) VALUES ($1, $2, $3, $4, $5)',
    [id, email, bcrypt.hashSync('Legacy-pass-123', 10), 'Legacy User', BRANCH_HQ]);
  await t.q('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [id, 'role-branch-user']);
  const { backfillIdentities } = await import('../src/services/identity');
  await backfillIdentities(t.pool);
  await backfillIdentities(t.pool); // idempotent
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM account WHERE "userId" = $1', [id]))[0].n, 1);
  const { cookie } = await browserSignIn(email, 'Legacy-pass-123');
  assert.equal((await me(cookie)).status, 200);
  // the seeded administrator got an identity too, with Better Auth's admin role
  assert.equal((await t.q('SELECT role FROM "user" WHERE id = $1', [ADMIN_ID]))[0].role, 'admin');
});

test('sign-in rejects bad credentials uniformly and throttles repeated failures', async () => {
  const u = await makeUser();
  const wrong = await signIn(u.email, 'nope-nope');
  const unknown = await signIn('nobody@test.local', 'nope-nope');
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, unknown.body, 'responses must not reveal whether the account exists');
  for (let i = 0; i < 10; i++) await signIn(u.email, 'nope-nope');
  const blocked = await signIn(u.email, u.password);
  assert.equal(blocked.status, 429, 'correct password still accepted after many failures');
});

test('self sign-up is off: staff accounts are created by administrators only', async () => {
  const res = await raw('POST', '/api/auth/sign-up/email', { headers: BROWSER, body: { email: 'new@test.local', password: 'Some-password-1', name: 'New' } });
  assert.ok(res.status >= 400 && res.status < 500, `sign-up answered ${res.status}`);
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM "user" WHERE email = 'new@test.local'`))[0].n, 0);
});

test('CSRF: cookie requests need our origin and the custom header; sign-in refuses foreign origins', async () => {
  const u = await makeUser();
  const { cookie } = await browserSignIn(u.email, u.password);
  const cases: Record<string, string>[] = [
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Protection': '1' },
    { 'Sec-Fetch-Site': 'cross-site', 'X-CSRF-Protection': '1' },
    { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }, // no custom header (e.g. a plain form post)
  ];
  for (const headers of cases) {
    const r = await raw('POST', '/api/v1/sales/customers', { headers: withCookie(cookie, headers), body: { name: 'CSRF' } });
    assert.equal(r.status, 403, `accepted ${JSON.stringify(headers)}`);
  }
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM customers WHERE name = 'CSRF'`))[0].n, 0);
  const foreign = await signIn(u.email, u.password, { Origin: 'https://evil.example' });
  assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
  // the session survived those attempts
  assert.equal((await me(cookie)).status, 200);
});

test('CORS: only allowed origins get CORS headers; unknown origins get none', async () => {
  const pre = (origin: string) => t.app.request('/api/v1/auth/me', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-csrf-protection,content-type' },
  });
  const evil = await pre('https://evil.example');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const good = await pre(ORIGIN);
  assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(good.headers.get('access-control-allow-credentials'), 'true');
  const get = await t.app.request('/api/v1/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
});

test('sign-out ends the session on the server', async () => {
  const u = await makeUser();
  const { cookie } = await browserSignIn(u.email, u.password);
  const out = await raw('POST', '/api/auth/sign-out', { headers: withCookie(cookie) });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookieOf(out)), 'cookie not cleared');
  assert.equal((await me(cookie)).status, 401);
});

test('logout-all ends every session of the user', async () => {
  const u = await makeUser();
  const a = await browserSignIn(u.email, u.password);
  const b = await browserSignIn(u.email, u.password);
  assert.equal((await raw('POST', '/api/v1/auth/logout-all', { headers: withCookie(a.cookie) })).status, 204);
  assert.equal((await me(a.cookie)).status, 401);
  assert.equal((await me(b.cookie)).status, 401);
});

test('a password change ends every existing session immediately', async () => {
  const u = await makeUser();
  const s = await browserSignIn(u.email, u.password);
  const changed = await t.api('POST', `/users/${u.id}/change-password`, { newPassword: 'A-new-password-123' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await me(s.cookie)).status, 401);
  assert.equal((await signIn(u.email, u.password)).status, 401);
  await browserSignIn(u.email, 'A-new-password-123');
});

test('deactivating a user ends their sessions and blocks sign-in', async () => {
  const u = await makeUser();
  const s = await browserSignIn(u.email, u.password);
  assert.equal((await t.api('PATCH', `/users/${u.id}`, { isActive: false })).status, 200);
  assert.equal((await me(s.cookie)).status, 401);
  const again = await signIn(u.email, u.password);
  assert.equal(again.status, 403, JSON.stringify(again.body));
  assert.equal(sessionCookie(again), null);
});

test('a ban (Layerbase "Disable user") cuts off live sessions and blocks sign-in', async () => {
  const u = await makeUser();
  const s = await browserSignIn(u.email, u.password);
  await t.q('UPDATE "user" SET banned = TRUE WHERE id = $1', [u.id]); // what the dashboard writes
  assert.equal((await me(s.cookie)).status, 401);
  assert.equal(sessionCookie(await signIn(u.email, u.password)), null);
  // a ban that has expired no longer applies
  await t.q(`UPDATE "user" SET "banExpires" = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [u.id]);
  const back = await browserSignIn(u.email, u.password);
  assert.equal((await me(back.cookie)).status, 200);
});

test('forged, foreign-signed and expired sessions are refused', async () => {
  const u = await makeUser();
  const { cookie } = await browserSignIn(u.email, u.password);
  const [token, signature] = decodeURIComponent(cookie).split('.');
  const cases = {
    unsignedCookie: token,
    tamperedSignature: encodeURIComponent(`${token}.${signature.slice(0, -2)}AA`),
    madeUp: encodeURIComponent(`${randomUUID()}.${signature}`),
  };
  for (const [name, value] of Object.entries(cases)) {
    assert.equal((await me(value)).status, 401, `${name} cookie was accepted`);
  }
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: { Authorization: 'Bearer not-a-session' } })).status, 401);
  await t.q(`UPDATE "session" SET "expiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "userId" = $1`, [u.id]);
  assert.equal((await me(cookie)).status, 401, 'expired session accepted');
  assert.notEqual(TEST_AUTH_SECRET, '');
});

test('authorization comes from the database, not from the client or Better Auth\'s role', async () => {
  const u = await makeUser();
  // claims passed to tokenFor are ignored by the server
  const forged = await t.tokenFor({ sub: u.id, role: 'admin', branch_id: null, permissions: ['manage_users', 'view_reports'] });
  assert.equal((await t.api('GET', '/users', undefined, forged)).status, 403);
  assert.equal((await t.api('GET', '/accounting/opening-balances', undefined, forged)).status, 403);
  // Better Auth's own role field grants nothing in the ERP
  await t.q(`UPDATE "user" SET role = 'admin' WHERE id = $1`, [u.id]);
  assert.equal((await t.api('GET', '/accounting/balance-sheet?branch_id=branch-cl-show', undefined, forged)).status, 403);
});

test('Better Auth\'s admin API cannot create users, set passwords or impersonate', async () => {
  const adminToken = t.adminToken;
  const victim = await makeUser();
  const call = (path: string, body: unknown) => raw('POST', `/api/auth/admin/${path}`, { headers: { Authorization: `Bearer ${adminToken}` }, body });
  // what it may do: list users (so the 403s below are permissions, not a broken call)
  const list = await raw('GET', '/api/auth/admin/list-users', { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal((await call('impersonate-user', { userId: victim.id })).status, 403);
  assert.equal((await call('set-user-password', { userId: victim.id, newPassword: 'Taken-over-123' })).status, 403);
  assert.equal((await call('create-user', { email: 'x@test.local', password: 'Some-pass-123', name: 'X' })).status, 403);
  assert.equal((await signIn(victim.email, victim.password)).status, 200);
});

test('a non-admin user manager cannot grant the admin role or take over an admin account', async () => {
  const mgrRole = `role-mgr-${randomUUID().slice(0, 6)}`;
  await t.q(`INSERT INTO roles (id, code, name) VALUES ($1, $1, 'User manager')`, [mgrRole]);
  await t.q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, '11111111-1111-1111-1111-111111111111')`, [mgrRole]);
  const mgr = await makeUser({ roleIds: [mgrRole] });
  const token = await t.tokenFor({ sub: mgr.id });
  const victim = await makeUser();
  assert.equal((await t.api('PATCH', `/users/${victim.id}`, { roleIds: ['77777777-7777-7777-7777-777777777777'] }, token)).status, 403);
  assert.equal((await t.api('POST', `/users/${ADMIN_ID}/change-password`, { newPassword: 'taken-over-123' }, token)).status, 403);
  assert.equal((await t.api('PATCH', `/users/${victim.id}`, { fullName: 'Renamed' }, token)).status, 200);
  assert.equal((await t.q('SELECT name FROM "user" WHERE id = $1', [victim.id]))[0].name, 'Renamed', 'identity not kept in step');
});

test('every API route except health and the public catalog requires a session', async () => {
  // Deliberately public: health and the storefront's read-only catalog.
  // POST /storefront/requests has no login but needs the server-to-server API key
  // (covered in storefront.test.ts). Sign-in itself is Better Auth's, under /api/auth.
  const PUBLIC = new Set([
    '/', '/api/v1/health',
    '/api/v1/storefront/categories', '/api/v1/storefront/products', '/api/v1/storefront/products/:slug', '/api/v1/storefront/requests',
  ]);
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

test('mobile: sign-in hands over a bearer token; a browser cannot obtain one', async () => {
  const u = await makeUser();
  const native = await signIn(u.email, u.password, { 'X-Client-Type': 'native' });
  assert.equal(native.status, 200, JSON.stringify(native.body));
  const token = native.headers.get('set-auth-token');
  assert.ok(token, 'no set-auth-token header for the native client');
  const who = await raw('GET', '/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(who.status, 200, JSON.stringify(who.body));
  // a page script adding the header still sends Origin, and gets nothing
  const spoof = await signIn(u.email, u.password, { ...BROWSER, 'X-Client-Type': 'native' });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.headers.get('set-auth-token'), null);
  assert.equal(spoof.body.token, undefined);
  const out = await raw('POST', '/api/auth/sign-out', { headers: { Authorization: `Bearer ${token}`, 'X-Client-Type': 'native' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('production refuses to run with a missing or weak auth secret', async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
  try {
    process.env.NODE_ENV = 'production';
    for (const secret of [undefined, 'short', 'dev-access-secret-1234567890123456']) {
      if (secret === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = secret;
      const res = await t.app.request('/api/v1/auth/me', { headers: BROWSER });
      assert.equal(res.status, 503, `served with secret ${secret === undefined ? '(unset)' : 'weak'}`);
      const signin = await t.app.request('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', ...BROWSER }, body: '{}' });
      assert.equal(signin.status, 503, `sign-in served with secret ${secret === undefined ? '(unset)' : 'weak'}`);
    }
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    process.env.BETTER_AUTH_SECRET = saved.BETTER_AUTH_SECRET;
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
  }
});

test('sessions end 30 days after sign-in however active they are (as before Better Auth)', async () => {
  const u = await makeUser();
  const { cookie } = await browserSignIn(u.email, u.password);
  // 29 days in, last extended 2 days ago: using it extends it, but only up to day 30.
  await t.q(`UPDATE "session" SET "createdAt" = CURRENT_TIMESTAMP - INTERVAL '29 days', "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '5 days' WHERE "userId" = $1`, [u.id]);
  assert.equal((await me(cookie)).status, 200);
  const [row] = await t.q(`SELECT EXTRACT(EPOCH FROM ("expiresAt" - CURRENT_TIMESTAMP)) AS left_s FROM "session" WHERE "userId" = $1`, [u.id]);
  assert.ok(Number(row.left_s) <= 24 * 3600 + 5, `extended past day 30: ${row.left_s}s left`);
  // Past day 30 it is refused even if its expiry says otherwise.
  await t.q(`UPDATE "session" SET "createdAt" = CURRENT_TIMESTAMP - INTERVAL '31 days', "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '6 days' WHERE "userId" = $1`, [u.id]);
  assert.equal((await me(cookie)).status, 401);
});

test('browser sessions end after 30 minutes without use; background requests do not count as use', async () => {
  const u = await makeUser();
  const { cookie } = await browserSignIn(u.email, u.password);
  const first = await me(cookie);
  assert.equal(first.status, 200);
  assert.equal(first.body.user.idleTimeoutMinutes, 30, 'the staff app learns the limit from the server');
  const [{ sid }] = await t.q(`SELECT id AS sid FROM "session" WHERE "userId" = $1`, [u.id]);
  const lastActive = async () => Number((await t.q(`SELECT EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - last_active_at) AS s FROM erp_session_activity WHERE session_id = $1`, [sid]))[0].s);
  const setIdle = (minutes: number) => t.q(`UPDATE erp_session_activity SET last_active_at = CURRENT_TIMESTAMP - make_interval(mins => $2) WHERE session_id = $1`, [sid, minutes]);

  // a background request (no activity header) does not keep the session alive
  await setIdle(10);
  assert.equal((await me(cookie)).status, 200);
  assert.ok(await lastActive() > 9 * 60, 'polling must not count as activity');
  // a request the person caused does
  assert.equal((await me(cookie, { ...BROWSER, 'X-User-Activity': '1' })).status, 200);
  assert.ok(await lastActive() < 5, 'a click counts as activity');

  // 36 minutes without use (30 + the grace for activity pings): signed out, and the session is gone
  await setIdle(36);
  const late = await me(cookie, { ...BROWSER, 'X-User-Activity': '1' });
  assert.equal(late.status, 401);
  assert.equal(late.body.reason, 'idle');
  assert.equal((await t.q(`SELECT COUNT(*)::int AS n FROM "session" WHERE id = $1`, [sid]))[0].n, 0);
  assert.equal((await me(cookie)).status, 401);
});

test('inactivity sign-out: mobile sessions are not affected, and SESSION_IDLE_MINUTES=0 turns it off', async () => {
  const u = await makeUser();
  const native = await signIn(u.email, u.password, { 'X-Client-Type': 'native' });
  const token = native.headers.get('set-auth-token');
  const [{ sid }] = await t.q(`SELECT id AS sid FROM "session" WHERE "userId" = $1`, [u.id]);
  await t.q(`INSERT INTO erp_session_activity (session_id, last_active_at) VALUES ($1, CURRENT_TIMESTAMP - INTERVAL '3 hours')`, [sid]);
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })).status, 200);

  const b = await makeUser();
  const { cookie } = await browserSignIn(b.email, b.password);
  await me(cookie);
  await t.q(`UPDATE erp_session_activity SET last_active_at = CURRENT_TIMESTAMP - INTERVAL '3 hours' WHERE session_id IN (SELECT id FROM "session" WHERE "userId" = $1)`, [b.id]);
  process.env.SESSION_IDLE_MINUTES = '0';
  try {
    assert.equal((await me(cookie)).status, 200);
  } finally {
    delete process.env.SESSION_IDLE_MINUTES;
  }
  assert.equal((await me(cookie)).status, 401, 'back on: the 3-hour-old session ends');
});

test('session cookie cache: with every browser cookie sent, revocation and deactivation still take effect at once', async () => {
  const u = await makeUser();
  const res = await signIn(u.email, u.password);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Everything the browser stores: the session token AND Better Auth's cached session data.
  const jar = res.headers.getSetCookie().map((c: string) => c.split(';')[0]).filter((c: string) => !c.endsWith('='));
  assert.ok(jar.some((c: string) => c.includes('session_data')), `the cache cookie is set: ${jar.join(' | ')}`);
  const all = { ...BROWSER, Cookie: jar.join('; ') };
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: all })).status, 200);

  // The session row is removed (signed out elsewhere / revoked): refused although the cache cookie is still valid.
  await t.q('DELETE FROM "session" WHERE "userId" = $1', [u.id]);
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: all })).status, 401, 'revoked session refused at once');

  // Deactivated: refused at once too.
  const again = await signIn(u.email, u.password);
  const jar2 = again.headers.getSetCookie().map((c: string) => c.split(';')[0]).filter((c: string) => !c.endsWith('='));
  const all2 = { ...BROWSER, Cookie: jar2.join('; ') };
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: all2 })).status, 200);
  await t.q('UPDATE users SET is_active = 0 WHERE id = $1', [u.id]);
  assert.equal((await raw('GET', '/api/v1/auth/me', { headers: all2 })).status, 401, 'deactivated user refused at once');
});
