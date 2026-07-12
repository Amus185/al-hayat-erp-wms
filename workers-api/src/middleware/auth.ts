import { Context, Next } from 'hono';
import { verify } from 'hono/jwt';
import { Env } from '../db';

export type JwtPayload = {
  sub: string;
  email: string;
  name: string;
  permissions: string[];
};

export const authMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = await verify(token, c.env.JWT_ACCESS_SECRET, 'HS256') as JwtPayload;
    c.set('jwtPayload', payload);
    await next();
  } catch (error) {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }
};

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
