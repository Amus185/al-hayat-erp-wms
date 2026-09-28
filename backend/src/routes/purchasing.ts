import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { postPurchaseApprovalJournalEntry, postPurchasePaymentJournalEntry } from '../services/accounting-service';

const purchasing = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

purchasing.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute payment summary for a purchase invoice
// Returns: { amount_paid, net_total, balance, payment_status }
// ──────────────────────────────────────────────────────────────────────
async function getPurchaseInvoicePaymentSummary(
  db: D1Database,
  purchaseInvoiceId: string,
  totalAmount: number,
  discountAmount: number
) {
  const res = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS amount_paid FROM purchase_invoice_payments WHERE purchase_invoice_id = ?'
  ).bind(purchaseInvoiceId).first();
  const amountPaid = Number(res?.amount_paid || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);
  const balance = Math.max(0, netTotal - amountPaid);
  let payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
  return { amount_paid: amountPaid, net_total: netTotal, balance, payment_status };
}

// ──────────────────────────────────────────────────────────────────────
// SUPPLIERS
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/suppliers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers ORDER BY name').all();
  return c.json(results);
});

purchasing.post('/suppliers', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: 'Supplier name is required.' }, 400);
  }
  const id = uuidv4();
  const contact = body.contactPerson || body.contact_person || body.contactName || body.contact_name || null;
  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_person, phone, email, address, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(id, body.name.trim(), contact, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers WHERE id = ?').bind(id).all();
  await logAudit(c, 'SUPPLIER_CREATE', 'suppliers', id, null, body);
  return c.json(results[0], 201);
});

purchasing.patch('/suppliers/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Supplier not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined && body.name.trim()) { fields.push('name = ?'); vals.push(body.name.trim()); }
  if (body.contactPerson !== undefined || body.contact_person !== undefined || body.contactName !== undefined) {
    fields.push('contact_person = ?');
    vals.push(body.contactPerson ?? body.contact_person ?? body.contactName ?? null);
  }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone || null); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email || null); }
  if (body.address !== undefined) { fields.push('address = ?'); vals.push(body.address || null); }
  if (body.isActive !== undefined || body.is_active !== undefined) {
    fields.push('is_active = ?');
    vals.push((body.isActive ?? body.is_active) ? 1 : 0);
  }
  if (fields.length === 0) return c.json({ message: 'No valid fields provided to update.' }, 400);

  vals.push(id);
  await c.env.DB.prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const updated = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers WHERE id = ?').bind(id).first();
  await logAudit(c, 'SUPPLIER_UPDATE', 'suppliers', id, existing, updated);
  return c.json(updated);
});

purchasing.delete('/suppliers/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const activePO = await c.env.DB.prepare('SELECT id FROM purchase_orders WHERE supplier_id = ? LIMIT 1').bind(id).first();
  if (activePO) return c.json({ message: 'Cannot delete: supplier is linked to purchase orders.' }, 400);
  await c.env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(id).run();
  await logAudit(c, 'SUPPLIER_DELETE', 'suppliers', id, null, null);
  return c.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────
// PURCHASE ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/orders', async (c) => {
  const { search, paymentStatus, dateFrom, dateTo, supplierId } = c.req.query();

  let query = `
    SELECT po.*, s.name AS supplier_name,
           COALESCE(NULLIF(po.total_amount, 0), (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS order_total,
           (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS total_qty_ordered,
           (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS total_qty_received,
           pi.id AS purchase_invoice_id,
           COALESCE(pi.total_amount, po.total_amount, (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id)) AS invoice_total,
           COALESCE(pi.discount_amount, (SELECT COALESCE(SUM(discount_amount), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS invoice_discount,
           COALESCE((SELECT SUM(pip.amount) FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id), 0) AS amount_paid
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN purchase_invoices pi ON pi.purchase_order_id = po.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (po.po_number LIKE ? OR s.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (supplierId) {
    query += ` AND po.supplier_id = ?`;
    params.push(supplierId);
  }
  if (dateFrom) {
    query += ` AND date(po.created_at) >= date(?)`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND date(po.created_at) <= date(?)`;
    params.push(dateTo);
  }

  query += ` ORDER BY po.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Compute net_total, payment_status, balance and remaining items for each row
  const enriched = (results || []).map((row: any) => {
    const orderTotal = Number(row.order_total || row.total_amount || 0);
    const invoiceTotal = row.invoice_total != null ? Number(row.invoice_total) : orderTotal;
    const invoiceDiscount = Number(row.invoice_discount || 0);
    const netTotal = Math.max(0, invoiceTotal - invoiceDiscount) || orderTotal;
    const paid = Number(row.amount_paid || 0);
    const balance = Math.max(0, netTotal - paid);
    let payment_status = 'UNPAID';
    if (paid >= netTotal && netTotal > 0) payment_status = 'PAID';
    else if (paid > 0) payment_status = 'PARTIALLY_PAID';

    return {
      ...row,
      total_amount: orderTotal,
      net_total: netTotal,
      balance,
      payment_status,
      total_qty_ordered: Number(row.total_qty_ordered || 0),
      total_qty_received: Number(row.total_qty_received || 0),
      total_qty_remaining: Math.max(0, Number(row.total_qty_ordered || 0) - Number(row.total_qty_received || 0))
    };
  });

  // Filter by computed payment status if requested
  if (paymentStatus && paymentStatus !== 'ALL') {
    return c.json(enriched.filter((r: any) => r.payment_status === paymentStatus));
  }

  return c.json(enriched);
});

purchasing.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name,
      COALESCE(NULLIF(po.total_amount, 0), (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS total_amount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku,
      COALESCE(pol.quantity_received, (
        SELECT COALESCE(SUM(grl.quantity_received), 0) 
        FROM goods_receipt_lines grl 
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
        WHERE gr.purchase_order_id = pol.purchase_order_id AND grl.product_id = pol.product_id
      ), 0) as quantity_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
    ORDER BY pol.id ASC
  `).bind(id).all();

  const enrichedLines = (lines || []).map((l: any) => {
    const ordered = Number(l.quantity_ordered || l.quantity || 0);
    const received = Number(l.quantity_received || 0);
    return {
      ...l,
      quantity_ordered: ordered,
      quantity_received: received,
      quantity_remaining: Math.max(0, ordered - received),
    };
  });

  // Fetch all Goods Receipts history for this PO
  const { results: receipts } = await c.env.DB.prepare(`
    SELECT gr.id, gr.receipt_number, gr.received_at, gr.status, gr.notes,
           w.name AS warehouse_name, u.full_name AS received_by_name,
           (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_lines WHERE goods_receipt_id = gr.id) AS total_items_received
    FROM goods_receipts gr
    LEFT JOIN warehouses w ON w.id = gr.warehouse_id
    LEFT JOIN users u ON u.id = gr.received_by
    WHERE gr.purchase_order_id = ?
    ORDER BY gr.received_at DESC
  `).bind(id).all();

  // Ensure invoice exists or auto-backfill for existing PO
  let invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE purchase_order_id = ?'
  ).bind(id).first().catch(() => null);

  if (!invoice) {
    const invId = `pi-${id}`;
    const invNum = `PI-${(po as any).po_number || Date.now()}`;
    const tot = Number((po as any).total_amount || 0);
    const disc = enrichedLines.reduce((acc: number, l: any) => acc + Number(l.discount_amount || 0), 0);
    try {
      await c.env.DB.prepare(`
        INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
        VALUES (?, ?, ?, ?, ?, 'UNPAID')
        ON CONFLICT (id) DO NOTHING
      `).bind(invId, invNum, id, tot, disc).run();
      invoice = await c.env.DB.prepare('SELECT * FROM purchase_invoices WHERE id = ?').bind(invId).first();
    } catch {
      // Ignore conflict
    }
  }

  // Enrich invoice with payment summary and history
  let invoiceWithPayments = null;
  if (invoice) {
    const piSummary = await getPurchaseInvoicePaymentSummary(
      c.env.DB,
      invoice.id as string,
      Number(invoice.total_amount),
      Number((invoice as any).discount_amount || 0)
    );
    const { results: payments } = await c.env.DB.prepare(`
      SELECT pip.*, u.full_name AS recorded_by_name
      FROM purchase_invoice_payments pip
      LEFT JOIN users u ON u.id = pip.recorded_by
      WHERE pip.purchase_invoice_id = ?
      ORDER BY pip.created_at DESC
    `).bind(invoice.id).all();
    invoiceWithPayments = { ...invoice, ...piSummary, payments: payments || [] };
  }

  return c.json({ ...po, lines: enrichedLines, receipts: receipts || [], invoice: invoiceWithPayments });
});

purchasing.get('/orders/:id/print-invoice', async (c) => {
  const id = c.req.param('id');
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name, s.contact_name, s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address,
           w.name AS warehouse_name, w.address AS warehouse_address
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN warehouses w ON w.id = po.warehouse_id
    WHERE po.id = ?
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id).all();

  const invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE purchase_order_id = ?'
  ).bind(id).first().catch(() => null);

  let invoiceData = invoice || null;
  if (invoice) {
    const piSummary = await getPurchaseInvoicePaymentSummary(
      c.env.DB,
      invoice.id as string,
      Number(invoice.total_amount),
      Number((invoice as any).discount_amount || 0)
    );
    invoiceData = { ...invoice, ...piSummary };
  }

  return c.json({
    po,
    lines,
    invoice: invoiceData,
    supplier: {
      name: po.supplier_name,
      contactName: po.contact_name,
      phone: po.supplier_phone,
      email: po.supplier_email,
      address: po.supplier_address,
    },
    warehouse: {
      name: po.warehouse_name || 'Central Warehouse',
      address: po.warehouse_address,
    },
  });
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

  let totalAmount = 0;
  let totalDiscount = 0;
  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    totalDiscount += discountAmount;
    const lineTotal = (line.quantity * line.unitCost) - discountAmount;
    totalAmount += lineTotal;
  }

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, warehouse_id, status, total_amount, notes, expected_date, created_by)
    VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?)
  `).bind(id, poNumber, body.supplierId, body.warehouseId || null, totalAmount, body.notes || null, body.expectedDate || null, userId));

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitCost) - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost, discount_amount, line_total, quantity_received) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitCost, discountAmount, lineTotal));
  }

  // Create corresponding purchase invoice immediately so payments and AP balance can be tracked from inception
  const invoiceId = `pi-${id}`;
  const invoiceNumber = `PI-${poNumber}`;
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
    VALUES (?, ?, ?, ?, ?, 'UNPAID')
  `).bind(invoiceId, invoiceNumber, id, totalAmount, totalDiscount));

  stmts.push(createAuditLogStmt(c, 'PURCHASE_ORDER_CREATE', 'purchase_orders', id, null, { poNumber, supplierId: body.supplierId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// APPROVE PO — SUBMITTED → RECEIVED
// Creates purchase_invoice with status UNPAID (not PAID) so payments
// can be tracked from this point forward
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders/:id/approve', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first() as any;

  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'SUBMITTED') {
    return c.json({ message: `Cannot approve: PO status is already '${po.status}'.` }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(userId, id).run();

  await logAudit(c, 'PURCHASE_ORDER_APPROVE', 'purchase_orders', id, { status: 'SUBMITTED' }, { status: 'APPROVED' });

  const updated = await c.env.DB.prepare(
    'SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?'
  ).bind(id).first();

  return c.json(updated);
});

// ──────────────────────────────────────────────────────────────────────
// GOODS RECEIPT — Partial or full receipt with inventory & GL updates
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/receipts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Validate PO exists and is in receivable state
  if (!body.purchaseOrderId) return c.json({ message: 'Purchase order ID is required.' }, 400);
  const po = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(body.purchaseOrderId).first() as any;
  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'SUBMITTED' && po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
    return c.json({ message: `Cannot receive goods: PO is '${po.status}'. Must be SUBMITTED, APPROVED, or PARTIALLY_RECEIVED.` }, 400);
  }

  // Resolve warehouse
  let warehouseId = body.warehouseId || po.warehouse_id;
  if (!warehouseId) {
    const firstWH = await c.env.DB.prepare('SELECT id FROM warehouses LIMIT 1').first();
    warehouseId = firstWH?.id;
  }
  if (!warehouseId) return c.json({ message: 'No receiving warehouse specified.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one receipt line is required.' }, 400);
  }

  // Fetch all PO lines with current received counts
  const { results: poLines } = await c.env.DB.prepare(`
    SELECT pol.*, p.name AS product_name,
      COALESCE(pol.quantity_received, (
        SELECT COALESCE(SUM(grl.quantity_received), 0)
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE gr.purchase_order_id = pol.purchase_order_id AND grl.product_id = pol.product_id
      ), 0) AS current_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(body.purchaseOrderId).all();

  const poLineMap = new Map<string, any>();
  for (const pol of (poLines || []) as any[]) {
    poLineMap.set(pol.product_id, pol);
  }

  let totalReceivedThisBatch = 0;
  let batchValue = 0;

  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    const qty = Number(line.quantityReceived);
    if (!Number.isInteger(qty) || qty <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityReceived must be a positive integer.` }, 400);
    }

    const pol = poLineMap.get(line.productId);
    if (!pol) {
      return c.json({ message: `Line ${i + 1}: product is not on this purchase order.` }, 400);
    }

    const currentReceived = Number(pol.current_received || 0);
    const ordered = Number(pol.quantity);
    const remaining = ordered - currentReceived;

    if (qty > remaining) {
      return c.json({
        message: `Cannot receive ${qty} units of ${pol.product_name || 'product'}. Only ${remaining} units remaining to receive (Ordered: ${ordered}, Already received: ${currentReceived}).`
      }, 400);
    }

    totalReceivedThisBatch += qty;
    const lineUnitCost = Number(pol.unit_cost);
    const lineDiscount = Number(pol.discount_amount || 0);
    const netUnitCost = ordered > 0 ? ((ordered * lineUnitCost) - lineDiscount) / ordered : lineUnitCost;
    batchValue += (qty * netUnitCost);
  }

  // Pre-flight: gather existing stock rows
  const stockLookups = new Map<string, string | null>();
  await Promise.all(
    body.lines.map(async (line: any) => {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
      `).bind(line.productId, warehouseId).first();
      stockLookups.set(line.productId, (existing?.id as string) || null);
    })
  );

  // Build atomic batch
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  const stmts: any[] = [];

  // 1. Goods Receipt header
  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, status, received_by, notes)
    VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
  `).bind(receiptId, receiptNumber, body.purchaseOrderId, warehouseId, userId, body.notes || null));

  // 2. Receipt lines, inventory transactions, inventory stock, and PO line quantity_received
  for (const line of body.lines) {
    const pol = poLineMap.get(line.productId);
    const qty = Number(line.quantityReceived);
    const lineUnitCost = Number(pol.unit_cost);
    const lineDiscount = Number(pol.discount_amount || 0);
    const netUnitCost = Number(pol.quantity) > 0 ? ((Number(pol.quantity) * lineUnitCost) - lineDiscount) / Number(pol.quantity) : lineUnitCost;
    const lineTotal = qty * netUnitCost;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received, unit_cost, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), receiptId, line.productId, line.warehouseLocationId || null, qty, lineUnitCost, lineTotal));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, ?, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.productId, qty, warehouseId, line.warehouseLocationId || null, receiptId, userId));

    const existingStockId = stockLookups.get(line.productId);
    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        'UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(qty, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, ?)
      `).bind(uuidv4(), line.productId, warehouseId, qty));
    }

    stmts.push(c.env.DB.prepare(`
      UPDATE purchase_order_lines
      SET quantity_received = COALESCE(quantity_received, 0) + ?
      WHERE purchase_order_id = ? AND product_id = ?
    `).bind(qty, body.purchaseOrderId, line.productId));
  }

  // 3. Determine if all items across entire PO are fully received
  let allFullyReceived = true;
  for (const pol of (poLines || []) as any[]) {
    const previouslyReceived = Number(pol.current_received || 0);
    const receivingNow = body.lines.find((l: any) => l.productId === pol.product_id)?.quantityReceived || 0;
    const totalWillBe = previouslyReceived + Number(receivingNow);
    if (totalWillBe < Number(pol.quantity)) {
      allFullyReceived = false;
      break;
    }
  }

  const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  stmts.push(c.env.DB.prepare(`
    UPDATE purchase_orders
    SET status = ?,
        approved_by = COALESCE(approved_by, ?),
        approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
        warehouse_id = COALESCE(warehouse_id, ?)
    WHERE id = ?
  `).bind(newStatus, userId, warehouseId, body.purchaseOrderId));

  stmts.push(createAuditLogStmt(c, 'GOODS_RECEIPT_CREATE', 'goods_receipts', receiptId, null, {
    receiptNumber,
    purchaseOrderId: body.purchaseOrderId,
    warehouseId,
    lines: body.lines,
    newStatus,
    batchValue
  }));

  await c.env.DB.batch(stmts);

  // 4. Automatically post double-entry GL journal entry for the received batch
  try {
    if (batchValue > 0) {
      await postPurchaseApprovalJournalEntry(
        c,
        { id: po.id as string, po_number: po.po_number || po.id, branch_id: po.branch_id },
        batchValue,
        userId
      );
    }
  } catch (glErr) {
    console.warn('Accounting entry warning for goods receipt:', glErr);
  }

  const { results: receiptRows } = await c.env.DB.prepare('SELECT * FROM goods_receipts WHERE id = ?').bind(receiptId).all();
  return c.json({ success: true, receipt: receiptRows?.[0], newStatus }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// RECORD PURCHASE INVOICE PAYMENT (supplier deposit / installment)
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/invoices/:id/payments', requirePermissions(['manage_purchasing']), async (c) => {
  const purchaseInvoiceId = c.req.param('id');
  if (!purchaseInvoiceId) return c.json({ message: 'Purchase invoice id is required.' }, 400);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json();

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ message: 'Payment amount must be a positive number.' }, 400);
  }

  const paymentMethod = body.paymentMethod || 'CASH';
  const validMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WIRE'];
  if (!validMethods.includes(paymentMethod)) {
    return c.json({ message: `Invalid payment method. Must be one of: ${validMethods.join(', ')}.` }, 400);
  }

  const paymentDate = body.paymentDate || new Date().toISOString().split('T')[0];

  // Fetch purchase invoice (support both purchase_invoice_id and purchase_order_id)
  let invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE id = ? OR purchase_order_id = ?'
  ).bind(purchaseInvoiceId, purchaseInvoiceId).first() as any;

  if (!invoice) {
    const po = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(purchaseInvoiceId).first() as any;
    if (po) {
      const invId = `pi-${po.id}`;
      const invNum = `PI-${po.po_number || Date.now()}`;
      await c.env.DB.prepare(`
        INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
        VALUES (?, ?, ?, ?, 0, 'UNPAID')
      `).bind(invId, invNum, po.id, Number(po.total_amount || 0)).run();
      invoice = await c.env.DB.prepare('SELECT * FROM purchase_invoices WHERE id = ?').bind(invId).first() as any;
    }
  }

  if (!invoice) return c.json({ message: 'Purchase invoice not found.' }, 404);
  const realInvoiceId = invoice.id as string;

  // Compute current balance
  const summary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, realInvoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  if (summary.balance <= 0) {
    return c.json({ message: 'This invoice is already fully paid.' }, 400);
  }
  if (amount > summary.balance + 0.001) {
    return c.json({
      message: `Payment of $${amount.toFixed(2)} exceeds remaining balance of $${summary.balance.toFixed(2)}.`,
      balance: summary.balance,
    }, 400);
  }

  const paymentId = uuidv4();
  const isFullyPaid = Math.abs(amount - summary.balance) < 0.01;

  const stmts: any[] = [
    c.env.DB.prepare(`
      INSERT INTO purchase_invoice_payments (id, purchase_invoice_id, amount, payment_method, payment_date, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(paymentId, realInvoiceId, amount, paymentMethod, paymentDate, body.notes || null, userId),
  ];

  // Update invoice payment status (PAID or PARTIALLY_PAID)
  const newStatus = isFullyPaid ? 'PAID' : 'PARTIALLY_PAID';
  stmts.push(c.env.DB.prepare(
    "UPDATE purchase_invoices SET status = ? WHERE id = ?"
  ).bind(newStatus, realInvoiceId));

  stmts.push(createAuditLogStmt(c, 'PURCHASE_INVOICE_PAYMENT', 'purchase_invoices', realInvoiceId, null, {
    amount, paymentMethod, paymentDate, isFullyPaid
  }));

  await c.env.DB.batch(stmts);

  // Automatically post double-entry GL journal entry for Purchase Payment (Must succeed)
  try {
    await postPurchasePaymentJournalEntry(
      c,
      { id: paymentId, amount, paymentDate },
      { id: invoice.id, invoice_number: invoice.invoice_number || invoice.id, branch_id: invoice.branch_id },
      userId
    );
  } catch (glErr) {
    console.warn('Accounting entry warning for purchase payment:', glErr);
  }

  // Return updated summary
  const newSummary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, realInvoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  return c.json({ success: true, payment_id: paymentId, invoice_summary: newSummary }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// GET PURCHASE INVOICE PAYMENT HISTORY
// NEW ENDPOINT — GET /purchasing/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/invoices/:id/payments', async (c) => {
  const purchaseInvoiceId = c.req.param('id');

  const invoice = await c.env.DB.prepare(
    'SELECT id, total_amount, discount_amount FROM purchase_invoices WHERE id = ?'
  ).bind(purchaseInvoiceId).first();
  if (!invoice) return c.json({ message: 'Purchase invoice not found.' }, 404);

  const { results: payments } = await c.env.DB.prepare(`
    SELECT pip.*, u.full_name AS recorded_by_name
    FROM purchase_invoice_payments pip
    LEFT JOIN users u ON u.id = pip.recorded_by
    WHERE pip.purchase_invoice_id = ?
    ORDER BY pip.created_at ASC
  `).bind(purchaseInvoiceId).all();

  const totalAmount = Number(invoice.total_amount);
  const discountAmount = Number((invoice as any).discount_amount || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);

  let runningBalance = netTotal;
  const paymentsWithBalance = (payments || []).map((p: any) => {
    runningBalance -= Number(p.amount);
    return { ...p, running_balance: Math.max(0, runningBalance) };
  });

  const summary = await getPurchaseInvoicePaymentSummary(c.env.DB, purchaseInvoiceId, totalAmount, discountAmount);

  return c.json({
    payments: paymentsWithBalance.reverse(), // newest first
    summary,
  });
});

// ──────────────────────────────────────────────────────────────────────
// PURCHASING FINANCIAL SUMMARY — for dashboard
// NEW ENDPOINT — GET /purchasing/summary
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/summary', async (c) => {
  const { results: invoices } = await c.env.DB.prepare(`
    SELECT pi.id, pi.total_amount, COALESCE(pi.discount_amount, 0) AS discount_amount, pi.status,
           COALESCE((SELECT SUM(pip.amount) FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id), 0) AS amount_paid,
           po.status AS po_status
    FROM purchase_invoices pi
    JOIN purchase_orders po ON po.id = pi.purchase_order_id
  `).all();

  let totalOutstandingBalance = 0;
  let countUnpaid = 0;
  let countPartiallyPaid = 0;
  let depositsTotal = 0;
  let awaitingPayment = 0;

  for (const inv of (invoices || []) as any[]) {
    const netTotal = Math.max(0, Number(inv.total_amount) - Number(inv.discount_amount));
    const paid = Number(inv.amount_paid);
    const balance = Math.max(0, netTotal - paid);
    if (balance <= 0) continue;
    totalOutstandingBalance += balance;
    if (paid === 0) {
      countUnpaid++;
      awaitingPayment += balance;
    } else {
      countPartiallyPaid++;
      depositsTotal += paid;
    }
  }

  return c.json({
    total_outstanding_balance: totalOutstandingBalance,
    count_unpaid: countUnpaid,
    count_partially_paid: countPartiallyPaid,
    deposits_total: depositsTotal,
    awaiting_payment: awaitingPayment,
  });
});

export default purchasing;
