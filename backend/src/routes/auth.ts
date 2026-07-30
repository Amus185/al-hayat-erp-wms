import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import * as bcrypt from 'bcryptjs';
import { Env, uuidv4 } from '../db';

const auth = new Hono<{ Bindings: Env }>();

auth.post('/login', async (c) => {
  const body = await c.req.json();
  const { email, password } = body;

  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.full_name,
           (SELECT GROUP_CONCAT(p.code) 
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) as permissions
    FROM users u
    WHERE u.email = ? AND u.is_active = 1
  `).bind(email).first();

  if (!user || !bcrypt.compareSync(password, user.password_hash as string)) {
    return c.json({ message: 'Invalid credentials' }, 401);
  }

  const permissions = user.permissions ? (user.permissions as string).split(',') : [];

  const payload = {
    sub: user.id as string,
    email: user.email as string,
    name: user.full_name as string,
    permissions,
  };

  const accessToken = await sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 15 * 60 }, c.env.JWT_ACCESS_SECRET, 'HS256');
  const refreshToken = await sign({ sub: user.id as string, type: 'refresh', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 }, c.env.JWT_REFRESH_SECRET, 'HS256');

  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  await c.env.DB.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'))
  `).bind(uuidv4(), user.id, tokenHash).run();

  await c.env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();

  return c.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, permissions },
  });
});

auth.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  let decoded: any;
  try {
    decoded = await verify(refreshToken, c.env.JWT_REFRESH_SECRET, 'HS256');
  } catch (error) {
    return c.json({ message: 'Invalid or expired token' }, 401);
  }

  if (decoded.type !== 'refresh') {
    return c.json({ message: 'Invalid token type' }, 401);
  }

  const tokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  const result = await c.env.DB.prepare(`
    DELETE FROM refresh_tokens 
    WHERE user_id = ? AND token_hash = ? AND expires_at > CURRENT_TIMESTAMP
    RETURNING id
  `).bind(decoded.sub, tokenHash).run();

  if (!result.results || result.results.length === 0) {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(decoded.sub).run();
    return c.json({ message: 'Refresh token revoked' }, 401);
  }

  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.full_name,
           (SELECT GROUP_CONCAT(p.code) 
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) as permissions
    FROM users u
    WHERE u.id = ? AND u.is_active = 1
  `).bind(decoded.sub).first();

  if (!user) return c.json({ message: 'User not found' }, 401);

  const permissions = user.permissions ? (user.permissions as string).split(',') : [];

  const accessToken = await sign({
    sub: user.id as string,
    email: user.email as string,
    name: user.full_name as string,
    permissions,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  }, c.env.JWT_ACCESS_SECRET, 'HS256');

  const newRefreshToken = await sign({
    sub: user.id as string,
    type: 'refresh',
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  }, c.env.JWT_REFRESH_SECRET, 'HS256');

  const newTokenHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newRefreshToken)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  await c.env.DB.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, datetime('now', '+7 days'))
  `).bind(uuidv4(), user.id, newTokenHash).run();

  return c.json({
    accessToken,
    refreshToken: newRefreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name, permissions },
  });
});

export default auth;
