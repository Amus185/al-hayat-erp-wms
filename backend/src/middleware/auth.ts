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

export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = await verify(token, c.env.JWT_ACCESS_SECRET, 'HS256') as JwtPayload;

    // Validate password_version against DB to support credential invalidation
    const user = await c.env.DB.prepare(
      'SELECT password_version FROM users WHERE id = ? AND is_active = 1'
    ).bind(payload.sub).first();

    if (!user) {
      return c.json({ message: 'User not found or deactivated' }, 401);
    }

    if ((user.password_version as number) !== payload.pwd_ver) {
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
