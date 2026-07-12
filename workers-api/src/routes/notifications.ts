import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';

const notifications = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

notifications.use('/*', authMiddleware);

notifications.get('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const { results } = await c.env.DB.prepare(`
    SELECT * FROM notifications 
    WHERE user_id = ? OR user_id IS NULL
    ORDER BY created_at DESC LIMIT 50
  `).bind(userId).all();
  return c.json(results);
});

notifications.post('/read', async (c) => {
  const userId = c.get('jwtPayload').sub;
  await c.env.DB.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').bind(userId).run();
  return c.json({ success: true });
});

export default notifications;
