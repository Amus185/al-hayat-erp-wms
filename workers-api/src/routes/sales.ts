import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const sales = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

sales.use('/*', authMiddleware);

sales.get('/customers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM customers ORDER BY created_at DESC LIMIT 100').all();
  return c.json(results);
});

sales.post('/customers', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO customers (id, name, phone, email, address)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, body.name, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

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

sales.post('/orders', requirePermissions(['manage_sales']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;
  const id = uuidv4();
  const orderNumber = `SO-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO sales_orders (id, order_number, customer_id, branch_id, status, created_by)
    VALUES (?, ?, ?, ?, 'DRAFT', ?)
  `).bind(id, orderNumber, body.customerId || null, body.branchId, userId));

  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO sales_order_lines (id, sales_order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitPrice));
  }

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

sales.post('/orders/:id/confirm', requirePermissions(['manage_sales']), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE sales_orders SET status = 'CONFIRMED' WHERE id = ?").bind(id).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM sales_orders WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

sales.post('/orders/:id/invoice', requirePermissions(['manage_sales']), async (c) => {
  const orderId = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  
  const totalRes = await c.env.DB.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS total FROM sales_order_lines WHERE sales_order_id = ?').bind(orderId).first();
  const total = totalRes?.total || 0;

  const orderRes = await c.env.DB.prepare('SELECT branch_id FROM sales_orders WHERE id = ?').bind(orderId).first();
  const branchId = orderRes?.branch_id;

  const invoiceId = uuidv4();
  const stmts = [];

  stmts.push(c.env.DB.prepare(`
    INSERT INTO invoices (id, invoice_number, sales_order_id, total_amount)
    VALUES (?, ?, ?, ?)
  `).bind(invoiceId, `INV-${Date.now()}`, orderId, total));

  stmts.push(c.env.DB.prepare(`
    INSERT INTO invoice_lines (id, invoice_id, product_id, quantity, unit_price)
    SELECT lower(hex(randomblob(16))), ?, product_id, quantity, unit_price FROM sales_order_lines WHERE sales_order_id = ?
  `).bind(invoiceId, orderId)); // Used SQLite randomblob for bulk insert IDs

  if (branchId) {
    const { results: lines } = await c.env.DB.prepare('SELECT product_id, quantity FROM sales_order_lines WHERE sales_order_id = ?').bind(orderId).all();
    for (const line of lines) {
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND branch_id = ?
      `).bind(line.quantity, line.product_id, branchId));

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_branch_id, reference_type, reference_id, created_by)
        VALUES (?, ?, 'SALE_ISSUE', ?, 'BRANCH', ?, 'INVOICE', ?, ?)
      `).bind(uuidv4(), line.product_id, -(line.quantity as number), branchId, invoiceId, userId));
    }
  }

  stmts.push(c.env.DB.prepare("UPDATE sales_orders SET status = 'INVOICED' WHERE id = ?").bind(orderId));

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(invoiceId).all();
  return c.json(results[0], 201);
});

export default sales;
