import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { Env } from '../db';
import { getAccessSecret } from '../security-config';

export type JwtPayload = {
  sub: string;
  sid: string;            // server-side session (auth_sessions.id)
  email: string;
  name: string;
  // The fields below are loaded from the database on every request (see
  // authMiddleware); nothing the client sends is trusted for authorization.
  permissions: string[];
  branch_id: string | null;
  role: string;           // 'admin' when the user holds the admin role, else their first role
  roles?: string[];
  pwd_ver: number;        // password_version — a password change ends every session
};

/**
 * Kept for callers that used to clear the per-process user cache. There is no
 * cache any more: every request reads the user and session from the database,
 * so a password change, deactivation, role change or logout applies on the
 * next request on every backend instance.
 */
export function invalidateUserCache(_userId: string) {}

async function loadAuthState(db: any, userId: string, sessionId: string) {
  return db.prepare(`
    SELECT u.email, u.full_name, COALESCE(u.password_version, 1) AS password_version, u.is_active, u.branch_id,
           (SELECT STRING_AGG(DISTINCT r.code, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
           (SELECT STRING_AGG(DISTINCT p.code, ',') FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id = ur.role_id
              JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) AS permissions,
           s.id IS NOT NULL AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP AS session_live
    FROM users u
    LEFT JOIN auth_sessions s ON s.id = ? AND s.user_id = u.id
    WHERE u.id = ?
  `).bind(sessionId, userId).first();
}

export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  let payload: JwtPayload & { typ?: string };
  try {
    payload = await verify(authHeader.slice(7), getAccessSecret(), 'HS256') as any;
  } catch (error: any) {
    if (error?.name === 'ConfigError') throw error;
    return c.json({ message: 'Invalid or expired token' }, 401);
  }
  // Only session-bound access tokens are accepted (tokens issued before
  // server-side sessions existed carry no sid and are refused).
  if (payload.typ !== 'access' || !payload.sid || !payload.sub) {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }

  const user = await loadAuthState(c.env.DB, payload.sub, payload.sid);
  if (!user || Number(user.is_active) !== 1) {
    return c.json({ message: 'User not found or deactivated' }, 401);
  }
  if (Number(user.password_version) !== Number(payload.pwd_ver)) {
    return c.json({ message: 'Your password was changed. Please sign in again.' }, 401);
  }
  if (!user.session_live) {
    return c.json({ message: 'Session ended. Please sign in again.' }, 401);
  }

  // Authorization comes from the database, never from token claims.
  const roles = user.roles ? String(user.roles).split(',') : [];
  payload.email = user.email;
  payload.name = user.full_name;
  payload.branch_id = (user.branch_id as string | null) ?? null;
  payload.permissions = user.permissions ? String(user.permissions).split(',') : [];
  payload.roles = roles;
  payload.role = roles.includes('admin') ? 'admin' : (roles[0] || 'branch_user');

  c.set('jwtPayload', payload);
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
