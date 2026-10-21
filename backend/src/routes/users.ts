import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import * as bcrypt from 'bcryptjs';
import { authMiddleware, requirePermissions, invalidateUserCache } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { prepareRevokeAllSessions } from '../services/auth-sessions';

const ADMIN_ROLE_ID = '77777777-7777-7777-7777-777777777777';

/** Only an administrator may grant the admin role or manage an admin account. */
async function adminGuard(c: any, targetUserId: string | null, roleIds?: string[]): Promise<string | null> {
  if (c.get('jwtPayload')?.role === 'admin') return null;
  if (roleIds?.includes(ADMIN_ROLE_ID)) return 'Only an administrator can grant the administrator role.';
  if (targetUserId) {
    const isAdmin = await c.env.DB.prepare('SELECT 1 AS x FROM user_roles WHERE user_id = ? AND role_id = ?').bind(targetUserId, ADMIN_ROLE_ID).first();
    if (isAdmin) return 'Only an administrator can change an administrator account.';
  }
  return null;
}

const users = new Hono<{ Bindings: Env }>();

users.use('/*', authMiddleware, requirePermissions(['manage_users']));

// GET all users
users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, last_login_at, created_at 
    FROM users ORDER BY created_at DESC
  `).all();
  return c.json(results);
});

// GET all roles
users.get('/roles', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM roles ORDER BY name ASC').all();
  return c.json(results);
});

// GET user roles for a specific user
users.get('/:id/roles', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.name, r.description FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).bind(id).all();
  return c.json(results);
});

// CREATE user
users.post('/', async (c) => {
  {
    const peek = await c.req.json().catch(() => ({}));
    const denied = await adminGuard(c, null, Array.isArray(peek?.roleIds) ? peek.roleIds : undefined);
    if (denied) return c.json({ message: denied }, 403);
  }
  const body = await c.req.json();

  // Input validation
  if (!body.email || !body.email.trim()) return c.json({ message: 'Email is required.' }, 400);
  if (!body.password || body.password.length < 6) return c.json({ message: 'Password must be at least 6 characters.' }, 400);
  if (!body.fullName || !body.fullName.trim()) return c.json({ message: 'Full name is required.' }, 400);

  // Email uniqueness check
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(body.email.trim()).first();
  if (existing) return c.json({ message: 'A user with this email already exists.' }, 409);

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(body.password, 12);
  
  await c.env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, branch_id, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.email.trim(), passwordHash, body.fullName.trim(), body.phone || null, body.branchId || null, body.warehouseId || null).run();

  if (body.roleIds && body.roleIds.length > 0) {
    const stmts = body.roleIds.map((rId: string) => 
      c.env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(id, rId)
    );
    await c.env.DB.batch(stmts);
  }

  const { results } = await c.env.DB.prepare('SELECT id, email, full_name FROM users WHERE id = ?').bind(id).all();
  await logAudit(c, 'USER_CREATE', 'users', id, null, { email: body.email.trim(), fullName: body.fullName.trim(), roleIds: body.roleIds || [] });
  return c.json(results[0], 201);
});

// UPDATE user profile (name, email, phone, assignment, active status)
users.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const denied = await adminGuard(c, id, Array.isArray(body.roleIds) ? body.roleIds : undefined);
  if (denied) return c.json({ message: denied }, 403);

  // Check email uniqueness if changing email
  if (body.email) {
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ? AND id != ?').bind(body.email.trim(), id).first();
    if (existing) return c.json({ message: 'A user with this email already exists.' }, 409);
  }

  const oldUser = await c.env.DB.prepare(
    'SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active FROM users WHERE id = ?'
  ).bind(id).first();

  await c.env.DB.prepare(`
    UPDATE users SET
      full_name = COALESCE(?, full_name),
      email = COALESCE(?, email),
      phone = ?,
      branch_id = ?,
      warehouse_id = ?,
      is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).bind(
    body.fullName || null,
    body.email || null,
    body.phone !== undefined ? body.phone || null : undefined,
    body.branchId !== undefined ? body.branchId || null : undefined,
    body.warehouseId !== undefined ? body.warehouseId || null : undefined,
    body.isActive !== undefined ? (body.isActive ? 1 : 0) : null,
    id
  ).run();

  // Update roles if provided
  if (body.roleIds !== undefined) {
    await c.env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
    if (body.roleIds.length > 0) {
      const stmts = body.roleIds.map((rId: string) =>
        c.env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(id, rId)
      );
      await c.env.DB.batch(stmts);
    }
  }

  // A deactivated user's sessions end now (and stay ended if reactivated)
  if (body.isActive === false) {
    await c.env.DB.batch([prepareRevokeAllSessions(c.env.DB, id, 'user_deactivated')]);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active FROM users WHERE id = ?'
  ).bind(id).first();
  invalidateUserCache(id);
  await logAudit(c, 'USER_UPDATE', 'users', id, oldUser, body);
  return c.json(user);
});

// CHANGE PASSWORD
users.post('/:id/change-password', async (c) => {
  const id = c.req.param('id');
  const { newPassword } = await c.req.json();
  if (!newPassword || newPassword.length < 6) {
    return c.json({ message: 'Password must be at least 6 characters' }, 400);
  }
  const denied = await adminGuard(c, id);
  if (denied) return c.json({ message: denied }, 403);
  const passwordHash = bcrypt.hashSync(newPassword, 12);
  // New password version + every session ended, in one transaction: all
  // access tokens stop working on the next request, on every instance.
  await c.env.DB.batch([
    c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, password_version = COALESCE(password_version, 1) + 1 WHERE id = ?'
    ).bind(passwordHash, id),
    prepareRevokeAllSessions(c.env.DB, id, 'password_changed'),
  ]);
  invalidateUserCache(id); // Clear cache so next request validates against DB
  await logAudit(c, 'USER_CHANGE_PASSWORD', 'users', id, null, { changed: true });
  return c.json({ success: true });
});


// DELETE user (safe — checks for active references)
users.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const denied = await adminGuard(c, id);
  if (denied) return c.json({ message: denied }, 403);
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!user) return c.json({ message: 'User not found.' }, 404);

  // Check for active orders/transfers created by this user
  const activeOrders = await c.env.DB.prepare(
    "SELECT id FROM sales_orders WHERE created_by = ? AND status NOT IN ('PAID', 'CANCELLED') LIMIT 1"
  ).bind(id).first();
  if (activeOrders) return c.json({ message: 'Cannot delete: user has active sales orders. Deactivate instead.' }, 400);

  const activeTransfers = await c.env.DB.prepare(
    "SELECT id FROM transfers WHERE requested_by = ? AND status NOT IN ('COMPLETED', 'CANCELLED') LIMIT 1"
  ).bind(id).first();
  if (activeTransfers) return c.json({ message: 'Cannot delete: user has active transfers. Deactivate instead.' }, 400);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'USER_DELETE', 'users', id, user, null)
  ]);
  invalidateUserCache(id);
  return c.json({ success: true });
});

export default users;
