import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const branches = new Hono<{ Bindings: Env }>();

branches.use('/*', authMiddleware);

branches.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM branches ORDER BY name').all();
  return c.json(results);
});

branches.post('/', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO branches (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code, body.name, body.city, body.address || null, body.phone || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

export default branches;
