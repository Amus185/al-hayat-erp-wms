import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import * as bcrypt from 'bcryptjs';
import { Env } from '../db';
import { authMiddleware } from '../middleware/auth';
import { isAllowedOrigin } from '../security-config';
import {
  ACCESS_TOKEN_TTL_S, REFRESH_TOKEN_TTL_S, type ClientType,
  createSession, rotateRefreshToken, sessionOfRefreshToken, revokeSession,
  signAccessToken, poolOf, isLoginThrottled, recordLoginFailure, clearLoginFailures,
} from '../services/auth-sessions';

const auth = new Hono<{ Bindings: Env }>();

// Browser refresh token: HttpOnly (no script access), Secure, SameSite=Strict,
// host-only (__Host- prefix: no Domain, Path=/). The browser reaches the API
// same-origin through the Cloudflare Pages proxy (web/functions/api), so this
// is a first-party cookie. Native clients never receive it.
const REFRESH_COOKIE = 'ah_rt';
const cookieOptions = {
  prefix: 'host' as const,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Strict' as const,
  maxAge: REFRESH_TOKEN_TTL_S,
};

// A fixed bcrypt hash so a login for an unknown email costs the same time
// as one for a known email (no account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-placeholder', 10);

const clientTypeOf = (c: Context): ClientType => (c.req.header('X-Client-Type') === 'native' ? 'native' : 'browser');
const clientIp = (c: Context) =>
  c.req.header('x-real-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;

/**
 * Cookie-bearing browser requests (login, refresh, logout) must prove they
 * come from our own page, not a cross-site form or script:
 * - Origin, when sent, must be an allowed origin;
 * - Sec-Fetch-Site, when sent, must not be cross-site/same-site from elsewhere;
 * - a custom header must be present (a cross-site page cannot add it without a
 *   CORS preflight, which the allow-list refuses).
 * SameSite=Strict is an additional layer, not the only one.
 */
function csrfRejection(c: Context): string | null {
  const origin = c.req.header('origin');
  if (origin && !isAllowedOrigin(origin)) return 'Origin not allowed';
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none' && !(origin && isAllowedOrigin(origin))) return 'Cross-site request refused';
  if (c.req.header('x-csrf-protection') !== '1') return 'Missing CSRF protection header';
  return null;
}

async function loadProfile(c: Context, userId: string) {
  const r = await poolOf(c).query(`
    SELECT u.id, u.email, u.full_name, u.branch_id, COALESCE(u.password_version, 1) AS pwd_ver,
           (SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = u.id
             ORDER BY (r.code = 'admin') DESC, (r.code = 'accountant') DESC, r.code LIMIT 1) AS role_code,
           (SELECT STRING_AGG(DISTINCT p.code, ',') FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id = ur.role_id
              JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) AS permissions
    FROM users u WHERE u.id = $1 AND u.is_active = 1`, [userId]);
  const u = r.rows[0];
  if (!u) return null;
  return {
    pwdVer: Number(u.pwd_ver),
    user: {
      id: u.id as string,
      email: u.email as string,
      fullName: u.full_name as string,
      permissions: u.permissions ? String(u.permissions).split(',') : [],
      branchId: (u.branch_id as string | null) ?? null,
      role: (u.role_code as string) || 'branch_user',
    },
  };
}

function noStore(c: Context) {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
}

auth.post('/login', async (c) => {
  noStore(c);
  const clientType = clientTypeOf(c);
  if (clientType === 'browser') {
    const rejected = csrfRejection(c);
    if (rejected) return c.json({ message: rejected }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password || password.length > 200) return c.json({ message: 'Invalid credentials' }, 401);

  const pool = poolOf(c);
  const ip = clientIp(c);
  if (await isLoginThrottled(pool, email, ip)) {
    return c.json({ message: 'Too many failed sign-in attempts. Try again in 15 minutes.' }, 429);
  }

  const found = await pool.query('SELECT id, password_hash FROM users WHERE LOWER(email) = $1 AND is_active = 1', [email]);
  const row = found.rows[0];
  const ok = bcrypt.compareSync(password, (row?.password_hash as string) || DUMMY_HASH) && Boolean(row);
  if (!ok) {
    await recordLoginFailure(pool, email, ip);
    return c.json({ message: 'Invalid credentials' }, 401);
  }
  await clearLoginFailures(pool, email, ip);

  const profile = await loadProfile(c, row.id);
  if (!profile) return c.json({ message: 'Invalid credentials' }, 401);
  const { sessionId, refreshToken } = await createSession(pool, row.id, {
    clientType, userAgent: c.req.header('user-agent'), ip,
  });
  await pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id]);
  const accessToken = await signAccessToken(row.id, sessionId, profile.pwdVer);

  if (clientType === 'browser') {
    setCookie(c, REFRESH_COOKIE, refreshToken, cookieOptions);
    return c.json({ accessToken, expiresIn: ACCESS_TOKEN_TTL_S, user: profile.user });
  }
  return c.json({ accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, user: profile.user });
});

auth.post('/refresh', async (c) => {
  noStore(c);
  const clientType = clientTypeOf(c);
  let presented: string | undefined;
  if (clientType === 'browser') {
    const rejected = csrfRejection(c);
    if (rejected) return c.json({ message: rejected }, 403);
    presented = getCookie(c, REFRESH_COOKIE, 'host');
  } else {
    const body = await c.req.json().catch(() => ({}));
    presented = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
  }
  if (!presented) return c.json({ message: 'Not signed in' }, 401);

  const pool = poolOf(c);
  const result = await rotateRefreshToken(pool, presented);
  if (!result.ok) {
    if (result.reason === 'race') {
      // Another request just rotated this token; retry with the new cookie.
      return c.json({ message: 'Session refresh already in progress', code: 'REFRESH_RACE' }, 409);
    }
    if (clientType === 'browser') deleteCookie(c, REFRESH_COOKIE, { path: '/', secure: true, prefix: 'host' });
    const message = result.reason === 'reuse_detected'
      ? 'This sign-in was used elsewhere and has been ended for your safety. Please sign in again.'
      : 'Session expired. Please sign in again.';
    return c.json({ message, code: result.reason.toUpperCase() }, 401);
  }

  const profile = await loadProfile(c, result.userId);
  if (!profile) {
    await revokeSession(pool, result.sessionId, 'user_inactive');
    if (clientType === 'browser') deleteCookie(c, REFRESH_COOKIE, { path: '/', secure: true, prefix: 'host' });
    return c.json({ message: 'Session expired. Please sign in again.' }, 401);
  }
  const accessToken = await signAccessToken(result.userId, result.sessionId, profile.pwdVer);
  if (clientType === 'browser') {
    setCookie(c, REFRESH_COOKIE, result.refreshToken, cookieOptions);
    return c.json({ accessToken, expiresIn: ACCESS_TOKEN_TTL_S, user: profile.user });
  }
  return c.json({ accessToken, refreshToken: result.refreshToken, expiresIn: ACCESS_TOKEN_TTL_S, user: profile.user });
});

// Ends this session on the server. Works with an expired access token: the
// browser identifies the session by its refresh cookie, a native client by
// its refresh token.
auth.post('/logout', async (c) => {
  noStore(c);
  const clientType = clientTypeOf(c);
  const pool = poolOf(c);
  let presented: string | undefined;
  if (clientType === 'browser') {
    const rejected = csrfRejection(c);
    if (rejected) return c.json({ message: rejected }, 403);
    presented = getCookie(c, REFRESH_COOKIE, 'host');
    deleteCookie(c, REFRESH_COOKIE, { path: '/', secure: true, prefix: 'host' });
  } else {
    const body = await c.req.json().catch(() => ({}));
    presented = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
  }
  const sessionId = presented ? await sessionOfRefreshToken(pool, presented) : null;
  if (sessionId) await revokeSession(pool, sessionId, 'logout');
  return c.body(null, 204);
});

auth.post('/logout-all', authMiddleware, async (c) => {
  noStore(c);
  const payload = (c as any).get('jwtPayload');
  await poolOf(c).query(
    `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'logout_all' WHERE user_id = $1 AND revoked_at IS NULL`,
    [payload.sub],
  );
  if (clientTypeOf(c) === 'browser') deleteCookie(c, REFRESH_COOKIE, { path: '/', secure: true, prefix: 'host' });
  return c.body(null, 204);
});

auth.get('/me', authMiddleware, async (c) => {
  noStore(c);
  const profile = await loadProfile(c, (c as any).get('jwtPayload').sub);
  if (!profile) return c.json({ message: 'Unauthorized' }, 401);
  return c.json({ user: profile.user });
});

export default auth;
