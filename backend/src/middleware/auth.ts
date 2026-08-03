import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { Env } from '../db';

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  permissions: string[];
  // Branch scoping — null means admin (sees all data)
  branch_id: string | null;
  role: string;           // 'admin' | 'branch_user' | 'manager' | etc.
  pwd_ver: number;        // password_version — invalidated on credential regen
};

// ── In-Memory Password Version Cache (5-Minute TTL) ──────────────────────────
interface CachedUserPwdVer {
  pwdVer: number;
  isActive: boolean;
  expiresAt: number;
}

const userPwdVerCache = new Map<string, CachedUserPwdVer>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCachedPwdVer(userId: string): { pwdVer: number; isActive: boolean } | null {
  const entry = userPwdVerCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    userPwdVerCache.delete(userId);
    return null;
  }
  return { pwdVer: entry.pwdVer, isActive: entry.isActive };
}

export function setCachedPwdVer(userId: string, pwdVer: number, isActive = true) {
  userPwdVerCache.set(userId, {
    pwdVer,
    isActive,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateUserCache(userId: string) {
  userPwdVerCache.delete(userId);
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

    // Fast-path: Check in-memory cache first (<1ms)
    const tCache0 = Date.now();
    let cached = getCachedPwdVer(payload.sub);

    if (!cached) {
      // Cache miss: query DB once per 5 minutes per user
      try {
        const tDb0 = Date.now();
        const user = await c.env.DB.prepare(
          'SELECT password_version, is_active FROM users WHERE id = ?'
        ).bind(payload.sub).first();
        console.log(`[WATERFALL] +${Date.now() - reqStart}ms | authMiddleware DB pwd_ver lookup miss (${Date.now() - tDb0}ms)`);

        if (!user) {
          return c.json({ message: 'User not found or deactivated' }, 401);
        }

        const dbPwdVer = (user.password_version as number) ?? 1;
        const isActive = Boolean(user.is_active);

        setCachedPwdVer(payload.sub, dbPwdVer, isActive);
        cached = { pwdVer: dbPwdVer, isActive };
      } catch (dbErr: any) {
        if (!dbErr?.message?.includes('password_version')) throw dbErr;
        // Graceful fallback if column missing
        cached = { pwdVer: payload.pwd_ver ?? 1, isActive: true };
      }
    } else {
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | authMiddleware pwd_ver cache hit (<1ms)`);
    }

    if (!cached.isActive) {
      return c.json({ message: 'User deactivated' }, 401);
    }

    if (payload.pwd_ver !== undefined && cached.pwdVer !== payload.pwd_ver) {
      return c.json({ message: 'Credentials have been regenerated. Please log in again.' }, 401);
    }

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
