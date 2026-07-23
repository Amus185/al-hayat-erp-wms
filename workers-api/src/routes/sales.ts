import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const sales = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

sales.use('/*', authMiddleware);

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

// ──────────────────────────────────────────────────────────────────────
// ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
sales.get('/orders', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, b.name AS branch_name, i.id AS invoice_id
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    ORDER BY so.created_at DESC
    LIMIT 100
  `).all();
  return c.json(results);
});

sales.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const { results: orders } = await c.env.DB.prepare(`
    SELECT so.*, c.name AS customer_name, b.name AS branch_name,
           i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total, i.status AS invoice_status
    FROM sales_orders so
    LEFT JOIN customers c ON c.id = so.customer_id
    JOIN branches b ON b.id = so.branch_id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.id = ?
  `).bind(id).all();
  
  if (!orders.length) return c.json({ message: 'Not found' }, 404);
  const order = orders[0];

  const { results: lines } = await c.env.DB.prepare(`
    SELECT sol.*, p.name AS product_name, p.sku AS product_sku
    FROM sales_order_lines sol
    LEFT JOIN products p ON p.id = sol.product_id
    WHERE sol.sales_order_id = ?
  `).bind(id).all();

  return c.json({ ...order, lines });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE ORDER — with full input validation
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

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

    // Pre-flight stock check in parallel via Promise.all
    const insufficientLines: string[] = [];
    const stockMap = new Map<string, { stockId: string; qtyOnHand: number }>();

    await Promise.all(
      lines.map(async (line: any) => {
        const stock = await c.env.DB.prepare(`
          SELECT id, quantity_on_hand FROM inventory_stock
          WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
        `).bind(line.product_id, branchId).first();

        const available = (stock?.quantity_on_hand as number) || 0;
        const requested = line.quantity as number;

        if (available < requested) {
          // Get product name for clear error
          const prod = await c.env.DB.prepare('SELECT name FROM products WHERE id = ?').bind(line.product_id).first();
          insufficientLines.push(`${prod?.name || line.product_id}: need ${requested}, available ${available}`);
        }

        stockMap.set(line.product_id as string, {
          stockId: (stock?.id as string) || '',
          qtyOnHand: available,
        });
      })
    );

    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: insufficientLines }, 400);
    }

    // Calculate total
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    const total = totalRes?.total || 0;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    // Create invoice
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount)
      VALUES (?, ?, ?, ?)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total));

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
// ──────────────────────────────────────────────────────────────────────
sales.post('/orders/:id/pay', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');

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
      'SELECT id, status FROM invoices WHERE sales_order_id = ?'
    ).bind(orderId).first();
    if (!invoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'No invoice found for this order.' }, 400);
    }
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ message: 'Invoice is already paid.' }, 409);
    }

    // Atomic payment
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id),
      c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId),
      createAuditLogStmt(c, 'SALES_ORDER_PAY', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id })
    ]);

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
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const order = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(orderId).first();
  if (!order) return c.json({ message: 'Order not found.' }, 404);
  if (order.status === 'PAID') return c.json({ message: 'Order is already completed.' }, 409);
  if (order.status === 'INVOICED') {
    // Already invoiced, just need to pay
    const invoice = await c.env.DB.prepare('SELECT id, status FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    if (!invoice) return c.json({ message: 'Order is INVOICED but no invoice found.' }, 500);
    if (invoice.status === 'PAID') {
      await c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId).run();
      return c.json({ success: true, message: 'Payment recorded.' });
    }
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").bind(invoice.id),
      c.env.DB.prepare("UPDATE sales_orders SET status = 'PAID' WHERE id = ?").bind(orderId),
      createAuditLogStmt(c, 'SALES_ORDER_COMPLETE', 'sales_orders', orderId, { status: 'INVOICED' }, { status: 'PAID', invoiceId: invoice.id })
    ]);
    return c.json({ success: true, invoiceId: invoice.id });
  }

  // Order is DRAFT or CONFIRMED — need to invoice + pay
  // CAS lock
  const validSource = order.status === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
  const cas = await c.env.DB.prepare(
    "UPDATE sales_orders SET status = 'PROCESSING' WHERE id = ? AND status = ?"
  ).bind(orderId, validSource).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    return c.json({ message: 'Order state changed concurrently. Please refresh and try again.' }, 409);
  }

  try {
    // Duplicate invoice check
    const existingInvoice = await c.env.DB.prepare('SELECT id FROM invoices WHERE sales_order_id = ?').bind(orderId).first();
    if (existingInvoice) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ?").bind(validSource).run();
      return c.json({ message: 'An invoice already exists for this order.' }, 409);
    }

    const branchId = order.branch_id;
    const { results: lines } = await c.env.DB.prepare(
      'SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).all();

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Order has no line items.' }, 400);
    }

    // Pre-flight stock check
    const insufficientLines: string[] = [];
    for (const line of lines) {
      const stock = await c.env.DB.prepare(`
        SELECT quantity_on_hand FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'BRANCH' AND branch_id = ?
      `).bind(line.product_id, branchId).first();

      const available = (stock?.quantity_on_hand as number) || 0;
      const requested = line.quantity as number;

      if (available < requested) {
        const prod = await c.env.DB.prepare('SELECT name FROM products WHERE id = ?').bind(line.product_id).first();
        insufficientLines.push(`${prod?.name || line.product_id}: need ${requested}, available ${available}`);
      }
    }

    if (insufficientLines.length > 0) {
      await c.env.DB.prepare("UPDATE sales_orders SET status = ? WHERE id = ?").bind(validSource, orderId).run();
      return c.json({ message: 'Insufficient stock for this sale.', details: insufficientLines }, 400);
    }

    // Calculate total
    const totalRes = await c.env.DB.prepare(
      'SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?'
    ).bind(orderId).first();
    const total = totalRes?.total || 0;

    // Build atomic batch
    const invoiceId = uuidv4();
    const stmts: any[] = [];

    // Create invoice (directly as PAID)
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount, status, paid_at)
      VALUES (?, ?, ?, ?, 'PAID', CURRENT_TIMESTAMP)
    `).bind(invoiceId, `INV-${Date.now()}`, orderId, total));

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

    await c.env.DB.batch(stmts);
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
// PRINT INVOICE — returns full invoice data formatted for printing
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

  return c.json({
    invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      order_number: invoice.order_number,
      status: invoice.status,
      total_amount: invoice.total_amount,
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

export default sales;
