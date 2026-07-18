import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';

const inventory = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

inventory.use('/*', authMiddleware);

inventory.get('/stock', async (c) => {
  const url = new URL(c.req.url);
  const search = url.searchParams.get('search');
  const location_id = url.searchParams.get('location_id');
  const category_id = url.searchParams.get('category_id');
  const status = url.searchParams.get('status');
  const sort_by = url.searchParams.get('sort_by') || 'p.name';
  const sort_dir = url.searchParams.get('sort_dir') === 'DESC' ? 'DESC' : 'ASC';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const exportCsv = url.searchParams.get('export') === 'csv';

  let query = `
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (location_id) {
    query += ` AND (s.warehouse_id = ? OR s.branch_id = ?)`;
    params.push(location_id, location_id);
  }
  if (category_id) {
    query += ` AND p.category_id = ?`;
    params.push(category_id);
  }
  if (status === 'IN_STOCK') {
    query += ` AND s.quantity_on_hand > 0`;
  } else if (status === 'LOW_STOCK') {
    query += ` AND s.quantity_on_hand > 0 AND s.quantity_on_hand <= p.reorder_level`;
  } else if (status === 'OUT_OF_STOCK') {
    query += ` AND s.quantity_on_hand <= 0`;
  }

  const validSortColumns = ['p.name', 'p.sku', 's.quantity_on_hand', 's.quantity_reserved'];
  const safeSortBy = validSortColumns.includes(sort_by) ? sort_by : 'p.name';

  const selectCols = `
    SELECT s.id, p.name, p.sku, p.barcode, s.product_id, s.owner_type, s.quantity_on_hand, s.quantity_reserved,
           w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
  `;

  if (exportCsv) {
    const { results } = await c.env.DB.prepare(`${selectCols} ${query} ORDER BY ${safeSortBy} ${sort_dir}`).bind(...params).all();
    let csv = 'Product Name,SKU,Barcode,Location,Quantity On Hand,Quantity Reserved\n';
    results.forEach((r: any) => {
      const loc = r.owner_type === 'WAREHOUSE' ? r.warehouse : r.branch;
      csv += `"${r.name}","${r.sku || ''}","${r.barcode || ''}","${loc || ''}",${r.quantity_on_hand},${r.quantity_reserved}\n`;
    });
    return c.text(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="inventory_stock.csv"'
    });
  }

  const countQuery = `SELECT COUNT(*) as total ${query}`;
  const totalRes = await c.env.DB.prepare(countQuery).bind(...params).first();
  const total = (totalRes?.total as number) || 0;

  const offset = (page - 1) * limit;
  query += ` ORDER BY ${safeSortBy} ${sort_dir} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(`${selectCols} ${query}`).bind(...params).all();

  return c.json({ data: results, total, page, totalPages: Math.ceil(total / limit) });
});

inventory.get('/transactions', async (c) => {
  const url = new URL(c.req.url);
  const start_date = url.searchParams.get('start_date');
  const end_date = url.searchParams.get('end_date');
  const user_id = url.searchParams.get('user_id');
  const action = url.searchParams.get('action');
  const product_id = url.searchParams.get('product_id');
  const location_id = url.searchParams.get('location_id');
  const sort_by = url.searchParams.get('sort_by') || 't.created_at';
  const sort_dir = url.searchParams.get('sort_dir') === 'ASC' ? 'ASC' : 'DESC';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const exportCsv = url.searchParams.get('export') === 'csv';

  let query = `
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

  if (start_date) { query += ` AND t.created_at >= ?`; params.push(start_date); }
  if (end_date) { query += ` AND t.created_at <= ?`; params.push(end_date + ' 23:59:59'); }
  if (user_id) { query += ` AND t.created_by = ?`; params.push(user_id); }
  if (action) { query += ` AND t.transaction_type = ?`; params.push(action); }
  if (product_id) { query += ` AND t.product_id = ?`; params.push(product_id); }
  if (location_id) {
    query += ` AND (t.source_warehouse_id = ? OR t.source_branch_id = ? OR t.destination_warehouse_id = ? OR t.destination_branch_id = ?)`;
    params.push(location_id, location_id, location_id, location_id);
  }

  const validSortColumns = ['t.created_at', 'p.name', 't.quantity'];
  const safeSortBy = validSortColumns.includes(sort_by) ? sort_by : 't.created_at';

  const selectCols = `
    SELECT t.id, t.product_id, t.transaction_type, t.quantity,
           t.source_owner_type, t.source_warehouse_id, t.source_branch_id, t.source_location_id,
           t.destination_owner_type, t.destination_warehouse_id, t.destination_branch_id, t.destination_location_id,
           t.reference_type, t.reference_id, t.notes, t.created_by, t.created_at,
           p.name, p.sku, p.barcode,
           sw.name AS source_warehouse, sb.name AS source_branch,
           dw.name AS destination_warehouse, db.name AS destination_branch,
           l.aisle, l.rack, l.shelf, l.bin,
           u.full_name AS user_name
  `;

  if (exportCsv) {
    const { results } = await c.env.DB.prepare(`${selectCols} ${query} ORDER BY ${safeSortBy} ${sort_dir}`).bind(...params).all();
    let csv = 'Date,Transaction Type,Product,Quantity,Source,Destination,User,Notes\n';
    results.forEach((r: any) => {
      const src = r.source_warehouse || r.source_branch || '';
      const dest = r.destination_warehouse || r.destination_branch || '';
      const date = new Date(r.created_at).toLocaleString();
      const notes = (r.notes || '').replace(/"/g, '""');
      csv += `"${date}","${r.transaction_type}","${r.name}","${r.quantity}","${src}","${dest}","${r.user_name || ''}","${notes}"\n`;
    });
    return c.text(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="inventory_transactions.csv"'
    });
  }

  const countQuery = `SELECT COUNT(*) as total ${query}`;
  const totalRes = await c.env.DB.prepare(countQuery).bind(...params).first();
  const total = (totalRes?.total as number) || 0;

  const offset = (page - 1) * limit;
  query += ` ORDER BY ${safeSortBy} ${sort_dir} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await c.env.DB.prepare(`${selectCols} ${query}`).bind(...params).all();

  return c.json({ data: results, total, page, totalPages: Math.ceil(total / limit) });
});

inventory.post('/adjust', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

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
