import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { hideUnless, PERM, COST_FIELDS, sortsFor, canSeeCosts } from '../services/privacy';
import { prepareInventoryAdjustmentJournalEntry } from '../services/accounting-service';
import { csvResponse, dateRange, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions, type ListRequest } from '../services/listing';

const inventory = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

inventory.use('/*', authMiddleware);
// Cost prices, purchase costs and stock value only for people with costs.view (Owner decision D4).
inventory.use('/*', hideUnless(PERM.COSTS, COST_FIELDS));

// ── Stock list, paged on the server ──────────────────────────────────────
const STOCK_LIST: ListOptions = {
  sortable: {
    name: 'p.name', sku: 'p.sku', category: "COALESCE(c.name, 'Uncategorized')", location: 'COALESCE(w.name, b.name)',
    onHand: 's.quantity_on_hand', reserved: 's.quantity_reserved', available: '(s.quantity_on_hand - s.quantity_reserved)',
    value: '(s.quantity_on_hand * COALESCE(p.cost_price, 0))',
  },
  defaultSort: 'name', defaultDir: 'asc', tieBreaker: 's.id',
};

async function listStock(c: any, r: ListRequest, scopedBranchId: string | null) {
  const q = (k: string) => (c.req.query(k) || '').trim();
  const where: string[] = ['(s.quantity_on_hand > 0 OR s.quantity_reserved > 0)'];
  const params: unknown[] = [];
  if (scopedBranchId) { where.push("s.branch_id = ? AND s.owner_type = 'BRANCH'"); params.push(scopedBranchId); }
  // location=W:<warehouse id> or B:<branch id>
  const loc = q('location');
  if (loc.startsWith('W:')) { where.push("s.owner_type = 'WAREHOUSE' AND s.warehouse_id = ?"); params.push(loc.slice(2)); }
  if (loc.startsWith('B:')) { where.push("s.owner_type = 'BRANCH' AND s.branch_id = ?"); params.push(loc.slice(2)); }
  if (q('ownerType') === 'WAREHOUSE' || q('ownerType') === 'BRANCH') { where.push('s.owner_type = ?'); params.push(q('ownerType')); }
  if (q('categoryId')) { where.push('p.category_id = ?'); params.push(q('categoryId')); }
  if (q('productId')) { where.push('s.product_id = ?'); params.push(q('productId')); }
  const term = q('q') || q('search');
  if (term) {
    const t = likeTerm(term);
    where.push("(p.name ILIKE ? OR p.sku ILIKE ? OR COALESCE(p.barcode, '') ILIKE ?)");
    params.push(t, t, t);
  }
  if (q('status') === 'active') where.push('COALESCE(p.is_active, 1) = 1');
  if (q('status') === 'inactive') where.push('COALESCE(p.is_active, 1) = 0');
  if (q('state') === 'reserved') where.push('s.quantity_reserved > 0');
  if (q('state') === 'low') where.push('COALESCE(p.reorder_level, 0) > 0 AND s.quantity_on_hand <= p.reorder_level');
  const base = `
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    WHERE ${where.join(' AND ')}`;
  const { rows, total } = await pagedRows(c.env.DB, `
    s.id, p.name, p.sku, p.barcode, p.category_id, COALESCE(c.name, 'Uncategorized') AS category_name,
    COALESCE(p.is_active, 1) AS is_active, p.reorder_level, p.cost_price,
    s.product_id, s.owner_type, s.warehouse_id, s.branch_id, s.warehouse_location_id,
    s.quantity_on_hand, s.quantity_reserved,
    w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin`, base, params, r);
  if (r.csv) {
    return csvResponse(c, 'stock', [
      { label: 'SKU', value: (x: any) => x.sku },
      { label: 'Product', value: (x: any) => x.name },
      { label: 'Category', value: (x: any) => x.category_name },
      { label: 'Location', value: (x: any) => x.warehouse || x.branch },
      { label: 'Bin', value: (x: any) => [x.aisle, x.rack, x.shelf, x.bin].filter(Boolean).join('-') },
      { label: 'On hand', value: (x: any) => x.quantity_on_hand },
      { label: 'Reserved', value: (x: any) => x.quantity_reserved },
      { label: 'Available', value: (x: any) => Number(x.quantity_on_hand) - Number(x.quantity_reserved) },
      { label: 'Value at cost', value: (x: any) => (Number(x.quantity_on_hand) * Number(x.cost_price || 0)).toFixed(2), perm: PERM.COSTS },
    ], rows);
  }
  const sum = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(s.quantity_on_hand), 0)::int AS units, COALESCE(SUM(s.quantity_reserved), 0)::int AS reserved,
           COUNT(DISTINCT s.product_id)::int AS products, COALESCE(SUM(s.quantity_on_hand * COALESCE(p.cost_price, 0)), 0) AS value
    ${base}`).bind(...params).first() as any;
  // Cost and stock value only for people with costs.view (Owner decision D4).
  const isAdmin = canSeeCosts(c);
  if (!isAdmin) for (const row of rows) delete row.cost_price;
  return pagedResponse(c, r, rows, total, {
    totals: { units: Number(sum?.units || 0), reserved: Number(sum?.reserved || 0), products: Number(sum?.products || 0), ...(isAdmin ? { value: Math.round(Number(sum?.value || 0) * 100) / 100 } : {}) },
  });
}

inventory.get('/stock', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  const listReq = listRequest(c, sortsFor(c, STOCK_LIST, ['value', 'cost']));
  if (listReq.paged) return listStock(c, listReq, scopedBranchId);

  let query = `
    SELECT s.id, p.name, p.sku, p.barcode, p.category_id, COALESCE(c.name, 'Uncategorized') AS category_name,
           COALESCE(p.is_active, 1) AS is_active,
           s.product_id, s.owner_type, s.warehouse_id, s.branch_id, s.warehouse_location_id,
           s.quantity_on_hand, s.quantity_reserved,
           w.name AS warehouse, b.name AS branch, l.aisle, l.rack, l.shelf, l.bin
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id
    LEFT JOIN branches b ON b.id = s.branch_id
    LEFT JOIN warehouse_locations l ON l.id = s.warehouse_location_id
    WHERE (s.quantity_on_hand > 0 OR s.quantity_reserved > 0)
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

/** The movement types that actually occur (for the type filter). */
inventory.get('/transaction-types', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT DISTINCT transaction_type AS t FROM inventory_transactions ORDER BY 1').all();
  return c.json(((results || []) as any[]).map((r) => r.t).filter(Boolean));
});

// ── Stock movements, paged on the server ─────────────────────────────────
const MOVEMENT_LIST: ListOptions = {
  sortable: { date: 't.created_at', product: 'p.name', type: 't.transaction_type', quantity: 't.quantity', user: 'u.full_name' },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 't.id',
};

async function listMovements(c: any, r: ListRequest, scopedBranchId: string | null) {
  const q = (k: string) => (c.req.query(k) || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (scopedBranchId) { where.push('(t.source_branch_id = ? OR t.destination_branch_id = ?)'); params.push(scopedBranchId, scopedBranchId); }
  const term = q('q') || q('search');
  if (term) {
    const t = likeTerm(term);
    where.push("(p.name ILIKE ? OR p.sku ILIKE ? OR COALESCE(p.barcode, '') ILIKE ? OR COALESCE(t.notes, '') ILIKE ? OR COALESCE(t.reference_id, '') ILIKE ?)");
    params.push(t, t, t, t, t);
  }
  if (q('type')) { where.push('t.transaction_type = ?'); params.push(q('type')); }
  if (q('productId')) { where.push('t.product_id = ?'); params.push(q('productId')); }
  if (q('userId')) { where.push('t.created_by = ?'); params.push(q('userId')); }
  const loc = q('location');
  if (loc.startsWith('W:')) { where.push('(t.source_warehouse_id = ? OR t.destination_warehouse_id = ?)'); params.push(loc.slice(2), loc.slice(2)); }
  if (loc.startsWith('B:')) { where.push('(t.source_branch_id = ? OR t.destination_branch_id = ?)'); params.push(loc.slice(2), loc.slice(2)); }
  dateRange(c, 't.created_at', where, params);
  const base = `
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN branches sb ON sb.id = t.source_branch_id
    LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
    LEFT JOIN branches db ON db.id = t.destination_branch_id
    LEFT JOIN warehouse_locations l ON l.id = t.destination_location_id
    LEFT JOIN users u ON u.id = t.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const { rows, total } = await pagedRows(c.env.DB, `
    t.*, p.name, p.sku, p.barcode,
    sw.name AS source_warehouse, sb.name AS source_branch,
    dw.name AS destination_warehouse, db.name AS destination_branch,
    l.aisle, l.rack, l.shelf, l.bin, u.full_name AS user_name`, base, params, r);
  if (r.csv) {
    return csvResponse(c, 'stock-movements', [
      { label: 'Date', value: (x: any) => (x.created_at instanceof Date ? x.created_at.toISOString() : String(x.created_at)).slice(0, 19).replace('T', ' ') },
      { label: 'Type', value: (x: any) => x.transaction_type },
      { label: 'SKU', value: (x: any) => x.sku },
      { label: 'Product', value: (x: any) => x.name },
      { label: 'Quantity', value: (x: any) => x.quantity },
      { label: 'From', value: (x: any) => x.source_warehouse || x.source_branch },
      { label: 'To', value: (x: any) => x.destination_warehouse || x.destination_branch },
      { label: 'Reference', value: (x: any) => [x.reference_type, x.reference_id].filter(Boolean).join(' ') },
      { label: 'By', value: (x: any) => x.user_name },
      { label: 'Notes', value: (x: any) => x.notes },
    ], rows);
  }
  return pagedResponse(c, r, rows, total);
}

inventory.get('/transactions', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  const listReq = listRequest(c, MOVEMENT_LIST);
  if (listReq.paged) return listMovements(c, listReq, scopedBranchId);

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
    WHERE product_id = ?::text AND owner_type = ? 
      AND warehouse_id IS NOT DISTINCT FROM ?::text
      AND branch_id IS NOT DISTINCT FROM ?::text
      AND warehouse_location_id IS NOT DISTINCT FROM ?::text
  `).bind(
    body.productId,
    ownerType, 
    body.warehouseId || null,
    body.branchId || null,
    body.warehouseLocationId || null
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

  // GL entry commits with the stock change, valued at the product's actual cost
  // (no invented fallback cost; a zero-cost product moves stock only).
  const prodInfo = await c.env.DB.prepare('SELECT cost_price FROM products WHERE id = ?').bind(body.productId).first();
  const unitCost = Number(prodInfo?.cost_price || 0);
  if (unitCost > 0) {
    stmts.push(...(await prepareInventoryAdjustmentJournalEntry(
      c,
      { id: txId, productId: body.productId, quantity: body.quantity, direction: body.direction, unitCost, branchId: body.branchId },
      userId
    )).statements);
  }

  await c.env.DB.batch(stmts);

  const { results } = await c.env.DB.prepare('SELECT * FROM inventory_transactions WHERE id = ?').bind(txId).all();
  return c.json(results[0], 201);
});

export default inventory;
