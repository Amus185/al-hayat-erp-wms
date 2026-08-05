import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { postSaleJournalEntry, postCustomerPaymentJournalEntry, fetchOpenFiscalPeriodId, fetchCoaMapForCodes, calculateOrderCogs } from '../services/accounting-service';

const sales = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

sales.use('/*', authMiddleware);

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute payment summary for an invoice
// Returns: { amount_paid, balance, payment_status }
// Never stored — always calculated from invoice_payments rows
// ──────────────────────────────────────────────────────────────────────
async function getInvoicePaymentSummary(db: D1Database, invoiceId: string, totalAmount: number, discountAmount: number) {
  const res = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS amount_paid FROM invoice_payments WHERE invoice_id = ?'
  ).bind(invoiceId).first();
  const amountPaid = Number(res?.amount_paid || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);
  const balance = Math.max(0, netTotal - amountPaid);
  let payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
  return { amount_paid: amountPaid, net_total: netTotal, balance, payment_status };
}

// ──────────────────────────────────────────────────────────────────────
// CUSTOMERS
// ──────────────────────────────────────────────────────────────────────
sales.get('/customers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM customers ORDER BY created_at DESC LIMIT 100').all();
  return c.json(results);
});

sales.post('/customers', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: 'Customer name is required.' }, 400);
  }
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO customers (id, name, phone, email, address)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name.trim(), body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

sales.patch('/customers/:id', requirePermissions(['manage_sales']), async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json<{ name?: string; phone?: string; email?: string; address?: string }>();
  const existing = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Customer not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined) { fields.push('name = ?'); vals.push(body.name.trim()); }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone || null); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email || null); }
  if (body.address !== undefined) { fields.push('address = ?'); vals.push(body.address || null); }
  if (!fields.length) return c.json({ message: 'No fields to update.' }, 400);
  vals.push(id);

  await c.env.DB.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  return c.json(row);
});

sales.delete('/customers/:id', requirePermissions(['manage_sales']), async (c) => {
  const { id } = c.req.param();
  const existing = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Customer not found.' }, 404);
  await c.env.DB.prepare('DELETE FROM customers WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});


// ──────────────────────────────────────────────────────────────────────
// ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
sales.get('/orders', async (c) => {
  const { search, status, paymentStatus, dateFrom, dateTo } = c.req.query();
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT so.*, c.name AS customer_name, b.name AS branch_name, i.id AS invoice_id,
           i.total_amount AS invoice_total, i.discount_amount AS invoice_discount, i.status AS invoice_status,
           COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS amount_paid
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — branch users only see their own branch's orders
  if (scopedBranchId) {
    query += ` AND so.branch_id = ?`;
    params.push(scopedBranchId);
  }

  if (search) {
    query += ` AND (so.order_number LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status && status !== 'ALL') {
    query += ` AND so.status = ?`;
    params.push(status);
  }
  if (dateFrom) {
    query += ` AND date(so.created_at) >= date(?)`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND date(so.created_at) <= date(?)`;
    params.push(dateTo);
  }

  query += ` ORDER BY so.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Compute payment_status and balance for each row that has an invoice
  const enriched = (results || []).map((row: any) => {
    if (!row.invoice_id) return { ...row, payment_status: null, balance: null };
    const netTotal = Math.max(0, Number(row.invoice_total || 0) - Number(row.invoice_discount || 0));
    const amountPaid = Number(row.amount_paid || 0);
    const balance = Math.max(0, netTotal - amountPaid);
    let payment_status = 'UNPAID';
    if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
    else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
    return { ...row, net_total: netTotal, balance, payment_status };
  });

  // Client-side filter by payment status (computed field — cannot be done in SQL easily)
  if (paymentStatus && paymentStatus !== 'ALL') {
    return c.json(enriched.filter((r: any) => r.payment_status === paymentStatus));
  }

  return c.json(enriched);
});

sales.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  const { results: orders } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, b.name AS branch_name,
           i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total,
           i.discount_amount AS invoice_discount, i.status AS invoice_status, i.issued_at
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.id = ?
  `).bind(id).all();
  
  if (!orders.length) return c.json({ message: 'Not found' }, 404);
  const order = orders[0] as any;

  if (scopedBranchId && order.branch_id !== scopedBranchId) {
    return c.json({ message: 'Access denied: order belongs to another branch.' }, 403);
  }

  const { results: lines } = await c.env.DB.prepare(`
    SELECT sol.*, p.name AS product_name, p.sku AS product_sku
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(id).all();

  // Enrich with payment summary if invoice exists
  let paymentSummary = null;
  let payments: any[] = [];
  if (order.invoice_id) {
    paymentSummary = await getInvoicePaymentSummary(
      c.env.DB, order.invoice_id,
      Number(order.invoice_total || 0),
      Number(order.invoice_discount || 0)
    );
    const { results: pmts } = await c.env.DB.prepare(`
      SELECT ip.*, u.full_name AS recorded_by_name
      FROM invoice_payments ip
      LEFT JOIN users u ON u.id = ip.recorded_by
      WHERE ip.invoice_id = ?
      ORDER BY ip.created_at DESC
    `).bind(order.invoice_id).all();
    payments = pmts || [];
  }

  return c.json({ ...order, lines, payment_summary: paymentSummary, payments });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE ORDER — with full input validation
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');
  const userId = payload.sub;

  // Branch isolation — branch users can only create orders for their own branch
  if (!isAdminUser(payload)) {
    body.branchId = payload.branch_id;
  }

  // Validate branch
  if (!body.branchId) return c.json({ message: 'Branch is required.' }, 400);
  const branch = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first();
  if (!branch) return c.json({ message: 'Branch does not exist.' }, 400);

  // Validate customer (optional but if provided must exist)
  if (body.customerId) {
    const customer = await c.env.DB.prepare('SELECT id FROM customers WHERE id = ?').bind(body.customerId).first();
    if (!customer) return c.json({ message: 'Customer does not exist.' }, 400);
  }

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one order line is required.' }, 400);
  }

  const seenProducts = new Set<string>();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitPrice === undefined || line.unitPrice === null || Number(line.unitPrice) < 0) {
      return c.json({ message: `Line ${i + 1}: unitPrice cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);

    const product = await c.env.DB.prepare('SELECT id, selling_price FROM products WHERE id = ?').bind(line.productId).first();
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);

    // Override client's unitPrice with the actual selling price from DB to prevent price manipulation
    line.unitPrice = product.selling_price;
  }

  const id = uuidv4();
  const orderNumber = `SO-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO sales_orders (id, order_number, customer_id, branch_id, status, created_by)
    VALUES (?, ?, ?, ?, 'DRAFT', ?)
  `).bind(id, orderNumber, body.customerId || null, body.branchId, userId));

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitPrice) - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price, discount_amount, line_total) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitPrice, discountAmount, lineTotal));
  }

  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_CREATE', 'sales_orders', id, null, { orderNumber, branchId: body.branchId, customerId: body.customerId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// CONFIRM ORDER — DRAFT → CONFIRMED (strict state machine)
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/confirm', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');

  // CAS: only transition from DRAFT
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ? AND status = 'DRAFT'"
  ).bind(id).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    return c.json({ message: `Cannot confirm: order is currently '${existing.status}'. Only DRAFT orders can be confirmed.` }, 400);
  }

  await logAudit(c, 'SALES_ORDER_CONFIRM', 'sales_orders', id, { status: 'DRAFT' }, { status: 'CONFIRMED' });
  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

// ──────────────────────────────────────────────────────────────────────
// INVOICE ORDER — CONFIRMED → INVOICED
// Pre-flight stock check, duplicate invoice guard, atomic execution
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/invoice', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  // CAS: only transition from CONFIRMED
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'INVOICING' WHERE id = ? AND status = 'CONFIRMED'"
  ).bind(orderId).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(orderId).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    if (existing.status === 'INVOICED' || existing.status === 'PAID') {
      return c.json({ message: 'This order has already been invoiced.' }, 409);
    }
    return c.json({ message: `Cannot invoice: order is currently '${existing.status}'. Only CONFIRMED orders can be invoiced.` }, 400);
  }

  try {
    // Check for existing invoice (belt-and-suspenders)
    const existingInvoice = await c.env.DB.prepare(
      'SELECT id FROM invoices WHERE sales_order_id = ?'
    ).bind(orderId).first();
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'An invoice already exists for this order.' }, 409);
    }

    const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
    const branchId = order?.branch_id;

    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Order has no line items.' }, 400);
    }

    // Pre-flight stock check — single query for all products instead of N+1 individual lookups
    const productIds = lines.map((l: any) => l.product_id as string);
    const placeholders = productIds.map(() => '?').join(', ');

    const { results: stockRows } = await c.env.DB.prepare(`
      SELECT s.id, s.product_id, s.quantity_on_hand, p.name AS product_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
    `).bind(...productIds, branchId).all();

    const stockMap = new Map<string, { stockId: string; qtyOnHand: number }>();
    const productNameMap = new Map<string, string>();
    for (const row of (stockRows || []) as any[]) {
      stockMap.set(row.product_id, {
        stockId: row.id || '',
        qtyOnHand: Number(row.quantity_on_hand) || 0,
      });
      productNameMap.set(row.product_id, row.product_name || row.product_id);
    }

    const insufficientLines: string[] = [];
    for (const line of lines) {
      const pid = line.product_id as string;
      const available = stockMap.get(pid)?.qtyOnHand || 0;
      const requested = line.quantity as number;
      if (available < requested) {
        insufficientLines.push(`${productNameMap.get(pid) || pid}: need ${requested}, available ${available}`);
      }
      if (!stockMap.has(pid)) {
        stockMap.set(pid, { stockId: '', qtyOnHand: 0 });
      }
    }

    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: insufficientLines }, 400);
    }

    // Calculate total and discount from order lines
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS total_discount FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    const subtotal = Number(totalRes?.subtotal || 0);
    const discountAmount = Number(totalRes?.total_discount || 0);
    const total = subtotal - discountAmount;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    // Create invoice — store discount so it's always available on the invoice
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, discount_amount)
      VALUES (?, ?, ?, ?, ?)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total, discountAmount));

    // Copy lines to invoice_lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));

    // Deduct inventory from branch
    for (const line of lines) {
      const qty = line.quantity as number;

      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }

    // Flip order to INVOICED
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_INVOICE', 'sales_orders', orderId, { status: 'CONFIRMED' }, { status: 'INVOICED', invoiceId, total }));

    await c.env.DB.batch(stmts);

    // Auto-post double-entry journal to Accounting
    try {
      const cogsAmount = await calculateOrderCogs(c.env.DB, orderId as string);
      await postSaleJournalEntry(c, { id: orderId, order_number: String((order as any)?.order_number || orderId), branch_id: branchId ? String(branchId) : undefined } as any, total, cogsAmount, userId);
    } catch (accErr) {
      console.error('Failed to post sale invoice accounting entry:', accErr);
    }

    const { results } = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).all();
    return c.json(results[0], 201);

  } catch (err: any) {
    // Rollback CAS lock
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
    console.error('Invoice creation failed:', err);
    return c.json({ message: 'Invoice creation failed. Order rolled back to CONFIRMED.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// PAY ORDER — INVOICED → PAID (CAS-protected duplicate payment guard)
// PRESERVED: existing endpoint, now also inserts a payment record
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/pay', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  // CAS: atomically claim the order from INVOICED → PAYING
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PAYING' WHERE id = ? AND status = 'INVOICED'"
  ).bind(orderId).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    const existing = await c.env.DB.prepare('SELECT status FROM sales_orders WHERE id = ?').bind(orderId).first();
    if (!existing) return c.json({ message: 'Order not found.' }, 404);
    if (existing.status === 'PAID') return c.json({ message: 'This order is already paid.' }, 409);
    if (existing.status === 'PAYING') return c.json({ message: 'Payment is already being processed by another request.' }, 409);
    return c.json({ message: `Cannot pay: order is currently '${existing.status}'. Only INVOICED orders can be paid.` }, 400);
  }

  try {
    // Check invoice exists and is unpaid
    const invoice = await c.env.DB.prepare(
      'SELECT id, status, total_amount, discount_amount FROM invoices WHERE sales_order_id = ?'
    ).bind(orderId).first();
    if (!invoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'No invoice found for this order.' }, 400);
    }
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Invoice is already paid.' }, 409);
    }

    // Check if there's already a payment covering the full amount
    const existingPaid = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoice.id).first();
    const alreadyPaid = Number(existingPaid?.paid || 0);
    const netTotal = Math.max(0, Number(invoice.total_amount) - Number(invoice.discount_amount || 0));
    const remaining = Math.max(0, netTotal - alreadyPaid);

    const stmts: any[] = [];

    // Insert a payment record for the remaining balance if any
    if (remaining > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
        VALUES (?, ?, ?, 'CASH', date('now'), 'Full payment via Mark as Paid', ?)
      `).bind(uuidv4(), invoice.id, remaining, userId));
    }

    // Atomic payment
    stmts.push(c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id));
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_PAY', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id }));
    await c.env.DB.batch(stmts);

    // Auto-post double-entry journal to Accounting
    try {
      const orderRow = await c.env.DB.prepare('SELECT order_number, branch_id FROM sales_orders WHERE id = ?').bind(orderId).first() as any;
      await postCustomerPaymentJournalEntry(
        c,
        { id: String((invoice as any).id || orderId), amount: remaining > 0 ? remaining : netTotal },
        { id: orderId, order_number: String(orderRow?.order_number || orderId), branch_id: orderRow?.branch_id ? String(orderRow.branch_id) : undefined } as any,
        userId
      );
    } catch (accErr) {
      console.error('Failed to post customer payment accounting entry:', accErr);
    }

    return c.json({ success: true });
  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
    } catch (_) {}
    return c.json({ message: 'Payment processing failed. Order rolled back to INVOICED.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// COMPLETE ORDER — one-click: DRAFT/CONFIRMED → INVOICED → PAID
// Respects the state machine but does it in one step with all guards
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/complete', requirePermissions(['manage_sales']), async (c) => {
  const reqStart = (c as any).reqStartTime || Date.now();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | sales.post('/orders/:id/complete') handler start`);
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const tOrder0 = Date.now();
  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT sales_orders completed (${Date.now() - tOrder0}ms)`);
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'PAID') return c.json({ message: 'Order is already completed.' }, 409);
  if (order.status === 'INVOICED') {
    // Already invoiced, just need to pay
    const invoice = await c.env.DB.prepare('SELECT id, status, total_amount, discount_amount FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    if (!invoice) return c.json({ message: 'Order is INVOICED but no invoice found.' }, 500);
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ success: true, message: 'Payment recorded.' });
    }
    const existingPaid = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM invoice_payments WHERE invoice_id = ?'
    ).bind(invoice.id).first();
    const alreadyPaid = Number(existingPaid?.paid || 0);
    const netTotal = Math.max(0, Number(invoice.total_amount) - Number(invoice.discount_amount || 0));
    const remaining = Math.max(0, netTotal - alreadyPaid);
    const stmts: any[] = [];
    if (remaining > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
        VALUES (?, ?, ?, 'CASH', date('now'), 'Full payment via Complete Sale', ?)
      `).bind(uuidv4(), invoice.id, remaining, userId));
    }
    stmts.push(c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id));
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id }));
    await c.env.DB.batch(stmts);
    return c.json({ success: true, invoiceId: invoice.id });
  }

  // Order is DRAFT or CONFIRMED — need to invoice + pay
  // CAS lock
  const validSource = order.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
  const tCas0 = Date.now();
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PROCESSING' WHERE id = ? AND status = ?"
  ).bind(orderId, validSource).run();
  console.log(`[WATERFALL] +${Date.now() - reqStart}ms | CAS update status = PROCESSING completed (${Date.now() - tCas0}ms)`);

  if (!cas.meta.changes || cas.meta.changes === 0) {
    return c.json({ message: 'Order state changed concurrently. Please refresh and try again.' }, 409);
  }

  try {
    // Duplicate invoice check
    const tDup0 = Date.now();
    const existingInvoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Duplicate invoice check completed (${Date.now() - tDup0}ms)`);
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ?").bind(validSource).run();
      return c.json({ message: 'An invoice already exists for this order.' }, 409);
    }

    const branchId = order.branch_id;
    const tLines0 = Date.now();
    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT sales_order_lines completed (${Date.now() - tLines0}ms)`);

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Order has no line items.' }, 400);
    }

    // Pre-flight stock check — single query for all products instead of N+1 individual lookups
    const productIds = lines.map((l: any) => l.product_id as string);
    const placeholders = productIds.map(() => '?').join(', ');

    const tStock0 = Date.now();
    const { results: stockRows } = await c.env.DB.prepare(`
      SELECT s.product_id, s.quantity_on_hand, p.name AS product_name
      FROM inventory_stock s
      JOIN products p ON p.id = s.product_id
      WHERE s.product_id IN (${placeholders}) AND s.owner_type = 'BRANCH' AND s.branch_id = ?
    `).bind(...productIds, branchId).all();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Consolidated stock check query completed (${Date.now() - tStock0}ms)`);

    const stockLookup = new Map<string, { qtyOnHand: number; name: string }>();
    for (const row of (stockRows || []) as any[]) {
      stockLookup.set(row.product_id, {
        qtyOnHand: Number(row.quantity_on_hand) || 0,
        name: row.product_name || row.product_id,
      });
    }

    const insufficientLines: string[] = [];
    for (const line of lines) {
      const pid = line.product_id as string;
      const info = stockLookup.get(pid);
      const available = info?.qtyOnHand || 0;
      const requested = line.quantity as number;

      if (available < requested) {
        insufficientLines.push(`${info?.name || pid}: need ${requested}, available ${available}`);
      }
    }

    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: insufficientLines }, 400);
    }

    // Calculate total and discount
    const tTotal0 = Date.now();
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS subtotal, COALESCE(SUM(discount_amount), 0) AS total_discount FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | SELECT order total/discount completed (${Date.now() - tTotal0}ms)`);
    const subtotal = Number(totalRes?.subtotal || 0);
    const discountAmount = Number(totalRes?.total_discount || 0);
    const total = subtotal - discountAmount;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    // Create invoice (directly as PAID)
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, discount_amount, status, paid_at)
      VALUES (?, ?, ?, ?, ?, 'PAID', CURRENT_TIMESTAMP)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total, discountAmount));

    // Insert a full payment record
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
      VALUES (?, ?, ?, 'CASH', date('now'), 'Full payment via Complete Sale', ?)
    `).bind(uuidv4(), invoiceId, total > 0 ? total : 0, userId));

    // Copy lines
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
      SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
    `).bind(invoiceId, orderId));

    // Deduct inventory
    for (const line of lines) {
      const qty = line.quantity as number;
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(qty, line.product_id, branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -qty, branchId, invoiceId, userId));
    }

    // Finalize order as PAID
    stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId));
    stmts.push(createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: validSource }, { status: 'PAID', invoiceId, total }));

    const tBatch0 = Date.now();
    await c.env.DB.batch(stmts);
    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Main sale write batch (${stmts.length} stmts) completed (${Date.now() - tBatch0}ms)`);

    // Automatically post double-entry GL journal entries for Sale Completion & Payment
    // Task 1: Pre-fetch shared context ONCE for both journal entries.
    //   - Fiscal period: same date for both entries → fetch once, pass in.
    //   - CoA codes: Sale needs {1020,4010}, Payment needs {1010,1020} → union {1010,1020,4010} → single IN() query.
    //   - GL running_balance: NOT pre-fetched here — account 1020 is written by the
    //     first entry and read by the second, so the reads must be sequential (see Task 2 analysis).
    try {
      const entryDate = new Date().toISOString().split('T')[0];

      const tGlPre0 = Date.now();
      const [sharedFiscalPeriodId, sharedCoaMap] = await Promise.all([
        fetchOpenFiscalPeriodId(c.env.DB, entryDate),
        fetchCoaMapForCodes(c.env.DB, ['1010', '1020', '4010']),
      ]);
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | GL pre-fetch (fiscal period + 3 CoA codes) completed (${Date.now() - tGlPre0}ms)`);

      const tGl1_0 = Date.now();
      const cogsAmount = await calculateOrderCogs(c.env.DB, order.id as string);
      await postSaleJournalEntry(
        c,
        { id: order.id as string, order_number: (order as any).order_number as string || (order.id as string), branch_id: (order as any).branch_id ? String((order as any).branch_id) : undefined },
        total,
        cogsAmount,
        userId,
        sharedFiscalPeriodId || undefined,
        sharedCoaMap
      );
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | postSaleJournalEntry completed (${Date.now() - tGl1_0}ms)`);

      // NOTE: postCustomerPaymentJournalEntry runs AFTER the first batch commits.
      // Account 1020 was debited by the sale entry; the payment entry reads its
      // updated running_balance. The GL read inside is therefore intentionally live.
      const tGl2_0 = Date.now();
      await postCustomerPaymentJournalEntry(
        c,
        { id: invoiceId, amount: total },
        { id: order.id as string, order_number: (order as any).order_number as string || (order.id as string), branch_id: (order as any).branch_id as string },
        userId,
        sharedFiscalPeriodId,  // fiscal period is the same — safe to reuse
        sharedCoaMap           // CoA codes are static config — safe to reuse
      );
      console.log(`[WATERFALL] +${Date.now() - reqStart}ms | postCustomerPaymentJournalEntry completed (${Date.now() - tGl2_0}ms)`);
    } catch (glErr) {
      console.error('Non-fatal GL posting error:', glErr);
    }

    console.log(`[WATERFALL] +${Date.now() - reqStart}ms | Complete sale request finished! Sending JSON response.`);
    return c.json({ success: true, invoiceId, total });

  } catch (err: any) {
    try {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
    } catch (_) {}
    console.error('Order completion failed:', err);
    return c.json({ message: 'Order completion failed. Rolled back.', error: err?.message }, 500);
  }
});

// ──────────────────────────────────────────────────────────────────────
// RECORD INVOICE PAYMENT — partial / installment payment
// NEW ENDPOINT — POST /sales/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
sales.post('/invoices/:id/payments', requirePermissions(['manage_sales']), async (c) => {
  const invoiceId = c.req.param('id');
  if (!invoiceId) return c.json({ message: 'Invoice id is required.' }, 400);
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

  // Fetch invoice
  const invoice = await c.env.DB.prepare(
    'SELECT i.*, so.id AS order_id FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id WHERE i.id = ?'
  ).bind(invoiceId).first();
  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  // Compute current balance
  const summary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  if (summary.balance <= 0) {
    return c.json({ message: 'This invoice is already fully paid.' }, 400);
  }
  if (amount > summary.balance + 0.001) { // tiny float tolerance
    return c.json({
      message: `Payment of $${amount.toFixed(2)} exceeds remaining balance of $${summary.balance.toFixed(2)}.`,
      balance: summary.balance,
    }, 400);
  }

  const paymentId = uuidv4();
  const isFullyPaid = Math.abs(amount - summary.balance) < 0.01;

  const stmts: any[] = [
    c.env.DB.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, payment_date, notes, recorded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(paymentId, invoiceId, amount, paymentMethod, paymentDate, body.notes || null, userId),
  ];

  // Auto-close invoice and order if fully paid
  if (isFullyPaid) {
    stmts.push(c.env.DB.prepare(
      "UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(invoiceId));
    stmts.push(c.env.DB.prepare(
      "UPDATE sales_orders SET status = 'PAID' WHERE id = ?"
    ).bind(invoice.order_id));
  }

  stmts.push(createAuditLogStmt(c, 'INVOICE_PAYMENT_RECORD', 'invoices', invoiceId, null, {
    amount, paymentMethod, paymentDate, isFullyPaid
  }));

  await c.env.DB.batch(stmts);

  // Automatically post double-entry GL journal entry for Customer Payment
  try {
    await postCustomerPaymentJournalEntry(
      c,
      { id: paymentId, amount, paymentDate },
      { id: (invoice as any).order_id, order_number: (invoice as any).invoice_number || (invoice as any).id, branch_id: (invoice as any).branch_id },
      userId
    );
  } catch (accErr) {
    console.error('Failed to post customer payment accounting entry:', accErr);
  }

  // Return updated summary
  const newSummary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  return c.json({ success: true, payment_id: paymentId, invoice_summary: newSummary }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// GET INVOICE PAYMENT HISTORY
// NEW ENDPOINT — GET /sales/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
sales.get('/invoices/:id/payments', async (c) => {
  const invoiceId = c.req.param('id');

  const invoice = await c.env.DB.prepare(
    'SELECT id, total_amount, discount_amount FROM invoices WHERE id = ?'
  ).bind(invoiceId).first();
  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  const { results: payments } = await c.env.DB.prepare(`
    SELECT ip.*, u.full_name AS recorded_by_name
    FROM invoice_payments ip
    LEFT JOIN users u ON u.id = ip.recorded_by
    WHERE ip.invoice_id = ?
    ORDER BY ip.created_at ASC
  `).bind(invoiceId).all();

  // Compute running balance per payment (newest first for display, but calculate ascending)
  const totalAmount = Number(invoice.total_amount);
  const discountAmount = Number(invoice.discount_amount || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);

  let runningBalance = netTotal;
  const paymentsWithBalance = (payments || []).map((p: any) => {
    runningBalance -= Number(p.amount);
    return { ...p, running_balance: Math.max(0, runningBalance) };
  });

  const summary = await getInvoicePaymentSummary(c.env.DB, invoiceId, totalAmount, discountAmount);

  return c.json({
    payments: paymentsWithBalance.reverse(), // newest first
    summary,
  });
});

// ──────────────────────────────────────────────────────────────────────
// FINANCIAL SUMMARY — outstanding balances for dashboard
// NEW ENDPOINT — GET /sales/summary
// ──────────────────────────────────────────────────────────────────────
sales.get('/summary', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  // Total outstanding — scoped to branch if branch user
  let summaryQuery = `
    SELECT i.id, i.total_amount, COALESCE(i.discount_amount, 0) AS discount_amount,
           COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS amount_paid
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    WHERE i.status != 'CANCELLED'
  `;
  const summaryParams: any[] = [];
  if (scopedBranchId) {
    summaryQuery += ' AND so.branch_id = ?';
    summaryParams.push(scopedBranchId);
  }

  const stmt = c.env.DB.prepare(summaryQuery);
  const { results: invoices } = summaryParams.length > 0 ? await stmt.bind(...summaryParams).all() : await stmt.all();

  let totalOutstandingBalance = 0;
  let countUnpaid = 0;
  let countPartiallyPaid = 0;
  let totalUnpaidAmount = 0;
  let totalPartiallyPaidBalance = 0;

  for (const inv of (invoices || []) as any[]) {
    const netTotal = Math.max(0, Number(inv.total_amount) - Number(inv.discount_amount));
    const paid = Number(inv.amount_paid);
    const balance = Math.max(0, netTotal - paid);
    if (balance <= 0) continue;
    totalOutstandingBalance += balance;
    if (paid === 0) {
      countUnpaid++;
      totalUnpaidAmount += balance;
    } else {
      countPartiallyPaid++;
      totalPartiallyPaidBalance += balance;
    }
  }

  return c.json({
    total_outstanding_balance: totalOutstandingBalance,
    count_unpaid: countUnpaid,
    total_unpaid_amount: totalUnpaidAmount,
    count_partially_paid: countPartiallyPaid,
    total_partially_paid_balance: totalPartiallyPaidBalance,
  });
});

// ──────────────────────────────────────────────────────────────────────
// PRINT INVOICE — returns full invoice data formatted for printing
// UPDATED: now includes discount, amount_paid, balance
// ──────────────────────────────────────────────────────────────────────
sales.get('/invoices/:id/print', async (c) => {
  const invoiceId = c.req.param('id');

  const invoice = await c.env.DB.prepare(`
    SELECT i.*, so.order_number, so.branch_id,
           c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.address AS customer_address,
           b.name AS branch_name, b.city AS branch_city, b.address AS branch_address, b.phone AS branch_phone
    FROM invoices i
    JOIN sales_orders so ON so.id = i.sales_order_id
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    WHERE i.id = ?
  `).bind(invoiceId).first();

  if (!invoice) return c.json({ message: 'Invoice not found.' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT il.*, p.name AS product_name, p.sku AS product_sku, p.barcode AS product_barcode
    FROM invoice_lines il
    JOIN products p ON p.id = il.product_id
    WHERE il.invoice_id = ?
  `).bind(invoiceId).all();

  const summary = await getInvoicePaymentSummary(
    c.env.DB, invoiceId,
    Number(invoice.total_amount),
    Number((invoice as any).discount_amount || 0)
  );

  return c.json({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      order_number: invoice.order_number,
      status: invoice.status,
      total_amount: invoice.total_amount,
      discount_amount: (invoice as any).discount_amount || 0,
      net_total: summary.net_total,
      amount_paid: summary.amount_paid,
      balance: summary.balance,
      payment_status: summary.payment_status,
      issued_at: invoice.issued_at,
      paid_at: invoice.paid_at,
    },
    customer: {
      name: invoice.customer_name || 'Walk-in Customer',
      phone: invoice.customer_phone || null,
      email: invoice.customer_email || null,
      address: invoice.customer_address || null,
    },
    branch: {
      name: invoice.branch_name,
      city: invoice.branch_city,
      address: invoice.branch_address,
      phone: invoice.branch_phone,
    },
    lines: lines.map((l: any) => ({
      product_name: l.product_name,
      product_sku: l.product_sku,
      product_barcode: l.product_barcode,
      quantity: l.quantity,
      unit_price: l.unit_price,
      subtotal: (l.quantity as number) * (l.unit_price as number),
    })),
  });
});

// ──────────────────────────────────────────────────────────────────────
// CANCEL ORDER — DRAFT/CONFIRMED/INVOICED → CANCELLED
// Discards sale without moving stock or creating accounting entries
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/cancel', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'PAID') {
    return c.json({ message: 'Cannot cancel a fully paid sale.' }, 400);
  }
  if (order.status === 'CANCELLED') {
    return c.json({ message: 'Order is already cancelled.' }, 400);
  }

  const prevStatus = order.status;
  await c.env.DB.prepare("UPDATE sales_orders SET status = 'CANCELLED' WHERE id = ?").bind(orderId).run();
  await logAudit(c, 'SALES_ORDER_CANCEL', 'sales_orders', orderId, { status: prevStatus }, { status: 'CANCELLED' });

  return c.json({ success: true, message: 'Sales order cancelled successfully.' });
});

// ──────────────────────────────────────────────────────────────────────
// DELETE ORDER — Admin / Manage Sales override
// Permanently deletes sales order and associated invoice/payments
// ──────────────────────────────────────────────────────────────────────
sales.delete('/orders/:id', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  const payload = c.get('jwtPayload');
  const admin = isAdminUser(payload);
  const scopedBranchId = admin ? null : payload.branch_id;

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).first();
  if (!order) return c.json({ message: 'Sales order not found' }, 404);

  if (scopedBranchId && (order as any).branch_id !== scopedBranchId) {
    return c.json({ message: 'Access denied: order belongs to another branch.' }, 403);
  }

  // Find invoice if any
  const invoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(id).first();
  const invoiceId = invoice ? (invoice as any).id : null;

  const stmts = [];
  if (invoiceId) {
    stmts.push(c.env.DB.prepare('DELETE FROM invoice_payments WHERE invoice_id = ?').bind(invoiceId));
    stmts.push(c.env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoiceId));
    stmts.push(c.env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(invoiceId));
  }
  stmts.push(c.env.DB.prepare('DELETE FROM sales_order_lines WHERE sales_order_id = ?').bind(id));
  stmts.push(c.env.DB.prepare('DELETE FROM sales_orders WHERE id = ?').bind(id));
  stmts.push(createAuditLogStmt(c, 'SALES_ORDER_DELETE', 'sales_orders', id, order, null));

  await c.env.DB.batch(stmts);
  return c.json({ success: true });
});

export default sales;
