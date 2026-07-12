import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const audit = new Hono<{ Bindings: Env }>();

audit.use('/*', authMiddleware, requirePermissions(['manage_users'])); // Only admins can see audit logs usually

audit.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT a.*, u.full_name as actor_name 
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    ORDER BY a.created_at DESC LIMIT 100
  `).all();
  return c.json(results);
});

export default audit;
