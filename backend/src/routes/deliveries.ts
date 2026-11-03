import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { csvResponse, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';
import { resolveLoc, locSql, type Loc } from '../services/branch-scope';

const deliveries = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

deliveries.use('/*', authMiddleware);

// A delivery belongs to a branch (its own column, else its sales order's) and ships from a warehouse.
const SCOPE_COLS = { branch: 'COALESCE(d.branch_id, so.branch_id)', warehouse: 'd.source_warehouse_id' };

/** A delivery, only if it is within the caller's location. */
async function deliveryOr404(c: any, id: string): Promise<any | null> {
  const loc = await resolveLoc(c);
  return c.env.DB.prepare(`
    SELECT d.* FROM deliveries d LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    WHERE d.id = ? ${locSql(loc, SCOPE_COLS)}`).bind(id).first();
}

// ──────────────────────────────────────────────────────────────────────
// KPI STATS
// ──────────────────────────────────────────────────────────────────────
deliveries.get('/stats', async (c) => {
  const db = c.env.DB;
  const scope = locSql(await resolveLoc(c), SCOPE_COLS);
  const from = 'FROM deliveries d LEFT JOIN sales_orders so ON so.id = d.sales_order_id';

  const total = await db.prepare(`SELECT COUNT(*) AS count ${from} WHERE 1=1 ${scope}`).first();
  const pending = await db.prepare(`SELECT COUNT(*) AS count ${from} WHERE d.status IN ('PENDING', 'SCHEDULED') ${scope}`).first();
  const dispatched = await db.prepare(`SELECT COUNT(*) AS count ${from} WHERE d.status = 'DISPATCHED' ${scope}`).first();
  const deliveredToday = await db.prepare(`
    SELECT COUNT(*) AS count ${from}
    WHERE d.status = 'DELIVERED' AND date(d.delivered_at) = CURRENT_DATE ${scope}
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
const DELIVERY_LIST: ListOptions = {
  sortable: {
    date: 'created_at', number: 'delivery_number', customer: 'customer_name', status: 'status',
    scheduled: 'scheduled_date', driver: 'driver_name', order: 'order_number', branch: 'branch_name',
  },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

deliveries.get('/', async (c) => {
  const { status, driver, dateFrom, dateTo } = c.req.query();
  const search = c.req.query('search') || c.req.query('q');
  const listReq = listRequest(c, DELIVERY_LIST);

  let query = `
    SELECT d.*, so.order_number, b.name AS branch_name, u.full_name AS created_by_name,
           (SELECT COUNT(*) FROM delivery_items di WHERE di.delivery_id = d.id) AS total_items,
           (SELECT COALESCE(SUM(di.quantity), 0) FROM delivery_items di WHERE di.delivery_id = d.id) AS total_units
    FROM deliveries d
    LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    LEFT JOIN branches b ON b.id = COALESCE(d.branch_id, so.branch_id)
    LEFT JOIN users u ON u.id = d.created_by
    WHERE 1=1 ${locSql(await resolveLoc(c), SCOPE_COLS)}
  `;
  const params: any[] = [];

  // (paged lists filter the status outside, so the status tabs can count them all)
  if (status && status !== 'ALL' && !listReq.paged) {
    query += ` AND d.status = ?`;
    params.push(status);
  }

  if (search) {
    query += ` AND (d.delivery_number ILIKE ? OR d.customer_name ILIKE ? OR d.customer_phone ILIKE ? OR d.delivery_address ILIKE ? OR so.order_number ILIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (driver) {
    query += ` AND d.driver_name ILIKE ?`;
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

  if (listReq.paged) {
    const statusWhere: string[] = [];
    const statusParams: unknown[] = [];
    if (status && status !== 'ALL') { statusWhere.push('status = ?'); statusParams.push(status); }
    const base = `FROM (${query}) x ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;
    const { rows, total } = await pagedRows(c.env.DB, '*', base, [...params, ...statusParams], listReq);
    if (listReq.csv) {
      return csvResponse(c, 'deliveries', [
        { label: 'Delivery', value: (d: any) => d.delivery_number },
        { label: 'Order', value: (d: any) => d.order_number },
        { label: 'Created', value: (d: any) => String(d.created_at instanceof Date ? d.created_at.toISOString() : d.created_at).slice(0, 10) },
        { label: 'Scheduled', value: (d: any) => d.scheduled_date ? String(d.scheduled_date instanceof Date ? d.scheduled_date.toISOString() : d.scheduled_date).slice(0, 10) : '' },
        { label: 'Customer', value: (d: any) => d.customer_name },
        { label: 'Phone', value: (d: any) => d.customer_phone },
        { label: 'Address', value: (d: any) => d.delivery_address },
        { label: 'Driver', value: (d: any) => d.driver_name },
        { label: 'Status', value: (d: any) => d.status },
        { label: 'Units', value: (d: any) => d.total_units },
      ], rows);
    }
    const { results: grouped } = await c.env.DB.prepare(`SELECT status, COUNT(*)::int AS n FROM (${query}) x GROUP BY status`).bind(...params).all();
    const counts: Record<string, number> = { ALL: 0 };
    for (const g of (grouped || []) as any[]) { counts[g.status] = Number(g.n); counts.ALL += Number(g.n); }
    return pagedResponse(c, listReq, rows, total, { counts });
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
    SELECT d.*, so.order_number, b.name AS branch_name, u.full_name AS created_by_name
    FROM deliveries d
    LEFT JOIN sales_orders so ON so.id = d.sales_order_id
    LEFT JOIN branches b ON b.id = COALESCE(d.branch_id, so.branch_id)
    LEFT JOIN users u ON u.id = d.created_by
    WHERE d.id = ? ${locSql(await resolveLoc(c), SCOPE_COLS)}
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

  let customerName = body.customerName?.trim();
  let customerPhone = body.customerPhone?.trim();
  let deliveryAddress = body.deliveryAddress?.trim();
  let city = body.city?.trim() || 'Hargeisa';
  // Which branch the delivery belongs to: its sales order's, else the caller's own.
  const loc = await resolveLoc(c);
  let deliveryBranch: string | null = loc.kind === 'BRANCH' ? loc.branchId : null;

  // Prevent duplicate deliveries for the same sales order
  if (body.salesOrderId) {
    const existingDelivery = await c.env.DB.prepare(
      "SELECT id, delivery_number, status FROM deliveries WHERE sales_order_id = ? AND status != 'CANCELLED' LIMIT 1"
    ).bind(body.salesOrderId).first() as any;

    if (existingDelivery) {
      if (existingDelivery.status === 'DELIVERED') {
        return c.json({
          message: `This sales order has already been delivered (${existingDelivery.delivery_number}). Duplicate delivery is not permitted.`
        }, 400);
      }
      return c.json({
        message: `A delivery is already active for this sales order (${existingDelivery.delivery_number} - Status: ${existingDelivery.status}). Duplicate delivery cannot be created.`
      }, 400);
    }

    // Auto-populate customer information and branch from the sales order
    const so = await c.env.DB.prepare(`
      SELECT so.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city
      FROM sales_orders so
      LEFT JOIN customers c ON c.id = so.customer_id
      WHERE so.id = ?
    `).bind(body.salesOrderId).first() as any;

    if (so && loc.kind === 'BRANCH' && so.branch_id !== loc.branchId) {
      return c.json({ message: 'Sales order not found.' }, 404);
    }
    if (!so && loc.kind !== 'ALL') return c.json({ message: 'Sales order not found.' }, 404);
    if (so?.branch_id) deliveryBranch = so.branch_id;
    if (so) {
      customerName = customerName || so.customer_name || 'Customer';
      customerPhone = customerPhone || so.customer_phone || 'N/A';
      deliveryAddress = deliveryAddress || so.customer_address || 'Customer Location';
      city = city || so.customer_city || 'Hargeisa';
    }
  } else if (body.customerId) {
    const cust = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(body.customerId).first() as any;
    if (cust) {
      customerName = customerName || cust.name || 'Customer';
      customerPhone = customerPhone || cust.phone || 'N/A';
      deliveryAddress = deliveryAddress || cust.address || 'Customer Location';
      city = city || cust.city || 'Hargeisa';
    }
  }

  if (!customerName) {
    return c.json({ message: 'Please select a Sales Order or Customer to schedule delivery.' }, 400);
  }
  if (!customerPhone) customerPhone = 'N/A';
  if (!deliveryAddress) deliveryAddress = 'Customer Location';

  const id = uuidv4();
  const deliveryNumber = `DEL-${Date.now()}`;
  const status = body.scheduledDate || body.driverName ? 'SCHEDULED' : 'PENDING';
  const totalBoxes = Math.max(1, Number(body.totalBoxes || 1));

  const stmts: any[] = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO deliveries (
      id, delivery_number, sales_order_id, customer_name, customer_phone,
      delivery_address, city, source_warehouse_id, driver_name, driver_phone,
      vehicle_plate, status, scheduled_date, installation_required, installer_name,
      installation_fee, notes, total_boxes, delivered_boxes, remaining_boxes, created_by, branch_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(
    id,
    deliveryNumber,
    body.salesOrderId || null,
    customerName,
    customerPhone,
    deliveryAddress,
    city,
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
    totalBoxes,
    totalBoxes,
    userId,
    deliveryBranch
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

  const existing = await deliveryOr404(c, id as string);
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
  if (body.totalBoxes !== undefined) {
    const tb = Math.max(1, Number(body.totalBoxes));
    fields.push('total_boxes = ?');
    vals.push(tb);
    fields.push('remaining_boxes = GREATEST(0, ? - COALESCE(delivered_boxes, 0))');
    vals.push(tb);
  }

  vals.push(id);
  await c.env.DB.prepare(`UPDATE deliveries SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();

  const updated = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  await logAudit(c, 'DELIVERY_UPDATE', 'deliveries', id, existing, updated);
  return c.json(updated);
});

// A delivery whose order was cancelled, or that is already cancelled or
// delivered, must not move (completing it used to mark a cancelled order DELIVERED).
async function deliveryBlockReason(db: any, delivery: any): Promise<string | null> {
  if (delivery.status === 'CANCELLED') return 'This delivery is cancelled.';
  if (delivery.status === 'DELIVERED') return 'This delivery is already completed.';
  if (delivery.sales_order_id) {
    const so = await db.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(delivery.sales_order_id).first();
    if (so?.status === 'CANCELLED') return 'The sales order for this delivery was cancelled.';
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// DISPATCH DELIVERY
// ──────────────────────────────────────────────────────────────────────
deliveries.post('/:id/dispatch', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const existing = await deliveryOr404(c, id as string);
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);
  const blocked = await deliveryBlockReason(c.env.DB, existing);
  if (blocked) return c.json({ message: blocked }, 400);

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

  const existing = await deliveryOr404(c, id as string);
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);
  const blocked = await deliveryBlockReason(c.env.DB, existing);
  if (blocked) return c.json({ message: blocked }, 400);

  const recipientName = body.recipientSignatureName?.trim() || existing.customer_name;
  const deliveryNotes = body.notes?.trim() || existing.notes;
  const currentTotal = Number(existing.total_boxes || 1);

  await c.env.DB.prepare(`
    UPDATE deliveries
    SET status = 'DELIVERED',
        delivered_at = CURRENT_TIMESTAMP,
        delivered_boxes = ?,
        remaining_boxes = 0,
        recipient_signature_name = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(currentTotal, recipientName, deliveryNotes, id).run();

  if (existing.sales_order_id) {
    await c.env.DB.prepare(
      "UPDATE sales_orders SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'CANCELLED'"
    ).bind(existing.sales_order_id).run();
  }

  await logAudit(c, 'DELIVERY_COMPLETE', 'deliveries', id, existing, { status: 'DELIVERED', recipientName });
  const updated = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  return c.json({ success: true, delivery: updated });
});

// ──────────────────────────────────────────────────────────────────────
// DELIVERY RUNS & MULTI-BOX TRACKING (SPLIT DELIVERIES)
// ──────────────────────────────────────────────────────────────────────
deliveries.get('/:id/runs', async (c) => {
  const id = c.req.param('id');
  if (!(await deliveryOr404(c, id as string))) return c.json({ message: 'Delivery not found' }, 404);
  const { results } = await c.env.DB.prepare(`
    SELECT dr.*, u.full_name AS created_by_name
    FROM delivery_runs dr
    LEFT JOIN users u ON u.id = dr.created_by
    WHERE dr.delivery_id = ?
    ORDER BY dr.delivered_at DESC, dr.created_at DESC
  `).bind(id).all();
  return c.json(results || []);
});

deliveries.post('/:id/runs', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  const existing = await deliveryOr404(c, id as string);
  if (!existing) return c.json({ message: 'Delivery not found' }, 404);
  const blocked = await deliveryBlockReason(c.env.DB, existing);
  if (blocked) return c.json({ message: blocked }, 400);

  const boxesDelivered = Math.max(1, Number(body.boxesDelivered || 1));
  const currentTotal = Math.max(1, Number(existing.total_boxes || 1));
  const currentDelivered = Number(existing.delivered_boxes || 0);
  const newDelivered = Math.min(currentTotal, currentDelivered + boxesDelivered);
  const newRemaining = Math.max(0, currentTotal - newDelivered);

  let newStatus = 'PARTIALLY_DELIVERED';
  if (newRemaining === 0 || newDelivered >= currentTotal) {
    newStatus = 'DELIVERED';
  }

  const runId = uuidv4();
  const stmts: any[] = [];

  stmts.push(c.env.DB.prepare(`
    INSERT INTO delivery_runs (
      id, delivery_id, boxes_delivered, handled_by, driver_name, driver_phone,
      vehicle_plate, delivered_at, notes, recipient_signature_name, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    runId,
    id,
    boxesDelivered,
    body.handledBy?.trim() || body.driverName?.trim() || existing.driver_name || null,
    body.driverName?.trim() || existing.driver_name || null,
    body.driverPhone?.trim() || existing.driver_phone || null,
    body.vehiclePlate?.trim() || existing.vehicle_plate || null,
    body.deliveredAt || new Date().toISOString(),
    body.notes?.trim() || null,
    body.recipientSignatureName?.trim() || null,
    userId
  ));

  const deliveredAtClause = newStatus === 'DELIVERED' ? ', delivered_at = CURRENT_TIMESTAMP' : '';
  stmts.push(c.env.DB.prepare(`
    UPDATE deliveries
    SET delivered_boxes = ?,
        remaining_boxes = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
        ${deliveredAtClause}
    WHERE id = ?
  `).bind(newDelivered, newRemaining, newStatus, id));

  if (newStatus === 'DELIVERED' && existing.sales_order_id) {
    stmts.push(c.env.DB.prepare(
      "UPDATE sales_orders SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'CANCELLED'"
    ).bind(existing.sales_order_id));
  }

  stmts.push(createAuditLogStmt(c, 'DELIVERY_RUN_RECORD', 'deliveries', id, existing, {
    boxesDelivered,
    newDelivered,
    newRemaining,
    newStatus,
  }));

  await c.env.DB.batch(stmts);

  const updatedDelivery = await c.env.DB.prepare('SELECT * FROM deliveries WHERE id = ?').bind(id).first();
  const createdRun = await c.env.DB.prepare('SELECT * FROM delivery_runs WHERE id = ?').bind(runId).first();

  return c.json({ success: true, delivery: updatedDelivery, run: createdRun }, 201);
});

export default deliveries;
