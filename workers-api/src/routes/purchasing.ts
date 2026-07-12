import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const purchasing = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

purchasing.use('/*', authMiddleware);

purchasing.get('/suppliers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, phone, email, address, is_active FROM suppliers ORDER BY name').all();
  return c.json(results);
});

purchasing.post('/suppliers', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_name, phone, email, address)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.name, body.contactName || null, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

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

purchasing.post('/orders', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;
  const id = uuidv4();
  const poNumber = `PO-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, status, expected_date, created_by)
    VALUES (?, ?, ?, 'SUBMITTED', ?, ?)
  `).bind(id, poNumber, body.supplierId, body.expectedDate || null, userId));

  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitCost));
  }

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

purchasing.post('/orders/:id/approve', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  await c.env.DB.prepare("UPDATE purchase_orders SET status = 'APPROVED', approved_by = ? WHERE id = ?").bind(userId, id).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

purchasing.post('/receipts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;

  // This should ideally be a single batch
  const stmts = [];
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
    
    const existingStock = await c.env.DB.prepare(`
      SELECT id FROM inventory_stock
      WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL AND (warehouse_location_id = ? OR (warehouse_location_id IS NULL AND ? IS NULL))
    `).bind(line.productId, body.warehouseId, line.warehouseLocationId || null, line.warehouseLocationId || null).first();

    if (existingStock) {
      stmts.push(c.env.DB.prepare('UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(line.quantityReceived, existingStock.id));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, ?, ?)
      `).bind(uuidv4(), line.productId, body.warehouseId, line.warehouseLocationId || null, line.quantityReceived));
    }
  }

  stmts.push(c.env.DB.prepare("UPDATE purchase_orders SET status = 'PARTIALLY_RECEIVED' WHERE id = ? AND status != 'RECEIVED'").bind(body.purchaseOrderId));

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM goods_receipts WHERE id = ?').bind(receiptId).all();
  return c.json(results[0], 201);
});

export default purchasing;
