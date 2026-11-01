// Saved views: a person's named filter sets for a list (e.g. "Unpaid this
// month" on Sales). Stored on the server so they follow the person to any
// device. Each person only ever sees and changes their own.
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';

const views = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
views.use('/*', authMiddleware);

const MAX_PER_LIST = 30;
const LIST_KEY = /^[a-z0-9-]{1,40}$/;

views.get('/', async (c) => {
  const list = c.req.query('list') || '';
  if (!LIST_KEY.test(list)) return c.json({ message: 'Unknown list.' }, 400);
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, query, created_at FROM user_saved_views WHERE user_id = ? AND list_key = ? ORDER BY name',
  ).bind(c.get('jwtPayload').sub, list).all();
  return c.json(results || []);
});

views.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const list = String(body.list || '');
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const query = String(body.query || '').replace(/^\?/, '').slice(0, 2000);
  if (!LIST_KEY.test(list)) return c.json({ message: 'Unknown list.' }, 400);
  if (!name) return c.json({ message: 'Give the view a name.' }, 400);
  // only list parameters, never a record to open
  const params = new URLSearchParams(query);
  params.delete('open');
  params.delete('page');
  const userId = c.get('jwtPayload').sub;
  const count = await c.env.DB.prepare('SELECT COUNT(*)::int AS n FROM user_saved_views WHERE user_id = ? AND list_key = ?').bind(userId, list).first() as any;
  const existing = await c.env.DB.prepare('SELECT id FROM user_saved_views WHERE user_id = ? AND list_key = ? AND LOWER(name) = LOWER(?)').bind(userId, list, name).first() as any;
  if (!existing && Number(count?.n) >= MAX_PER_LIST) return c.json({ message: `You can keep up to ${MAX_PER_LIST} views per list.` }, 409);
  const id = existing?.id ?? uuidv4();
  // same name again: replaces that view
  await c.env.DB.prepare(`
    INSERT INTO user_saved_views (id, user_id, list_key, name, query) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET query = EXCLUDED.query, name = EXCLUDED.name
  `).bind(id, userId, list, name, params.toString()).run();
  return c.json({ id, name, query: params.toString() }, existing ? 200 : 201);
});

views.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM user_saved_views WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('jwtPayload').sub).run();
  return c.body(null, 204);
});

export default views;
