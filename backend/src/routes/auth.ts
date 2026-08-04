import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import * as bcrypt from 'bcryptjs';
import { Env, uuidv4 } from '../db';
import { invalidateUserCache } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

// ── Helper: build the full user payload for token signing ────────────────────
async function buildUserPayload(db: D1Database, userId: string) {
  const user = await db.prepare(`
    SELECT u.id, u.email, u.full_name, u.branch_id,
           (SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = u.id LIMIT 1) as role_code,
           (SELECT STRING_AGG(DISTINCT p.code, ',')
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.user_id = u.id) as permissions
    FROM users u
    WHERE u.id = ? AND u.is_active = 1
  `).bind(userId).first();
  return user;
}

auth.post('/login', async (c) => {
  const body = await c.req.json();
  const { email, password } = body;

  const user = await c.env.DB.prepare(`
    SELECT u.id, u.email, u.password_hash, u.full_name, u.branch_id,
           (SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = u.id LIMIT 1) as role_code,
           (SELECT STRING_AGG(DISTINCT p.code, ',') 
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

  // Fetch password_version separately — graceful fallback if column not yet migrated
  let pwdVer = 1;
  try {
    const pvRow = await c.env.DB.prepare('SELECT password_version FROM users WHERE id = ?').bind(user.id).first();
    pwdVer = (pvRow?.password_version as number) ?? 1;
  } catch (_) {
    // Column not yet added — use default 1
  }

  const permissions = user.permissions ? (user.permissions as string).split(',') : [];
  const roleCode = (user.role_code as string) || 'branch_user';

  const payload = {
    sub: user.id as string,
    email: user.email as string,
    name: user.full_name as string,
    permissions,
    branch_id: (user.branch_id as string | null) ?? null,
    role: roleCode,
    pwd_ver: pwdVer,
  };

  const accessToken = await sign(
    { ...payload, exp: Math.floor(Date.now() / 1000) + 15 * 60 },
    c.env.JWT_ACCESS_SECRET,
    'HS256'
  );
  const refreshToken = await sign(
    {
      sub: user.id as string,
      type: 'refresh',
      pwd_ver: payload.pwd_ver,
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
    c.env.JWT_REFRESH_SECRET,
    'HS256'
  );

  const tokenHash = await crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(refreshToken))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  await c.env.DB.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+7 days'))`
  ).bind(uuidv4(), user.id, tokenHash).run();

  await c.env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id).run();

  return c.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      permissions,
      branchId: user.branch_id ?? null,
      role: roleCode,
    },
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

  const tokenHash = await crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(refreshToken))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  const result = await c.env.DB.prepare(
    `DELETE FROM refresh_tokens 
     WHERE user_id = ? AND token_hash = ? AND expires_at > CURRENT_TIMESTAMP
     RETURNING id`
  ).bind(decoded.sub, tokenHash).run();

  if (!result.results || result.results.length === 0) {
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(decoded.sub).run();
    return c.json({ message: 'Refresh token revoked' }, 401);
  }

  const user = await buildUserPayload(c.env.DB, decoded.sub);
  if (!user) return c.json({ message: 'User not found' }, 401);

  // Fetch password_version separately — graceful fallback if column not yet migrated
  let pwdVer = 1;
  try {
    const pvRow = await c.env.DB.prepare('SELECT password_version FROM users WHERE id = ?').bind(user.id).first();
    pwdVer = (pvRow?.password_version as number) ?? 1;
    // Validate it hasn't changed since token was issued (skip if column missing)
    if (decoded.pwd_ver && pwdVer !== decoded.pwd_ver) {
      return c.json({ message: 'Credentials have been regenerated. Please log in again.' }, 401);
    }
  } catch (_) {
    // Column not yet added — skip version check
  }

  const permissions = user.permissions ? (user.permissions as string).split(',') : [];
  const roleCode = (user.role_code as string) || 'branch_user';

  const accessToken = await sign({
    sub: user.id as string,
    email: user.email as string,
    name: user.full_name as string,
    permissions,
    branch_id: (user.branch_id as string | null) ?? null,
    role: roleCode,
    pwd_ver: pwdVer,
    exp: Math.floor(Date.now() / 1000) + 15 * 60,
  }, c.env.JWT_ACCESS_SECRET, 'HS256');

  const newRefreshToken = await sign({
    sub: user.id as string,
    type: 'refresh',
    pwd_ver: pwdVer,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
  }, c.env.JWT_REFRESH_SECRET, 'HS256');

  const newTokenHash = await crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(newRefreshToken))
    .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

  await c.env.DB.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, datetime('now', '+7 days'))`
  ).bind(uuidv4(), user.id, newTokenHash).run();

  invalidateUserCache(user.id as string);

  return c.json({
    accessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      permissions,
      branchId: user.branch_id ?? null,
      role: roleCode,
    },
  });
});

export default auth;
