import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const deliveries = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

deliveries.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// KPI STATS
// ──────────────────────────────────────────────────────────────────────
deliveries.get('/stats', async (c) => {
  const db = c.env.DB;

  const total = await db.prepare('SELECT COUNT(*) AS count FROM deliveries').first();
  const pending = await db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status IN ('PENDING', 'SCHEDULED')").first();
  const dispatched = await db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status = 'DISPATCHED'").first();
  const deliveredToday = await db.prepare(`
    SELECT COUNT(*) AS count FROM deliveries
    WHERE status = 'DELIVERED' AND date(delivered_at) = CURRENT_DATE
  `).first();

  return c.json({
    total: Number(total?.count || 0),
    pending: Number(pending?.count || 0),
    dispatched: Number(dispatched?.count || 0),
    deliveredToday: Number(deliveredToday?.count || 0),
  });
});

// ──────────────────────────────────────────────────────────────────────
// LIST DELIVERIES
// ──────────────────────────────────────────────────────────────────────
deliveries.get('/', async (c) => {
  const { status, search, driver, dateFrom, dateTo } = c.req.query();

  let query = `
    SELECT d.*, so.order_number, w.name AS warehouse_name, u.full_name AS created_by_name,
           (SELECT COUNT(*) FROM delivery_items di WHERE di.delivery_id = d.id) AS total_items,
           (SELECT COALESCE(SUM(di.quantity), 0) FROM delivery_items di WHERE di.delivery_id = d.id) AS total_units
    FROM deliveries d
    LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    LEFT JOIN warehouses w ON w.id = d.source_warehouse_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL') {
    query += ` AND d.status = ?`;
    params.push(status);
  }

  if (search) {
    query += ` AND (d.delivery_number LIKE ? OR d.customer_name LIKE ? OR d.customer_phone LIKE ? OR d.delivery_address LIKE ? OR so.order_number LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (driver) {
    query += ` AND d.driver_name LIKE ?`;
    params.push(`%${driver}%`);
  }

  if (dateFrom) {
    query += ` AND date(d.created_at) >= date(?)`;
    params.push(dateFrom);
  }

  if (dateTo) {
    query += ` AND date(d.created_at) <= date(?)`;
    params.push(dateTo);
  }

  query += ` ORDER BY d.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

// ──────────────────────────────────────────────────────────────────────
// GET SINGLE DELIVERY WITH ITEMS
// ──────────────────────────────────────────────────────────────────────
deliveries.get('/:id', async (c) => {
  const id = c.req.param('id');
  const delivery = await c.env.DB.prepare(`
    SELECT d.*, so.order_number, w.name AS warehouse_name, u.full_name AS created_by_name
    FROM deliveries d
    LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    LEFT JOIN warehouses w ON w.id = d.source_warehouse_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.id = ?
  `).bind(id).first();

  if (!delivery) return c.json({ message: 'Delivery not found' }, 404);

  const { results: items } = await c.env.DB.prepare(`
    SELECT di.*, p.name AS product_name, p.sku AS product_sku
    FROM delivery_items di
    JOIN products p ON p.id = di.product_id
    WHERE di.delivery_id = ?
  `).bind(id).all();

  return c.json({ ...delivery, items: items || [] });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE DELIVERY
// ──────────────────────────────────────────────────────────────────────
deliveries.post('/', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  if (!body.customerName || !body.customerName.trim()) {
    return c.json({ message: 'Customer name is required.' }, 400);
  }
  if (!body.customerPhone || !body.customerPhone.trim()) {
    return c.json({ message: 'Customer phone is required.' }, 400);
  }
  if (!body.deliveryAddress || !body.deliveryAddress.trim()) {
    return c.json({ message: 'Delivery address is required.' }, 400);
  }

  const id = uuidv4();
  const deliveryNumber = `DEL-${Date.now()}`;
  const status = body.scheduledDate || body.driverName ? 'SCHEDULED' : 'PENDING';

  const stmts: any[] = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO deliveries (
      id, delivery_number, sales_order_id, customer_name, customer_phone,
      delivery_address, city, source_warehouse_id, driver_name, driver_phone,
      vehicle_plate, status, scheduled_date, installation_required, installer_name,
      installation_fee, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    deliveryNumber,
    body.salesOrderId || null,
    body.customerName.trim(),
    body.customerPhone.trim(),
    body.deliveryAddress.trim(),
    body.city?.trim() || 'Hargeisa',
    body.sourceWarehouseId || null,
    body.driverName?.trim() || null,
    body.driverPhone?.trim() || null,
    body.vehiclePlate?.trim() || null,
    status,
    body.scheduledDate || null,
    body.installationRequired ? 1 : 0,
    body.installerName?.trim() || null,
    Number(body.installationFee || 0),
    body.notes?.trim() || null,
    userId
  ));

  // Add delivery items if provided
  if (Array.isArray(body.items) && body.items.length > 0) {
    for (const item of body.items) {
      if (item.productId && item.quantity > 0) {
        stmts.push(c.env.DB.prepare(`
          INSERT INTO delivery_items (id, delivery_id, product_id, quantity, notes)
          VALUES (?, ?, ?, ?, ?)
        `).bind(uuidv4(), id, item.productId, Number(item.quantity), item.notes || null));
      }
    }
  } else if (body.salesOrderId) {
    // Auto-populate from sales order lines if items not provided
    const { results: solLines } = await c.env.DB.prepare(`
      SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(body.salesOrderId).all();

    for (const sol of (solLines || []) as any[]) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO delivery_items (id, delivery_id, product_id, quantity, notes)
        VALUES (?, ?, ?, ?, ?)
      `).bind(uuidv4(), id, sol.product_id, Number(sol.quantity), 'Imported from sales order'));
    }
  }

  stmts.push(createAuditLogStmt(c, 'DELIVERY_CREATE', 'deliveries', id, null, { deliveryNumber, customerName: body.customerName }));
  await c.env.DB.batch(stmts);

  const created = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

// ──────────────────────────────────────────────────────────────────────
// UPDATE DELIVERY DETAILS
// ──────────────────────────────────────────────────────────────────────
deliveries.patch('/:id', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);

  const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const vals: any[] = [];

  if (body.driverName !== undefined) { fields.push('driver_name = ?'); vals.push(body.driverName?.trim() || null); }
  if (body.driverPhone !== undefined) { fields.push('driver_phone = ?'); vals.push(body.driverPhone?.trim() || null); }
  if (body.vehiclePlate !== undefined) { fields.push('vehicle_plate = ?'); vals.push(body.vehiclePlate?.trim() || null); }
  if (body.scheduledDate !== undefined) { fields.push('scheduled_date = ?'); vals.push(body.scheduledDate || null); }
  if (body.deliveryAddress !== undefined) { fields.push('delivery_address = ?'); vals.push(body.deliveryAddress.trim()); }
  if (body.installerName !== undefined) { fields.push('installer_name = ?'); vals.push(body.installerName?.trim() || null); }
  if (body.installationFee !== undefined) { fields.push('installation_fee = ?'); vals.push(Number(body.installationFee || 0)); }
  if (body.notes !== undefined) { fields.push('notes = ?'); vals.push(body.notes?.trim() || null); }
  if (body.status !== undefined) { fields.push('status = ?'); vals.push(body.status); }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE deliveries SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();

  const updated = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  await logAudit(c, 'DELIVERY_UPDATE', 'deliveries', id, existing, updated);
  return c.json(updated);
});

// ──────────────────────────────────────────────────────────────────────
// DISPATCH DELIVERY
// ──────────────────────────────────────────────────────────────────────
deliveries.post('/:id/dispatch', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const existing = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);

  const driverName = body.driverName?.trim() || existing.driver_name;
  const vehiclePlate = body.vehiclePlate?.trim() || existing.vehicle_plate;

  await c.env.DB.prepare(`
    UPDATE deliveries
    SET status = 'DISPATCHED',
        dispatched_at = CURRENT_TIMESTAMP,
        driver_name = ?,
        vehicle_plate = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(driverName || null, vehiclePlate || null, id).run();

  await logAudit(c, 'DELIVERY_DISPATCH', 'deliveries', id, existing, { status: 'DISPATCHED', driverName, vehiclePlate });
  const updated = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  return c.json({ success: true, delivery: updated });
});

// ──────────────────────────────────────────────────────────────────────
// COMPLETE DELIVERY (PROOF OF DELIVERY)
// ──────────────────────────────────────────────────────────────────────
deliveries.post('/:id/complete', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const existing = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);

  const recipientName = body.recipientSignatureName?.trim() || existing.customer_name;
  const deliveryNotes = body.notes?.trim() || existing.notes;

  await c.env.DB.prepare(`
    UPDATE deliveries
    SET status = 'DELIVERED',
        delivered_at = CURRENT_TIMESTAMP,
        recipient_signature_name = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(recipientName, deliveryNotes, id).run();

  await logAudit(c, 'DELIVERY_COMPLETE', 'deliveries', id, existing, { status: 'DELIVERED', recipientName });
  const updated = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  return c.json({ success: true, delivery: updated });
});

export default deliveries;
