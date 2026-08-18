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
           pi.id AS purchase_invoice_id, pi.total_amount AS invoice_total,
           COALESCE(pi.discount_amount, 0) AS invoice_discount,
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

  // Compute payment_status and balance for each row
  const enriched = (results || []).map((row: any) => {
    if (!row.purchase_invoice_id) return { ...row, payment_status: null, balance: null };
    const netTotal = Math.max(0, Number(row.invoice_total || 0) - Number(row.invoice_discount || 0));
    const paid = Number(row.amount_paid || 0);
    const balance = Math.max(0, netTotal - paid);
    let payment_status = 'UNPAID';
    if (paid >= netTotal && netTotal > 0) payment_status = 'PAID';
    else if (paid > 0) payment_status = 'PARTIALLY_PAID';
    return { ...row, net_total: netTotal, balance, payment_status };
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
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku,
      (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_lines grl 
       JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
       WHERE gr.purchase_order_id = ? AND grl.product_id = pol.product_id) as quantity_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id, id).all();

  const invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE purchase_order_id = ?'
  ).bind(id).first().catch(() => null);

  // Enrich invoice with payment summary and history if invoice exists
  let invoiceWithPayments = invoice || null;
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

  return c.json({ ...po, lines, invoice: invoiceWithPayments });
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

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, warehouse_id, status, expected_date, created_by)
    VALUES (?, ?, ?, ?, 'SUBMITTED', ?, ?)
  `).bind(id, poNumber, body.supplierId, body.warehouseId || null, body.expectedDate || null, userId));

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
// APPROVE PO — SUBMITTED → RECEIVED
// Creates purchase_invoice with status UNPAID (not PAID) so payments
// can be tracked from this point forward
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders/:id/approve', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json().catch(() => ({})) as any;

  // Fetch PO and validate
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ?
  `).bind(id).first();
  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'SUBMITTED') {
    return c.json({ message: `Cannot approve: PO is currently '${po.status}'. Only SUBMITTED POs can be approved.` }, 400);
  }

  // Resolve receiving warehouse: body.warehouseId > PO's stored warehouse_id > first warehouse
  let warehouseId = body.warehouseId || po.warehouse_id;
  if (!warehouseId) {
    const firstWH = await c.env.DB.prepare('SELECT id FROM warehouses LIMIT 1').first();
    warehouseId = firstWH?.id;
  }
  if (!warehouseId) return c.json({ message: 'No warehouse available to receive goods.' }, 400);

  // Fetch all PO lines
  const { results: poLines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name AS product_name, p.sku AS variant_sku
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id).all();

  if (!poLines || poLines.length === 0) {
    return c.json({ message: 'PO has no line items.' }, 400);
  }

  // Pre-flight: gather existing inventory_stock rows
  const stockLookups = new Map<string, string | null>();
  await Promise.all(
    poLines.map(async (line: any) => {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
      `).bind(line.product_id, warehouseId).first();
      stockLookups.set(line.product_id, (existing?.id as string) || null);
    })
  );

  // Build atomic batch
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  const invoiceId = uuidv4();
  const invoiceNumber = `PI-${Date.now()}`;
  const approved_by = userId;

  const stmts: any[] = [];

  // 1. Approve PO → RECEIVED
  stmts.push(c.env.DB.prepare(
    "UPDATE purchase_orders SET status = 'RECEIVED', approved_by = ?, warehouse_id = ? WHERE id = ?"
  ).bind(approved_by, warehouseId, id));

  // 2. Create Goods Receipt header
  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, received_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(receiptId, receiptNumber, id, warehouseId, userId));

  // 3. Per-line: GR line + inventory transaction + UPSERT stock
  let grandTotal = 0;
  let totalDiscount = 0;
  for (const line of poLines as any[]) {
    const qty = Number(line.quantity_ordered);
    const lineDiscount = Number(line.discount_amount || 0);
    const lineTotal = Number(line.line_total) || (qty * Number(line.unit_cost)) - lineDiscount;
    grandTotal += lineTotal;
    totalDiscount += lineDiscount;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received)
      VALUES (?, ?, ?, NULL, ?)
    `).bind(uuidv4(), receiptId, line.product_id, qty));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, NULL, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.product_id, qty, warehouseId, receiptId, userId));

    const existingStockId = stockLookups.get(line.product_id);
    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        'UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(qty, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, NULL, ?)
      `).bind(uuidv4(), line.product_id, warehouseId, qty));
    }
  }

  // 4. Create Purchase Invoice — status UNPAID so payments can be tracked
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
    VALUES (?, ?, ?, ?, ?, 'UNPAID')
  `).bind(invoiceId, invoiceNumber, id, grandTotal, totalDiscount));

  // 5. Audit log
  stmts.push(createAuditLogStmt(c, 'PURCHASE_ORDER_APPROVE', 'purchase_orders', id,
    { status: 'SUBMITTED' },
    { status: 'RECEIVED', warehouseId, receiptNumber, invoiceNumber }
  ));

  await c.env.DB.batch(stmts);

  // Automatically post double-entry GL journal entry for Purchase Approval & Receipt (Must succeed)
  await postPurchaseApprovalJournalEntry(c, { id: po.id as string, po_number: (po as any).po_number || po.id, branch_id: (po as any).branch_id }, grandTotal, userId);

  // Return full PO details
  const updated = await c.env.DB.prepare(`SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`).bind(id).first();
  const invoice = await c.env.DB.prepare('SELECT * FROM purchase_invoices WHERE purchase_order_id = ?').bind(id).first();
  const piSummary = invoice
    ? await getPurchaseInvoicePaymentSummary(c.env.DB, invoice.id as string, Number(invoice.total_amount), Number((invoice as any).discount_amount || 0))
    : null;

  return c.json({ ...updated, invoice: invoice ? { ...invoice, ...piSummary, payments: [] } : null });
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
        WHERE product_id = ?::text AND owner_type = 'WAREHOUSE' AND warehouse_id = ?::text AND branch_id IS NULL
          AND warehouse_location_id IS NOT DISTINCT FROM ?::text
      `).bind(line.productId, body.warehouseId, line.warehouseLocationId || null).first();
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

// ──────────────────────────────────────────────────────────────────────
// RECORD PURCHASE INVOICE PAYMENT (supplier deposit / installment)
// NEW ENDPOINT — POST /purchasing/invoices/:id/payments
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
  const invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE id = ? OR purchase_order_id = ?'
  ).bind(purchaseInvoiceId, purchaseInvoiceId).first();
  if (!invoice) return c.json({ message: 'Purchase invoice not found.' }, 404);
  const realInvoiceId = invoice.id as string;

  // Compute current balance
  const summary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, realInvoiceId,
    Number(invoice.total_amount),
    Number((invoice as any).discount_amount || 0)
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
  await postPurchasePaymentJournalEntry(
    c,
    { id: paymentId, amount, paymentDate },
    { id: (invoice as any).id, invoice_number: (invoice as any).invoice_number || (invoice as any).id, branch_id: (invoice as any).branch_id },
    userId
  );

  // Return updated summary
  const newSummary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, purchaseInvoiceId,
    Number(invoice.total_amount),
    Number((invoice as any).discount_amount || 0)
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
