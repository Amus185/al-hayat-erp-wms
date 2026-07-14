import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import * as bcrypt from 'bcryptjs';
import { authMiddleware, requirePermissions } from '../middleware/auth';

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
  const body = await c.req.json();
  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(body.password, 12);
  
  await c.env.DB.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, phone, branch_id, warehouse_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, body.email, passwordHash, body.fullName, body.phone || null, body.branchId || null, body.warehouseId || null).run();

  if (body.roleIds && body.roleIds.length > 0) {
    const stmts = body.roleIds.map((rId: string) => 
      c.env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(id, rId)
    );
    await c.env.DB.batch(stmts);
  }

  const { results } = await c.env.DB.prepare('SELECT id, email, full_name FROM users WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// UPDATE user profile (name, email, phone, assignment, active status)
users.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

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

  const user = await c.env.DB.prepare(
    'SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active FROM users WHERE id = ?'
  ).bind(id).first();
  return c.json(user);
});

// CHANGE PASSWORD
users.post('/:id/change-password', async (c) => {
  const id = c.req.param('id');
  const { newPassword } = await c.req.json();
  if (!newPassword || newPassword.length < 6) {
    return c.json({ message: 'Password must be at least 6 characters' }, 400);
  }
  const passwordHash = bcrypt.hashSync(newPassword, 12);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, id).run();
  return c.json({ success: true });
});

// DELETE user
users.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default users;
