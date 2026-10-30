import { Context, Next } from 'hono';
import { Env } from '../db';
import { authFor } from '../auth';
import { isAllowedOrigin } from '../security-config';
import { poolOf } from '../services/auth-sessions';

export type JwtPayload = {
  sub: string;            // user id (users.id = Better Auth "user".id)
  sid: string;            // Better Auth session id
  email: string;
  name: string;
  // The fields below are loaded from the database on every request (see
  // authMiddleware); nothing the client sends is trusted for authorization.
  permissions: string[];
  branch_id: string | null;
  role: string;           // 'admin' when the user holds the admin role, else their first role
  roles?: string[];
  pwd_ver: number;        // password_version, carried in agent tokens
};

/** env key for requests the server makes as an already-authenticated user. */
export const INTERNAL_AUTH = Symbol('internal-auth');

/** env for an in-process request to the app as this user (see authMiddleware). */
export function asUser(env: unknown, payload: JwtPayload) {
  return { ...(env as object), [INTERNAL_AUTH]: payload };
}

/**
 * Kept for callers that used to clear the per-process user cache. There is no
 * cache: every request reads the user and session from the database, so a
 * password change, deactivation, ban, role change or sign-out applies on the
 * next request on every backend instance.
 */
export function invalidateUserCache(_userId: string) {}

/**
 * Cookie-authenticated requests must prove they come from our own page, not a
 * cross-site form or script:
 * - Origin, when sent, must be an allowed origin;
 * - Sec-Fetch-Site, when sent, must not be cross-site/same-site from elsewhere;
 * - a custom header must be present (a cross-site page cannot add it without a
 *   CORS preflight, which the allow-list refuses).
 * The session cookie's SameSite=Strict is an additional layer, not the only one.
 * Bearer-token requests (mobile) carry no ambient credential and skip this.
 */
export function csrfRejection(c: Context): string | null {
  const origin = c.req.header('origin');
  if (origin && !isAllowedOrigin(origin)) return 'Origin not allowed';
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none' && !(origin && isAllowedOrigin(origin))) return 'Cross-site request refused';
  if (c.req.header('x-csrf-protection') !== '1') return 'Missing CSRF protection header';
  return null;
}

/** ERP authorization for a user, and whether the given Better Auth session is live and the user not banned. */
export async function loadAuthState(db: any, userId: string, sessionId: string) {
  return db.prepare(`
    SELECT u.email, u.full_name, COALESCE(u.password_version, 1) AS password_version, u.is_active, u.branch_id,
           (SELECT STRING_AGG(DISTINCT r.code, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
           (SELECT STRING_AGG(DISTINCT p.code, ',') FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id = ur.role_id
              JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) AS permissions,
           EXISTS (SELECT 1 FROM "session" s WHERE s.id = ? AND s."userId" = u.id AND s."expiresAt" > CURRENT_TIMESTAMP) AS session_live,
           COALESCE(b.banned, FALSE) AND (b."banExpires" IS NULL OR b."banExpires" > CURRENT_TIMESTAMP) AS banned
    FROM users u
    LEFT JOIN "user" b ON b.id = u.id
    WHERE u.id = ?
  `).bind(sessionId, userId).first();
}

/** The authorization payload routes read with c.get('jwtPayload'). */
export function payloadFrom(user: any, userId: string, sessionId: string): JwtPayload {
  const roles = user.roles ? String(user.roles).split(',') : [];
  return {
    sub: userId,
    sid: sessionId,
    email: user.email,
    name: user.full_name,
    pwd_ver: Number(user.password_version),
    branch_id: (user.branch_id as string | null) ?? null,
    permissions: user.permissions ? String(user.permissions).split(',') : [],
    roles,
    role: roles.includes('admin') ? 'admin' : (roles[0] || 'branch_user'),
  };
}

/**
 * A Better Auth session, from the session cookie (browser) or a bearer
 * session token (mobile). Authorization (roles, permissions, branch) comes
 * from the ERP tables, never from anything the client sends.
 */
export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  // A request the server makes on behalf of an already-authenticated user
  // (the assistant's reads, a confirmed suggestion). Only server code can set
  // a symbol-keyed env entry: requests, config and bindings cannot.
  const internal = (c.env as any)?.[INTERNAL_AUTH] as JwtPayload | undefined;
  if (internal) {
    c.set('jwtPayload', internal);
    return next();
  }
  const bearer = /^bearer /i.test(c.req.header('Authorization') || '');
  const result = await authFor(poolOf(c)).api.getSession({ headers: c.req.raw.headers, returnHeaders: true });
  const found = result.response;
  if (!found) return c.json({ message: 'Unauthorized' }, 401);
  if (!bearer) {
    const rejected = csrfRejection(c);
    if (rejected) return c.json({ message: rejected }, 403);
  }
  // A sliding expiry renews the cookie now and then; pass it on.
  for (const cookie of result.headers?.getSetCookie?.() ?? []) c.header('Set-Cookie', cookie, { append: true });

  const user = await loadAuthState(c.env.DB, found.user.id, found.session.id);
  if (!user || Number(user.is_active) !== 1 || user.banned) {
    return c.json({ message: 'User not found or deactivated' }, 401);
  }
  if (!user.session_live) {
    return c.json({ message: 'Session ended. Please sign in again.' }, 401);
  }

  c.set('jwtPayload', payloadFrom(user, found.user.id, found.session.id));
  await next();
};


/**
 * requirePermissions — ensure caller has ALL listed permission codes.
 */
export const requirePermissions = (requiredPermissions: string[]) => {
  return async (c: Context<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>, next: Next) => {
    const payload = c.get('jwtPayload');
    if (!payload) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    if (requiredPermissions.length === 0) {
      return next();
    }

    const hasAll = requiredPermissions.every(p => payload.permissions.includes(p));
    if (!hasAll) {
      return c.json({ message: 'Forbidden' }, 403);
    }

    await next();
  };
};

/**
 * requireAdmin — only users with role === 'admin' may proceed.
 */
export const requireAdmin = async (
  c: Context<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>,
  next: Next
) => {
  const payload = c.get('jwtPayload');
  if (!payload || payload.role !== 'admin') {
    return c.json({ message: 'Admin access required' }, 403);
  }
  await next();
};

/**
 * isAdminUser — helper to check if request is from an admin.
 */
export function isAdminUser(payload: JwtPayload): boolean {
  return payload.role === 'admin' || payload.branch_id === null;
}
