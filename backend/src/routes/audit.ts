import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { csvResponse, dateRange, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';

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
  if (!hasAccess) {
    return c.json({ message: 'Forbidden' }, 403);
  }
  await next();
});

/** Record types and actions that occur (for the filters). Non-admins: their own entries only. */
audit.get('/facets', async (c) => {
  const payload = c.get('jwtPayload');
  const own = !isAdminUser(payload);
  const [types, actions] = await Promise.all([
    c.env.DB.prepare(`SELECT DISTINCT entity_type AS v FROM audit_logs ${own ? 'WHERE actor_user_id = ?' : ''} ORDER BY 1`).bind(...(own ? [payload.sub] : [])).all(),
    c.env.DB.prepare(`SELECT DISTINCT action AS v FROM audit_logs ${own ? 'WHERE actor_user_id = ?' : ''} ORDER BY 1`).bind(...(own ? [payload.sub] : [])).all(),
  ]);
  const vals = (r: any) => ((r.results || []) as any[]).map((x) => x.v).filter(Boolean);
  return c.json({ entityTypes: vals(types), actions: vals(actions) });
});

const AUDIT_LIST: ListOptions = {
  sortable: { date: 'created_at', action: 'action', type: 'entity_type', who: 'actor_name' },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

audit.get('/', async (c) => {
  const payload = c.get('jwtPayload');
  const entityType = c.req.query('entityType');
  const action = c.req.query('action');
  const actor = c.req.query('actor');
  const search = c.req.query('search') || c.req.query('q');
  const listReq = listRequest(c, AUDIT_LIST);
  // Paged lists use dateFrom/dateTo (whole days, the end day included).
  const startDate = listReq.paged ? undefined : c.req.query('startDate');
  const endDate = listReq.paged ? undefined : c.req.query('endDate');

  let sql = `
    SELECT a.*, u.full_name as actor_name, u.email as actor_email 
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — branch users see only their own audit trail
  if (!isAdminUser(payload)) {
    sql += ' AND a.actor_user_id = ?';
    params.push(payload.sub);
  }

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
    sql += ' AND (a.action ILIKE ? OR a.entity_type ILIKE ? OR a.entity_id ILIKE ? OR CAST(a.old_value AS TEXT) ILIKE ? OR CAST(a.new_value AS TEXT) ILIKE ? OR u.full_name ILIKE ? OR u.email ILIKE ?)';
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

  const parse = (row: any) => {
    let oldVal = row.old_value;
    let newVal = row.new_value;
    try { if (oldVal && typeof oldVal === 'string') oldVal = JSON.parse(oldVal); } catch (_) {}
    try { if (newVal && typeof newVal === 'string') newVal = JSON.parse(newVal); } catch (_) {}
    return { ...row, old_value: oldVal, new_value: newVal };
  };

  if (listReq.paged) {
    const where: string[] = [];
    dateRange(c, 'created_at', where, params);
    const base = `FROM (${sql}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const { rows, total } = await pagedRows(c.env.DB, '*', base, params, listReq);
    if (listReq.csv) {
      return csvResponse(c, 'audit-log', [
        { label: 'When', value: (r: any) => (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)).slice(0, 19).replace('T', ' ') },
        { label: 'Who', value: (r: any) => r.actor_name || r.actor_email },
        { label: 'Action', value: (r: any) => r.action },
        { label: 'Record type', value: (r: any) => r.entity_type },
        { label: 'Record', value: (r: any) => r.entity_id },
        { label: 'Before', value: (r: any) => (r.old_value == null ? '' : typeof r.old_value === 'string' ? r.old_value : JSON.stringify(r.old_value)) },
        { label: 'After', value: (r: any) => (r.new_value == null ? '' : typeof r.new_value === 'string' ? r.new_value : JSON.stringify(r.new_value)) },
      ], rows);
    }
    return pagedResponse(c, listReq, rows.map(parse), total);
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
