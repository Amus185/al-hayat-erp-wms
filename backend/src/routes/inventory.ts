import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';

const inventory = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

inventory.use('/*', authMiddleware);

inventory.get('/stock', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT s.id, p.name, p.sku, p.barcode, s.product_id, s.owner_type, s.quantity_on_hand, s.quantity_reserved,
           w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — branch users only see their own branch's stock
  if (scopedBranchId) {
    query += ` AND s.branch_id = ? AND s.owner_type = 'BRANCH'`;
    params.push(scopedBranchId);
  }

  query += ` ORDER BY p.name LIMIT 500`;
  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results);
});

inventory.get('/transactions', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT t.*, p.name, p.sku, p.barcode,
           sw.name AS source_warehouse, sb.name AS source_branch,
           dw.name AS destination_warehouse, db.name AS destination_branch,
           l.aisle, l.rack, l.shelf, l.bin,
           u.full_name AS user_name
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN branches sb ON sb.id = t.source_branch_id
    LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
    LEFT JOIN branches db ON db.id = t.destination_branch_id
    LEFT JOIN warehouse_locations l ON l.id = t.destination_location_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — filter to transactions involving this branch
  if (scopedBranchId) {
    query += ` AND (t.source_branch_id = ? OR t.destination_branch_id = ?)`;
    params.push(scopedBranchId, scopedBranchId);
  }

  query += ` ORDER BY t.created_at DESC LIMIT 200`;
  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results);
});

inventory.post('/adjust', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');
  const userId = payload.sub;

  // Branch isolation — branch users can only adjust their own branch's stock
  if (!isAdminUser(payload)) {
    body.branchId = payload.branch_id;
    body.warehouseId = undefined; // branch users can't adjust warehouse stock
  }

  // Input validation
  if (!body.productId) return c.json({ message: 'Product is required.' }, 400);
  if (!body.quantity || !Number.isInteger(body.quantity) || body.quantity <= 0) {
    return c.json({ message: 'Quantity must be a positive integer.' }, 400);
  }
  if (!body.direction || !['INCREASE', 'DECREASE'].includes(body.direction)) {
    return c.json({ message: 'Direction must be INCREASE or DECREASE.' }, 400);
  }

  const product = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?').bind(body.productId).first();
  if (!product) return c.json({ message: 'Product does not exist.' }, 400);

  const ownerType = body.warehouseId ? 'WAREHOUSE' : 'BRANCH';
  if (ownerType === 'WAREHOUSE' && !body.warehouseId) return c.json({ message: 'Warehouse is required.' }, 400);
  if (ownerType === 'BRANCH' && !body.branchId) return c.json({ message: 'Branch is required.' }, 400);

  // Verify location exists
  if (body.warehouseId) {
    const wh = await c.env.DB.prepare('SELECT id FROM warehouses WHERE id = ?').bind(body.warehouseId).first();
    if (!wh) return c.json({ message: 'Warehouse does not exist.' }, 400);
  }
  if (body.branchId) {
    const br = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first();
    if (!br) return c.json({ message: 'Branch does not exist.' }, 400);
  }

  const delta = body.direction === 'INCREASE' ? body.quantity : -body.quantity;
  const transactionType = delta > 0 ? 'ADJUSTMENT_POSITIVE' : 'ADJUSTMENT_NEGATIVE';

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

  // Prevent negative inventory on DECREASE
  if (body.direction === 'DECREASE') {
    const currentQty = (existingStock?.quantity_on_hand as number) || 0;
    if (currentQty < body.quantity) {
      return c.json({ 
        message: `Insufficient stock. Current quantity: ${currentQty}, requested decrease: ${body.quantity}.` 
      }, 400);
    }
  }

  const stmts = [];

  if (existingStock) {
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(delta, existingStock.id));
  } else {
    if (delta < 0) {
      return c.json({ message: 'Cannot decrease stock that does not exist.' }, 400);
    }
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

  stmts.push(createAuditLogStmt(c, 'INVENTORY_ADJUST', 'inventory_stock', txId, null, { productId: body.productId, quantity: body.quantity, direction: body.direction, ownerType, warehouseId: body.warehouseId, branchId: body.branchId, notes: body.notes }));
  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare('SELECT * FROM inventory_transactions WHERE id = ?').bind(txId).all();
  return c.json(results[0], 201);
});

export default inventory;
