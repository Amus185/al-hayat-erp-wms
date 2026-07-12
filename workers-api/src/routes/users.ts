import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import * as bcrypt from 'bcryptjs';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const users = new Hono<{ Bindings: Env }>();

users.use('/*', authMiddleware, requirePermissions(['manage_users']));

users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, last_login_at, created_at 
    FROM users ORDER BY created_at DESC
  `).all();
  return c.json(results);
});

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

users.get('/roles', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM roles ORDER BY name ASC').all();
  return c.json(results);
});

export default users;
