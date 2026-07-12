import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const inventory = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

inventory.use('/*', authMiddleware);

inventory.get('/stock', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.barcode, s.owner_type, s.quantity_on_hand, s.quantity_reserved,
           w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    ORDER BY p.name
    LIMIT 100
  `).all();
  return c.json(results);
});

inventory.get('/transactions', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, p.name, p.sku, p.barcode,
           w.name AS destination_warehouse,
           b.name AS destination_branch,
           l.aisle, l.rack, l.shelf, l.bin,
           u.full_name AS user_name
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN warehouses w ON w.id = t.destination_warehouse_id
    LEFT JOIN branches b ON b.id = t.destination_branch_id
    LEFT JOIN warehouse_locations l ON l.id = t.destination_location_id
    LEFT JOIN users u ON u.id = t.created_by
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all();
  return c.json(results);
});

inventory.post('/adjust', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;
  const delta = body.direction === 'INCREASE' ? body.quantity : -body.quantity;
  const transactionType = delta > 0 ? 'ADJUSTMENT_POSITIVE' : 'ADJUSTMENT_NEGATIVE';
  const ownerType = body.warehouseId ? 'WAREHOUSE' : 'BRANCH';

  // SQLite D1 doesn't support traditional transactions across multiple query calls easily without batching,
  // but we can execute them sequentially. For real robustness, we would use D1 batch api.
  
  const existingStock = await c.env.DB.prepare(`
    SELECT id, quantity_on_hand FROM inventory_stock
    WHERE product_id = ? AND owner_type = ? 
      AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
      AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
      AND (warehouse_location_id = ? OR (warehouse_location_id IS NULL AND ? IS NULL))
  `).bind(
    body.productId, ownerType, 
    body.warehouseId || null, body.warehouseId || null,
    body.branchId || null, body.branchId || null,
    body.warehouseLocationId || null, body.warehouseLocationId || null
  ).first();

  const stmts = [];

  if (existingStock) {
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(delta, existingStock.id));
  } else {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, warehouse_location_id, quantity_on_hand)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), body.productId, ownerType, body.warehouseId || null, body.branchId || null, body.warehouseLocationId || null, delta));
  }

  const txId = uuidv4();
  stmts.push(c.env.DB.prepare(`
    INSERT INTO inventory_transactions
    (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, destination_location_id, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(txId, body.productId, transactionType, delta, ownerType, body.warehouseId || null, body.branchId || null, body.warehouseLocationId || null, body.notes || null, userId));

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare('SELECT * FROM inventory_transactions WHERE id = ?').bind(txId).all();
  return c.json(results[0], 201);
});

export default inventory;
