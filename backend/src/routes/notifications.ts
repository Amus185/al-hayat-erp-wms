import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';

const notifications = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

notifications.use('/*', authMiddleware);

notifications.get('/', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  const db = c.env.DB;

  const items: any[] = [];

  // 1. Fetch system notifications
  try {
    const { results } = await db.prepare(`
      SELECT * FROM notifications 
      WHERE user_id = ? OR user_id IS NULL
      ORDER BY created_at DESC LIMIT 30
    `).bind(userId).all();
    if (results) {
      for (const n of results as any[]) {
        items.push({
          id: n.id,
          title: n.title,
          message: n.message,
          type: n.type || 'SYSTEM',
          link: null,
          date: n.created_at,
          created_at: n.created_at,
          read_at: n.read_at,
          is_operational: false,
        });
      }
    }
  } catch (err) {
    console.error('Error fetching system notifications:', err);
  }

  // 2. Fetch Active Deliveries (Pending, Scheduled, Dispatched)
  try {
    const { results: dels } = await db.prepare(`
      SELECT d.id, d.delivery_number, d.customer_name, d.customer_phone, d.scheduled_date, d.status, d.created_at,
             so.order_number
      FROM deliveries d
      LEFT JOIN sales_orders so ON so.id = d.sales_order_id
      WHERE d.status IN ('PENDING', 'SCHEDULED', 'DISPATCHED')
      ORDER BY d.scheduled_date ASC, d.created_at DESC
      LIMIT 25
    `).all();

    if (dels) {
      for (const d of dels as any[]) {
        const schedStr = d.scheduled_date ? new Date(d.scheduled_date).toLocaleDateString() : 'Unscheduled';
        items.push({
          id: `del-${d.id}`,
          title: `Delivery ${d.delivery_number} (${d.status})`,
          message: `Scheduled: ${schedStr} • Customer: ${d.customer_name || 'N/A'}${d.order_number ? ` (SO #${d.order_number})` : ''}`,
          type: 'DELIVERY',
          link: '/deliveries',
          date: d.scheduled_date || d.created_at,
          created_at: d.created_at,
          status: d.status,
          read_at: null,
          is_operational: true,
        });
      }
    }
  } catch (err) {
    console.error('Error fetching delivery notifications:', err);
  }

  // 3. Fetch Active Transfers (Requested, Approved, Dispatched)
  try {
    const { results: trfs } = await db.prepare(`
      SELECT t.id, t.transfer_number, t.status, t.requested_at,
             COALESCE(sw.name, sb.name, 'Unknown') AS source_name,
             COALESCE(dw.name, db.name, 'Unknown') AS destination_name
      FROM transfers t
      LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
      LEFT JOIN branches sb ON sb.id = t.source_branch_id
      LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
      LEFT JOIN branches db ON db.id = t.destination_branch_id
      WHERE t.status IN ('REQUESTED', 'APPROVED', 'DISPATCHED')
      ORDER BY t.requested_at DESC
      LIMIT 25
    `).all();

    if (trfs) {
      for (const t of trfs as any[]) {
        const reqStr = t.requested_at ? new Date(t.requested_at).toLocaleDateString() : 'Recent';
        items.push({
          id: `trf-${t.id}`,
          title: `Transfer ${t.transfer_number} (${t.status})`,
          message: `Date: ${reqStr} • Route: ${t.source_name} ➔ ${t.destination_name}`,
          type: 'TRANSFER',
          link: '/transfers',
          date: t.requested_at,
          created_at: t.requested_at,
          status: t.status,
          read_at: null,
          is_operational: true,
        });
      }
    }
  } catch (err) {
    console.error('Error fetching transfer notifications:', err);
  }

  // Sort by date / created_at descending
  items.sort((a, b) => new Date(b.date || b.created_at).getTime() - new Date(a.date || a.created_at).getTime());

  return c.json(items);
});

notifications.post('/read', async (c) => {
  const userId = c.get('jwtPayload')?.sub;
  if (userId) {
    try {
      await c.env.DB.prepare('UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL').bind(userId).run();
    } catch { /* ignore if notifications table empty or not applicable */ }
  }
  return c.json({ success: true });
});

notifications.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const id = uuidv4();
    const userId = body.user_id || c.get('jwtPayload')?.sub;
    const now = new Date().toISOString();

    await c.env.DB.prepare(`
      INSERT INTO notifications (id, user_id, title, message, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, userId, body.title, body.message, body.type || 'INFO', now).run();

    return c.json({ success: true, id }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

notifications.delete('/:id', async (c) => {
  try {
    const { id } = c.req.param();
    await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default notifications;
