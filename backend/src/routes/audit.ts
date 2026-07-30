import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const audit = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

audit.use('/*', authMiddleware, async (c, next) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ message: 'Unauthorized' }, 401);
  const hasAccess = payload.permissions.includes('manage_users') || 
                    payload.permissions.includes('view_reports') || 
                    payload.permissions.includes('super_admin') ||
                    payload.permissions.includes('manage_inventory') ||
                    payload.permissions.includes('manage_sales') ||
                    payload.permissions.includes('manage_purchasing');
  if (!hasAccess && payload.permissions.length > 0) {
    return c.json({ message: 'Forbidden' }, 403);
  }
  await next();
});

audit.get('/', async (c) => {
  const entityType = c.req.query('entityType');
  const action = c.req.query('action');
  const actor = c.req.query('actor');
  const search = c.req.query('search');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');

  let sql = `
    SELECT a.*, u.full_name as actor_name, u.email as actor_email 
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (entityType && entityType.trim() !== '') {
    sql += ' AND a.entity_type = ?';
    params.push(entityType.trim());
  }
  if (action && action.trim() !== '') {
    sql += ' AND a.action = ?';
    params.push(action.trim());
  }
  if (actor && actor.trim() !== '') {
    sql += ' AND (a.actor_user_id = ? OR u.full_name LIKE ? OR u.email LIKE ?)';
    params.push(actor.trim(), `%${actor.trim()}%`, `%${actor.trim()}%`);
  }
  if (search && search.trim() !== '') {
    sql += ' AND (a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.old_value LIKE ? OR a.new_value LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)';
    const s = `%${search.trim()}%`;
    params.push(s, s, s, s, s, s, s);
  }
  if (startDate && startDate.trim() !== '') {
    sql += ' AND a.created_at >= ?';
    params.push(startDate.trim());
  }
  if (endDate && endDate.trim() !== '') {
    sql += ' AND a.created_at <= ?';
    params.push(endDate.trim());
  }

  sql += ' ORDER BY a.created_at DESC LIMIT 200';

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  const parsedResults = results.map((row: any) => {
    let oldVal = row.old_value;
    let newVal = row.new_value;
    try { if (oldVal && typeof oldVal === 'string') oldVal = JSON.parse(oldVal); } catch (_) {}
    try { if (newVal && typeof newVal === 'string') newVal = JSON.parse(newVal); } catch (_) {}
    return {
      ...row,
      old_value: oldVal,
      new_value: newVal
    };
  });

  return c.json(parsedResults);
});

export default audit;
