import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { Env } from '../db';

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  // The fields below are re-derived from the database on every request
  // (see authMiddleware); the copies inside the token are never trusted.
  permissions: string[];
  branch_id: string | null;
  role: string;           // 'admin' when the user holds the admin role, else their first role
  roles?: string[];
  pwd_ver: number;        // password_version — invalidated on credential regen
};

// ── In-memory user cache (5-minute TTL) ──────────────────────────────────────
// Holds the user's live authorization scope so a changed branch, role or
// permission applies on the next request instead of when the token expires.
// Invalidated immediately on user updates (single Railway replica).
interface CachedUser {
  pwdVer: number;
  isActive: boolean;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  expiresAt: number;
}

const userCache = new Map<string, CachedUser>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedUser(userId: string): CachedUser | null {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userCache.delete(userId);
    return null;
  }
  return entry;
}

export function invalidateUserCache(userId: string) {
  userCache.delete(userId);
}

async function loadUser(db: any, userId: string): Promise<CachedUser | null> {
  const user = await db.prepare(`
    SELECT u.password_version, u.is_active, u.branch_id,
           (SELECT STRING_AGG(DISTINCT r.code, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles,
           (SELECT STRING_AGG(DISTINCT p.code, ',') FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id = ur.role_id
              JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) AS permissions
    FROM users u WHERE u.id = ?
  `).bind(userId).first();
  if (!user) return null;
  const entry: CachedUser = {
    pwdVer: (user.password_version as number) ?? 1,
    isActive: Boolean(user.is_active),
    branchId: (user.branch_id as string | null) ?? null,
    roles: user.roles ? String(user.roles).split(',') : [],
    permissions: user.permissions ? String(user.permissions).split(',') : [],
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  userCache.set(userId, entry);
  return entry;
}

export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const reqStart = Date.now();
  (c as any).reqStartTime = reqStart;
  console.log(`[WATERFALL] +0ms | Request received: ${c.req.method} ${c.req.url}`);

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const t0 = Date.now();
    const payload = await verify(token, c.env.JWT_ACCESS_SECRET, 'HS256') as JwtPayload;
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | authMiddleware JWT verified (${Date.now() - t0}ms)`);

    // Live scope: cache hit (<1ms) or one DB read per user per 5 minutes
    const cached = getCachedUser(payload.sub) ?? await loadUser(c.env.DB, payload.sub);
    if (!cached) {
      return c.json({ message: 'User not found or deactivated' }, 401);
    }

    if (!cached.isActive) {
      return c.json({ message: 'User deactivated' }, 401);
    }

    if (payload.pwd_ver !== undefined && cached.pwdVer !== payload.pwd_ver) {
      return c.json({ message: 'Credentials have been regenerated. Please log in again.' }, 401);
    }

    // Authorization comes from the database, never from token claims.
    payload.branch_id = cached.branchId;
    payload.permissions = cached.permissions;
    payload.roles = cached.roles;
    payload.role = cached.roles.includes('admin') ? 'admin' : (cached.roles[0] || 'branch_user');

    c.set('jwtPayload', payload);
    await next();
  } catch (error) {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }
};


/**
 * requirePermissions — ensure caller has ALL listed permission codes.
 */
export const requirePermissions = (requiredPermissions: string[]) => {
  return async (c: Context<{ Bindings: Env; Variables: { jwtPayload: JwtPayload } }>, next: Next) => {
    const reqStart = (c as any).reqStartTime || Date.now();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | requirePermissions check started`);
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

    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | requirePermissions check passed`);
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
