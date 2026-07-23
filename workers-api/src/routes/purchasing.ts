import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const purchasing = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

purchasing.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// SUPPLIERS
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/suppliers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, phone, email, address, is_active FROM suppliers ORDER BY name').all();
  return c.json(results);
});

purchasing.post('/suppliers', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: 'Supplier name is required.' }, 400);
  }
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_name, phone, email, address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.contactName || null, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).all();
  await logAudit(c, 'SUPPLIER_CREATE', 'suppliers', id, null, body);
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// PURCHASE ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/orders', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    ORDER BY po.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});

purchasing.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, p.name as product_name, p.sku as variant_sku,
      (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_lines grl 
       JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
       WHERE gr.purchase_order_id = ? AND grl.product_id = pol.product_id) as quantity_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id, id).all();

  return c.json({ ...po, lines });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE PO — with full input validation
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Validate supplier
  if (!body.supplierId) return c.json({ message: 'Supplier is required.' }, 400);
  const supplier = await c.env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(body.supplierId).first();
  if (!supplier) return c.json({ message: 'Supplier does not exist.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one line item is required.' }, 400);
  }

  const seenProducts = new Set<string>();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitCost === undefined || line.unitCost === null || Number(line.unitCost) < 0) {
      return c.json({ message: `Line ${i + 1}: unitCost cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);

    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(line.productId).first();
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
  }

  const id = uuidv4();
  const poNumber = `PO-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, status, expected_date, created_by)
    VALUES (?, ?, ?, 'SUBMITTED', ?, ?)
  `).bind(id, poNumber, body.supplierId, body.expectedDate || null, userId));

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitCost) - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost, discount_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitCost, discountAmount, lineTotal));
  }

  stmts.push(createAuditLogStmt(c, 'PURCHASE_ORDER_CREATE', 'purchase_orders', id, null, { poNumber, supplierId: body.supplierId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// APPROVE PO — SUBMITTED → APPROVED (strict state check)
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders/:id/approve', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const cas = await c.env.DB.prepare(
    "UPDATE purchase_orders SET status = 'APPROVED', approved_by = ? WHERE id = ? AND status = 'SUBMITTED'"
  ).bind(userId, id).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM purchase_orders WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ message: 'Purchase order not found.' }, 404);
    return c.json({ message: `Cannot approve: PO is currently '${existing.status}'. Only SUBMITTED POs can be approved.` }, 400);
  }

  await logAudit(c, 'PURCHASE_ORDER_APPROVE', 'purchase_orders', id, { status: 'SUBMITTED' }, { status: 'APPROVED' });
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

// ──────────────────────────────────────────────────────────────────────
// GOODS RECEIPT — with validation and pre-flight stock lookups
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/receipts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Validate PO exists and is in receivable state
  if (!body.purchaseOrderId) return c.json({ message: 'Purchase order ID is required.' }, 400);
  const po = await c.env.DB.prepare('SELECT id, status FROM purchase_orders WHERE id = ?').bind(body.purchaseOrderId).first();
  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
    return c.json({ message: `Cannot receive goods: PO is '${po.status}'. Must be APPROVED or PARTIALLY_RECEIVED.` }, 400);
  }

  // Validate warehouse
  if (!body.warehouseId) return c.json({ message: 'Warehouse is required.' }, 400);
  const wh = await c.env.DB.prepare('SELECT id FROM warehouses WHERE id = ?').bind(body.warehouseId).first();
  if (!wh) return c.json({ message: 'Warehouse does not exist.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one receipt line is required.' }, 400);
  }

  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantityReceived || !Number.isInteger(line.quantityReceived) || line.quantityReceived <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityReceived must be a positive integer.` }, 400);
    }
    // Verify product is actually on this PO
    const poLine = await c.env.DB.prepare(
      'SELECT id, quantity FROM purchase_order_lines WHERE purchase_order_id = ? AND product_id = ?'
    ).bind(body.purchaseOrderId, line.productId).first();
    if (!poLine) {
      return c.json({ message: `Line ${i + 1}: product is not on this purchase order.` }, 400);
    }

    // Check for over-receiving
    const alreadyReceived = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(grl.quantity_received), 0) as total
      FROM goods_receipt_lines grl
      JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
      WHERE gr.purchase_order_id = ? AND grl.product_id = ?
    `).bind(body.purchaseOrderId, line.productId).first();
    const totalAfter = ((alreadyReceived?.total as number) || 0) + line.quantityReceived;
    if (totalAfter > (poLine.quantity as number)) {
      return c.json({ 
        message: `Line ${i + 1}: receiving ${line.quantityReceived} would total ${totalAfter}, but PO only ordered ${poLine.quantity}.` 
      }, 400);
    }
  }

  // Pre-flight: gather existing stock rows in parallel via Promise.all
  const stockLookups = new Map<string, string | null>();
  await Promise.all(
    body.lines.map(async (line: any) => {
      const existingStock = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
          AND (warehouse_location_id = ? OR (warehouse_location_id IS NULL AND ? IS NULL))
      `).bind(line.productId, body.warehouseId, line.warehouseLocationId || null, line.warehouseLocationId || null).first();
      stockLookups.set(`${line.productId}:${line.warehouseLocationId || ''}`, (existingStock?.id as string) || null);
    })
  );

  // Build atomic batch
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  const stmts: any[] = [];

  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, received_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(receiptId, receiptNumber, body.purchaseOrderId, body.warehouseId, userId));

  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received)
      VALUES (?, ?, ?, ?, ?)
    `).bind(uuidv4(), receiptId, line.productId, line.warehouseLocationId || null, line.quantityReceived));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, ?, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.productId, line.quantityReceived, body.warehouseId, line.warehouseLocationId || null, receiptId, userId));

    const stockKey = `${line.productId}:${line.warehouseLocationId || ''}`;
    const existingStockId = stockLookups.get(stockKey);

    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        'UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(line.quantityReceived, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, ?, ?)
      `).bind(uuidv4(), line.productId, body.warehouseId, line.warehouseLocationId || null, line.quantityReceived));
    }
  }

  // Check if all PO lines are now fully received using parallel queries
  const { results: poLines } = await c.env.DB.prepare(
    'SELECT pol.product_id, pol.quantity FROM purchase_order_lines pol WHERE pol.purchase_order_id = ?'
  ).bind(body.purchaseOrderId).all();

  const isIncompleteResults = await Promise.all(
    (poLines || []).map(async (poLine: any) => {
      const totalReceived = await c.env.DB.prepare(`
        SELECT COALESCE(SUM(grl.quantity_received), 0) as total
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE gr.purchase_order_id = ? AND grl.product_id = ?
      `).bind(body.purchaseOrderId, poLine.product_id).first();

      const currentQty = body.lines.find((l: any) => l.productId === poLine.product_id)?.quantityReceived || 0;
      const total = ((totalReceived?.total as number) || 0) + currentQty;

      return total < (poLine.quantity as number);
    })
  );

  const fullyReceived = !isIncompleteResults.includes(true);

  const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  stmts.push(c.env.DB.prepare("UPDATE purchase_orders SET status = ? WHERE id = ?").bind(newStatus, body.purchaseOrderId));
  stmts.push(createAuditLogStmt(c, 'GOODS_RECEIPT_CREATE', 'goods_receipts', receiptId, null, { receiptNumber, purchaseOrderId: body.purchaseOrderId, warehouseId: body.warehouseId, lines: body.lines, newPoStatus: newStatus }));

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM goods_receipts WHERE id = ?').bind(receiptId).all();
  return c.json(results[0], 201);
});

export default purchasing;
