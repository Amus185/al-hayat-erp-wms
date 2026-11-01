import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { prepareOpeningStock, type OpeningStockItem } from '../services/accounting-service';
import { csvResponse, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions, type ListRequest } from '../services/listing';

const products = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

products.use('/*', authMiddleware);

// ── Products list, paged on the server ───────────────────────────────────
const PRODUCT_LIST: ListOptions = {
  sortable: {
    sku: 'p.sku', name: 'p.name', category: 'c.name', brand: 'b.name', cost: 'p.cost_price',
    price: 'p.selling_price', stock: 'stock.on_hand', created: 'p.created_at', status: 'COALESCE(p.is_active, 1)',
  },
  defaultSort: 'name', defaultDir: 'asc', tieBreaker: 'p.id',
};

async function listProducts(c: any, r: ListRequest) {
  const q = (k: string) => (c.req.query(k) || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  const term = q('q') || q('search');
  if (term) {
    const t = likeTerm(term);
    where.push('(p.name ILIKE ? OR p.sku ILIKE ? OR COALESCE(p.barcode, \'\') ILIKE ? OR COALESCE(p.description, \'\') ILIKE ?)');
    params.push(t, t, t, t);
  }
  if (q('categoryId')) { where.push('p.category_id = ?'); params.push(q('categoryId')); }
  if (q('brandId')) { where.push('p.brand_id = ?'); params.push(q('brandId')); }
  const status = q('status');
  if (status === 'active') where.push('COALESCE(p.is_active, 1) = 1');
  if (status === 'inactive') where.push('COALESCE(p.is_active, 1) = 0');
  if (q('type')) { where.push("COALESCE(p.product_type, 'STANDARD') = ?"); params.push(q('type')); }
  if (q('stock') === 'in') where.push('COALESCE(stock.on_hand, 0) > 0');
  if (q('stock') === 'out') where.push('COALESCE(stock.on_hand, 0) <= 0');
  if (q('stock') === 'low') where.push('COALESCE(p.reorder_level, 0) > 0 AND COALESCE(stock.on_hand, 0) <= p.reorder_level');
  if (q('onShop') === '1') where.push('p.is_published = 1');
  if (q('onShop') === '0') where.push('COALESCE(p.is_published, 0) = 0');
  const base = `
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    LEFT JOIN (SELECT product_id, SUM(quantity_on_hand) AS on_hand FROM inventory_stock GROUP BY product_id) stock ON stock.product_id = p.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const { rows, total } = await pagedRows(c.env.DB,
    `p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type,
     c.name AS category_name, b.name AS brand_name, COALESCE(stock.on_hand, 0)::int AS total_stock`,
    base, params, r);
  if (r.csv) {
    return csvResponse(c, 'products', [
      { label: 'SKU', value: (x: any) => x.sku },
      { label: 'Name', value: (x: any) => x.name },
      { label: 'Category', value: (x: any) => x.category_name },
      { label: 'Brand', value: (x: any) => x.brand_name },
      { label: 'Type', value: (x: any) => x.product_type },
      { label: 'Cost price', value: (x: any) => Number(x.cost_price).toFixed(2) },
      { label: 'Selling price', value: (x: any) => Number(x.selling_price).toFixed(2) },
      { label: 'Stock (all locations)', value: (x: any) => x.total_stock },
      { label: 'Active', value: (x: any) => (Number(x.is_active) === 1 ? 'Yes' : 'No') },
    ], rows);
  }
  // Price tiers and bundle items for just this page.
  const ids = rows.map((p: any) => p.id);
  let tiers: any[] = [];
  let groups: any[] = [];
  if (ids.length) {
    const ph = ids.map(() => '?').join(', ');
    [tiers, groups] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM product_price_tiers WHERE product_id IN (${ph}) ORDER BY price ASC`).bind(...ids).all().then((x: any) => x.results || []).catch(() => []),
      c.env.DB.prepare(`
        SELECT pgi.*, cp.name AS component_name, cp.sku AS component_sku
        FROM product_group_items pgi JOIN products cp ON cp.id = pgi.component_product_id
        WHERE pgi.parent_product_id IN (${ph})`).bind(...ids).all().then((x: any) => x.results || []).catch(() => []),
    ]);
  }
  const items = rows.map((p: any) => ({
    ...p,
    price_tiers: tiers.filter((t) => t.product_id === p.id),
    group_items: groups.filter((g) => g.parent_product_id === p.id),
  }));
  // ?withStock=1 (sale/transfer forms): stock rows of these products and their
  // bundle components, so availability is computed from complete data. Branch
  // staff get their own branch's rows only, as on the stock list.
  let stockRows: any[] = [];
  if (q('withStock') === '1' && ids.length) {
    const all = Array.from(new Set([...ids, ...groups.map((g: any) => g.component_product_id)]));
    const ph = all.map(() => '?').join(', ');
    const payload = c.get('jwtPayload');
    const scoped = isAdminUser(payload) ? null : payload.branch_id;
    const { results } = await c.env.DB.prepare(`
      SELECT s.id, s.product_id, s.owner_type, s.warehouse_id, s.branch_id, s.warehouse_location_id,
             s.quantity_on_hand, s.quantity_reserved, w.name AS warehouse, b.name AS branch
      FROM inventory_stock s
      LEFT JOIN warehouses w ON w.id = s.warehouse_id
      LEFT JOIN branches b ON b.id = s.branch_id
      WHERE s.product_id IN (${ph}) ${scoped ? "AND s.owner_type = 'BRANCH' AND s.branch_id = ?" : ''}
    `).bind(...all, ...(scoped ? [scoped] : [])).all();
    stockRows = (results || []) as any[];
  }
  return pagedResponse(c, r, items, total, q('withStock') === '1' ? { stockRows } : {});
}

products.get('/', async (c) => {
  const status = c.req.query('status'); // 'active' | 'inactive' | 'all'
  const listReq = listRequest(c, PRODUCT_LIST);
  if (listReq.paged) return listProducts(c, listReq);
  let query = `
    SELECT p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type,
           c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE 1=1
  `;
  const params: any[] = [];
  if (status === 'active') {
    query += ` AND COALESCE(p.is_active, 1) = 1`;
  } else if (status === 'inactive') {
    query += ` AND COALESCE(p.is_active, 1) = 0`;
  }
  query += ` ORDER BY p.name ASC LIMIT 500`;
  const stmt = c.env.DB.prepare(query);
  const { results: prods } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Load price tiers & group items
  const [tierRes, groupRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM product_price_tiers ORDER BY price ASC').all().catch(() => ({ results: [] })),
    c.env.DB.prepare(`
      SELECT pgi.*, cp.name AS component_name, cp.sku AS component_sku
      FROM product_group_items pgi
      JOIN products cp ON cp.id = pgi.component_product_id
    `).all().catch(() => ({ results: [] })),
  ]);

  const tierMap = new Map<string, any[]>();
  for (const t of (tierRes?.results || []) as any[]) {
    const list = tierMap.get(t.product_id) || [];
    list.push(t);
    tierMap.set(t.product_id, list);
  }

  const groupMap = new Map<string, any[]>();
  for (const g of (groupRes?.results || []) as any[]) {
    const list = groupMap.get(g.parent_product_id) || [];
    list.push(g);
    groupMap.set(g.parent_product_id, list);
  }

  const enriched = (prods || []).map((p: any) => ({
    ...p,
    price_tiers: tierMap.get(p.id) || [],
    group_items: groupMap.get(p.id) || [],
  }));

  return c.json(enriched);
});

products.post('/', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');

  // Input validation
  if (!body.sku || !body.sku.trim()) return c.json({ message: 'SKU is required.' }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: 'Product name is required.' }, 400);

  const cost = Number(body.costPrice || 0);
  const sell = Number(body.sellingPrice || 0);
  if (cost < 0) return c.json({ message: 'Cost price cannot be negative.' }, 400);
  if (sell < 0) return c.json({ message: 'Selling price cannot be negative.' }, 400);

  const productType = (body.productType === 'GROUPED' || body.product_type === 'GROUPED') ? 'GROUPED' : 'STANDARD';

  // Only enforce cost <= sell for STANDARD products.
  // Grouped/bundle products can legitimately sell below the sum of component costs (bundle discount).
  if (productType === 'STANDARD' && cost > sell) {
    return c.json({ message: 'Cost price cannot be greater than selling price.' }, 400);
  }

  const rawGroupItems: Array<{ componentProductId: string; quantity: number }> = Array.isArray(body.groupItems)
    ? body.groupItems
    : (Array.isArray(body.group_items) ? body.group_items : []);

  // Deduplicate component IDs — same component added twice would violate the UNIQUE constraint
  const seenComponentIds = new Set<string>();
  const groupItems = rawGroupItems.filter(item => {
    const cId = item.componentProductId || (item as any).component_product_id;
    if (!cId) return false;
    if (seenComponentIds.has(cId)) return false;
    seenComponentIds.add(cId);
    return true;
  });

  const priceTiers: Array<{ tierName: string; price: number }> = Array.isArray(body.priceTiers)
    ? body.priceTiers
    : (Array.isArray(body.price_tiers) ? body.price_tiers : []);

  if (productType === 'GROUPED' && groupItems.length === 0) {
    return c.json({ message: 'A grouped product must have at least one component product.' }, 400);
  }

  // Check SKU uniqueness
  const existingSku = await c.env.DB.prepare('SELECT id FROM products WHERE sku = ?').bind(body.sku.trim()).first();
  if (existingSku) return c.json({ message: 'A product with this SKU already exists.' }, 409);

  // Check barcode uniqueness if provided
  if (body.barcode) {
    const existingBarcode = await c.env.DB.prepare('SELECT id FROM products WHERE barcode = ?').bind(body.barcode).first();
    if (existingBarcode) return c.json({ message: 'A product with this barcode already exists.' }, 409);
  }

  // Validate category/brand references
  if (body.categoryId) {
    const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(body.categoryId).first();
    if (!cat) return c.json({ message: 'Category does not exist.' }, 400);
  }
  if (body.brandId) {
    const brand = await c.env.DB.prepare('SELECT id FROM brands WHERE id = ?').bind(body.brandId).first();
    if (!brand) return c.json({ message: 'Brand does not exist.' }, 400);
  }

  // Context determination for initial inventory stock record
  let ownerType: 'BRANCH' | 'WAREHOUSE' = 'BRANCH';
  let branchId: string | null = null;
  let warehouseId: string | null = null;

  if (payload && !isAdminUser(payload) && payload.branch_id) {
    ownerType = 'BRANCH';
    branchId = payload.branch_id;
  } else if (body.initialBranchId) {
    ownerType = 'BRANCH';
    branchId = body.initialBranchId;
  } else if (body.initialWarehouseId) {
    ownerType = 'WAREHOUSE';
    warehouseId = body.initialWarehouseId;
  } else {
    const defaultWh = await c.env.DB.prepare('SELECT id FROM warehouses LIMIT 1').first();
    if (defaultWh) {
      ownerType = 'WAREHOUSE';
      warehouseId = defaultWh.id as string;
    } else {
      const defaultBr = await c.env.DB.prepare('SELECT id FROM branches LIMIT 1').first();
      if (defaultBr) {
        ownerType = 'BRANCH';
        branchId = defaultBr.id as string;
      }
    }
  }

  const initialQty = Math.max(0, Number(body.initialQuantity || 0));
  const productId = uuidv4();
  const stockId = uuidv4();

  // Opening stock split across locations (the product form). Each line is
  // opening stock in its own location — not a stock-count gain — so it is
  // posted Dr Inventory / Cr Owner's Capital in the same transaction.
  const openingLines: Array<{ ownerType: 'BRANCH' | 'WAREHOUSE'; warehouseId: string | null; branchId: string | null; quantity: number }> = [];
  if (Array.isArray(body.initialStock) && body.initialStock.length > 0) {
    if (productType !== 'STANDARD') return c.json({ message: 'Only standard products hold their own stock.' }, 400);
    const pinnedBranch = payload && !isAdminUser(payload) && payload.branch_id ? payload.branch_id as string : null;
    const merged = new Map<string, (typeof openingLines)[number]>();
    for (const line of body.initialStock) {
      const qty = Number(line?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const lineType = line.ownerType === 'WAREHOUSE' ? 'WAREHOUSE' : 'BRANCH';
      const locId = String((lineType === 'WAREHOUSE' ? line.warehouseId : line.branchId) || '');
      if (!locId) return c.json({ message: 'Every opening stock line needs a location.' }, 400);
      if (pinnedBranch && (lineType !== 'BRANCH' || locId !== pinnedBranch)) {
        return c.json({ message: 'You can only add opening stock to your own branch.' }, 403);
      }
      const exists = await c.env.DB.prepare(`SELECT id FROM ${lineType === 'WAREHOUSE' ? 'warehouses' : 'branches'} WHERE id = ?`).bind(locId).first();
      if (!exists) return c.json({ message: `Stock location ${locId} does not exist.` }, 400);
      const key = `${lineType}:${locId}`;
      const prev = merged.get(key);
      if (prev) prev.quantity += qty;
      else merged.set(key, { ownerType: lineType, warehouseId: lineType === 'WAREHOUSE' ? locId : null, branchId: lineType === 'BRANCH' ? locId : null, quantity: qty });
    }
    openingLines.push(...merged.values());
  }

  const stmts = [];

  // 1. Insert product catalog entry
  stmts.push(c.env.DB.prepare(`
    INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, product_type, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    productId, body.sku.trim(), body.name.trim(), body.description || null, body.categoryId || null, 
    body.brandId || null, cost, sell, body.reorderLevel || 5, productType, body.barcode || null
  ));

  // 2. Insert initial inventory_stock entry (only for STANDARD products; grouped products draw stock from components)
  if (productType === 'STANDARD' && openingLines.length > 0) {
    for (const line of openingLines) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, quantity_reserved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).bind(uuidv4(), productId, line.ownerType, line.warehouseId, line.branchId, line.quantity));
    }
    stmts.push(...await prepareOpeningStock(c, openingLines.map((l) => ({ productId, unitCost: cost, ...l })), c.get('jwtPayload')?.sub || null));
  } else if (productType === 'STANDARD') {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, quantity_reserved)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).bind(
      stockId, productId, ownerType, warehouseId, branchId, initialQty
    ));
    // The initial quantity is opening stock: record it as a movement and post
    // its value (Dr Inventory / Cr Owner's Capital) in the stock's branch.
    if (initialQty > 0) {
      stmts.push(...await prepareOpeningStock(c, [{ productId, quantity: initialQty, unitCost: cost, ownerType, warehouseId, branchId }], c.get('jwtPayload')?.sub || null));
    }
  }

  // 3. Insert grouped items if GROUPED — validate each component exists first
  if (productType === 'GROUPED') {
    for (const item of groupItems) {
      const cId = item.componentProductId || (item as any).component_product_id;
      const cQty = Math.max(1, Number(item.quantity || 1));
      if (!cId) continue;

      // Verify the component product actually exists in the DB (guard against stale UI cache)
      const componentExists = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(cId).first();
      if (!componentExists) {
        return c.json({ message: `Component product "${cId}" not found. It may have been deleted. Please refresh and try again.` }, 422);
      }

      stmts.push(c.env.DB.prepare(`
        INSERT INTO product_group_items (id, parent_product_id, component_product_id, quantity)
        VALUES (?, ?, ?, ?)
      `).bind(uuidv4(), productId, cId, cQty));
    }
  }

  // 4. Insert price tiers if provided
  for (const tier of priceTiers) {
    const tierName = (tier.tierName ?? (tier as any).tier_name)?.trim();
    const tierPrice = Number(tier.price);
    if (!tierName || isNaN(tierPrice) || tierPrice < 0) continue;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO product_price_tiers (id, product_id, tier_name, price)
      VALUES (?, ?, ?, ?)
    `).bind(uuidv4(), productId, tierName, tierPrice));
  }

  // 5. Audit log statement
  stmts.push(createAuditLogStmt(c, 'PRODUCT_CREATE', 'products', productId, null, {
    ...body,
    initialInventory: { ownerType, warehouseId, branchId, initialQuantity: initialQty }
  }));

  // Atomic batch execution
  try {
    await c.env.DB.batch(stmts);
  } catch (batchErr: any) {
    // Log the precise DB error so Railway logs capture it
    console.error('[PRODUCT_CREATE] Batch failed:', JSON.stringify({
      message: batchErr?.message,
      detail: batchErr?.detail,
      constraint: batchErr?.constraint,
      table: batchErr?.table,
      schema: batchErr?.schema,
      productType,
      groupItemCount: groupItems.length,
    }));
    throw batchErr; // re-throw so Hono returns 500
  }

  // Fix: Use explicit table alias `p` — `p.*` from `FROM products` (no alias) is invalid PostgreSQL
  const product = await c.env.DB.prepare(`
    SELECT p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type
    FROM products p WHERE p.id = ?
  `).bind(productId).first();
  return c.json(product, 201);
});

products.post('/bulk', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const items: any[] = Array.isArray(body) ? body : (body.products || []);
  if (!items.length) return c.json({ message: 'No product items provided' }, 400);

  // Load existing categories, brands, warehouses, branches
  const [existingCats, existingBrands, existingWhs, existingBrs] = await Promise.all([
    c.env.DB.prepare('SELECT id, name FROM categories').all(),
    c.env.DB.prepare('SELECT id, name FROM brands').all(),
    c.env.DB.prepare('SELECT id, name FROM warehouses').all(),
    c.env.DB.prepare('SELECT id, name FROM branches').all(),
  ]);

  const catMap = new Map<string, string>((existingCats.results || []).map((x: any) => [String(x.name || '').toLowerCase().trim(), x.id]));
  const brandMap = new Map<string, string>((existingBrands.results || []).map((x: any) => [String(x.name || '').toLowerCase().trim(), x.id]));
  const whMap = new Map<string, string>((existingWhs.results || []).map((x: any) => [String(x.name || '').toLowerCase().trim(), x.id]));
  const brMap = new Map<string, string>((existingBrs.results || []).map((x: any) => [String(x.name || '').toLowerCase().trim(), x.id]));

  const defaultWhId = (existingWhs.results?.[0]?.id as string) || null;
  const defaultBrId = (existingBrs.results?.[0]?.id as string) || null;

  // ── Pre-flight: detect barcode conflicts ─────────────────────────
  // Collect all non-null barcodes from the batch
  const batchBarcodes = items
    .map(i => i.barcode ? String(i.barcode).trim() : null)
    .filter(Boolean) as string[];

  // Check for within-batch duplicates
  const seenBarcodes = new Set<string>();
  const withinBatchDuplicates = new Set<string>();
  for (const bc of batchBarcodes) {
    if (seenBarcodes.has(bc)) withinBatchDuplicates.add(bc);
    else seenBarcodes.add(bc);
  }

  // Check for existing DB barcodes
  const existingBarcodesInDB = new Set<string>();
  if (batchBarcodes.length > 0) {
    const placeholders = batchBarcodes.map(() => '?').join(',');
    const { results: existingRows } = await c.env.DB.prepare(
      `SELECT barcode FROM products WHERE barcode IN (${placeholders})`
    ).bind(...batchBarcodes).all() as { results: any[] };
    for (const row of existingRows || []) {
      if (row.barcode) existingBarcodesInDB.add(String(row.barcode));
    }
  }

  // Existing SKUs: skip and report (previously counted as created, and with
  // initial stock the stock insert hit a missing product and failed the import).
  const batchSkus = items.map((i) => (i?.sku ? String(i.sku).trim() : '')).filter(Boolean);
  const existingSkus = new Set<string>();
  if (batchSkus.length > 0) {
    const { results: skuRows } = await c.env.DB.prepare(
      `SELECT sku FROM products WHERE sku IN (${batchSkus.map(() => '?').join(',')})`
    ).bind(...batchSkus).all() as { results: any[] };
    for (const row of skuRows || []) existingSkus.add(String(row.sku));
  }

  const stmts: any[] = [];
  let createdCount = 0;
  const skipped: Array<{ sku: string; barcode: string | null; reason: string }> = [];
  const openingItems: OpeningStockItem[] = [];

  for (const item of items) {
    if (!item?.sku || !item?.name) {
      skipped.push({ sku: item?.sku ? String(item.sku) : '', barcode: item?.barcode ? String(item.barcode) : null, reason: 'SKU and name are required' });
      continue;
    }
    const sku = String(item.sku).trim();
    const name = String(item.name).trim();
    const barcode = item.barcode ? String(item.barcode).trim() : null;

    if (existingSkus.has(sku)) {
      skipped.push({ sku, barcode, reason: `SKU "${sku}" already exists (or appears more than once in this import)` });
      continue;
    }
    existingSkus.add(sku);

    // Skip rows with duplicate barcodes
    if (barcode) {
      if (withinBatchDuplicates.has(barcode)) {
        skipped.push({ sku, barcode, reason: `Barcode "${barcode}" appears more than once in this import batch` });
        continue;
      }
      if (existingBarcodesInDB.has(barcode)) {
        skipped.push({ sku, barcode, reason: `Barcode "${barcode}" already exists in the database` });
        continue;
      }
      // Mark as seen so subsequent duplicates in the batch get skipped too
      existingBarcodesInDB.add(barcode);
    }

    // Ensure Category
    let categoryId: string | null = null;
    if (item.categoryName && String(item.categoryName).trim()) {
      const cName = String(item.categoryName).trim();
      const lower = cName.toLowerCase();
      if (catMap.has(lower)) {
        categoryId = catMap.get(lower)!;
      } else {
        categoryId = uuidv4();
        stmts.push(c.env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(categoryId, cName));
        catMap.set(lower, categoryId);
      }
    }

    // Ensure Brand
    let brandId: string | null = null;
    if (item.brandName && String(item.brandName).trim()) {
      const bName = String(item.brandName).trim();
      const lower = bName.toLowerCase();
      if (brandMap.has(lower)) {
        brandId = brandMap.get(lower)!;
      } else {
        brandId = uuidv4();
        stmts.push(c.env.DB.prepare('INSERT INTO brands (id, name) VALUES (?, ?)').bind(brandId, bName));
        brandMap.set(lower, brandId);
      }
    }

    const productId = uuidv4();
    const cost = Math.max(0, Number(item.costPrice || 0));
    const sell = Math.max(cost, Number(item.sellingPrice || 0));

    // ON CONFLICT on both sku and barcode as safety nets
    stmts.push(c.env.DB.prepare(`
      INSERT INTO products (id, sku, barcode, name, description, category_id, brand_id, cost_price, selling_price, reorder_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      productId, sku, barcode, name, item.description || null,
      categoryId, brandId, cost, sell, Number(item.reorderLevel || 5)
    ));

    // Handle initial stock allocation
    const initStock = Math.max(0, Number(item.initialStock || 0));
    if (initStock > 0) {
      let locType: 'WAREHOUSE' | 'BRANCH' = 'WAREHOUSE';
      let targetWhId: string | null = null;
      let targetBrId: string | null = null;

      if (item.locationName && String(item.locationName).trim()) {
        const locLower = String(item.locationName).trim().toLowerCase();
        if (whMap.has(locLower)) {
          locType = 'WAREHOUSE';
          targetWhId = whMap.get(locLower)!;
        } else if (brMap.has(locLower)) {
          locType = 'BRANCH';
          targetBrId = brMap.get(locLower)!;
        }
      }

      if (!targetWhId && !targetBrId) {
        if (item.locationType === 'BRANCH' && defaultBrId) {
          locType = 'BRANCH';
          targetBrId = defaultBrId;
        } else if (defaultWhId) {
          locType = 'WAREHOUSE';
          targetWhId = defaultWhId;
        } else if (defaultBrId) {
          locType = 'BRANCH';
          targetBrId = defaultBrId;
        }
      }

      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, quantity_reserved)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `).bind(uuidv4(), productId, locType, targetWhId, targetBrId, initStock));
      openingItems.push({ productId, quantity: initStock, unitCost: cost, ownerType: locType, warehouseId: targetWhId, branchId: targetBrId });
    }

    createdCount++;
  }

  stmts.push(...await prepareOpeningStock(c, openingItems, c.get('jwtPayload')?.sub || null));

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  const hasSkipped = skipped.length > 0;
  return c.json(
    { success: true, created: createdCount, skipped },
    hasSkipped ? 207 : 201
  );
});

products.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  return c.json(results);
});

products.post('/categories', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) return c.json({ message: 'Category name is required.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM categories WHERE name = ?').bind(body.name.trim()).first();
  if (existing) return c.json({ message: 'A category with this name already exists.' }, 409);

  const id = uuidv4();
  await c.env.DB.prepare('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)').bind(id, body.name.trim(), body.parentId || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).all();
  await logAudit(c, 'CATEGORY_CREATE', 'categories', id, null, body);
  return c.json(results[0], 201);
});

products.get('/brands', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM brands ORDER BY name ASC').all();
  return c.json(results);
});

products.delete('/categories/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  // Check for products referencing this category
  const refs = await c.env.DB.prepare('SELECT id FROM products WHERE category_id = ? LIMIT 1').bind(id).first();
  if (refs) return c.json({ message: 'Cannot delete: products are assigned to this category.' }, 400);

  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  if (!cat) return c.json({ message: 'Category not found' }, 404);

  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  await logAudit(c, 'CATEGORY_DELETE', 'categories', id, cat, null);
  return c.json({ success: true });
});

products.get('/:id', async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB.prepare(`
    SELECT p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type,
           c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = ?
  `).bind(id).first();
  if (!product) return c.json({ message: 'Product not found' }, 404);

  const [tierRes, groupRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM product_price_tiers WHERE product_id = ? ORDER BY price ASC').bind(id).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(`
      SELECT pgi.*, cp.name AS component_name, cp.sku AS component_sku, cp.cost_price AS component_cost_price, cp.selling_price AS component_selling_price
      FROM product_group_items pgi
      JOIN products cp ON cp.id = pgi.component_product_id
      WHERE pgi.parent_product_id = ?
    `).bind(id).all().catch(() => ({ results: [] })),
  ]);

  return c.json({
    ...product,
    price_tiers: tierRes?.results || [],
    group_items: groupRes?.results || [],
  });
});

products.patch('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Product not found' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];

  if (body.sku !== undefined && String(body.sku).trim()) {
    const sku = String(body.sku).trim();
    if (sku !== existing.sku) {
      const dup = await c.env.DB.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').bind(sku, id).first();
      if (dup) return c.json({ message: 'A product with this SKU already exists.' }, 409);
    }
    fields.push('sku = ?'); vals.push(sku);
  }

  if (body.barcode !== undefined) {
    const barcode = body.barcode ? String(body.barcode).trim() : null;
    if (barcode && barcode !== existing.barcode) {
      const dup = await c.env.DB.prepare('SELECT id FROM products WHERE barcode = ? AND id != ?').bind(barcode, id).first();
      if (dup) return c.json({ message: 'A product with this barcode already exists.' }, 409);
    }
    fields.push('barcode = ?'); vals.push(barcode);
  }

  if (body.name !== undefined && String(body.name).trim()) {
    fields.push('name = ?'); vals.push(String(body.name).trim());
  }

  if (body.description !== undefined) {
    fields.push('description = ?'); vals.push(body.description || null);
  }

  if (body.categoryId !== undefined || body.category_id !== undefined) {
    const catId = body.categoryId ?? body.category_id ?? null;
    fields.push('category_id = ?'); vals.push(catId || null);
  }

  if (body.brandId !== undefined || body.brand_id !== undefined) {
    const brId = body.brandId ?? body.brand_id ?? null;
    fields.push('brand_id = ?'); vals.push(brId || null);
  }

  if (body.costPrice !== undefined || body.cost_price !== undefined) {
    const cost = Number(body.costPrice ?? body.cost_price ?? 0);
    if (cost < 0) return c.json({ message: 'Cost price cannot be negative.' }, 400);
    fields.push('cost_price = ?'); vals.push(cost);
  }

  if (body.sellingPrice !== undefined || body.selling_price !== undefined) {
    const sell = Number(body.sellingPrice ?? body.selling_price ?? 0);
    if (sell < 0) return c.json({ message: 'Selling price cannot be negative.' }, 400);
    fields.push('selling_price = ?'); vals.push(sell);
  }

  if (body.reorderLevel !== undefined || body.reorder_level !== undefined) {
    const reorder = Number(body.reorderLevel ?? body.reorder_level ?? 5);
    fields.push('reorder_level = ?'); vals.push(reorder);
  }

  if (body.productType !== undefined || body.product_type !== undefined) {
    const pType = (body.productType ?? body.product_type) === 'GROUPED' ? 'GROUPED' : 'STANDARD';
    fields.push('product_type = ?'); vals.push(pType);
  }

  if (body.isActive !== undefined || body.is_active !== undefined) {
    const active = (body.isActive ?? body.is_active) ? 1 : 0;
    fields.push('is_active = ?'); vals.push(active);
  }

  if (fields.length > 0) {
    fields.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    await c.env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  }

  // Handle group items if passed
  const passedGroupItems = body.groupItems ?? body.group_items;
  if (Array.isArray(passedGroupItems)) {
    await c.env.DB.prepare('DELETE FROM product_group_items WHERE parent_product_id = ?').bind(id).run();
    for (const item of passedGroupItems) {
      const cId = item.componentProductId || item.component_product_id;
      const cQty = Math.max(1, Number(item.quantity || 1));
      if (!cId) continue;
      await c.env.DB.prepare(
        'INSERT INTO product_group_items (id, parent_product_id, component_product_id, quantity) VALUES (?, ?, ?, ?)'
      ).bind(uuidv4(), id, cId, cQty).run();
    }
  }

  // Handle price tiers if passed
  const passedPriceTiers = body.priceTiers ?? body.price_tiers;
  if (Array.isArray(passedPriceTiers)) {
    await c.env.DB.prepare('DELETE FROM product_price_tiers WHERE product_id = ?').bind(id).run();
    for (const tier of passedPriceTiers) {
      const tierName = (tier.tierName ?? tier.tier_name)?.trim();
      const tierPrice = Number(tier.price);
      if (!tierName || isNaN(tierPrice) || tierPrice < 0) continue;
      await c.env.DB.prepare(
        'INSERT INTO product_price_tiers (id, product_id, tier_name, price) VALUES (?, ?, ?, ?)'
      ).bind(uuidv4(), id, tierName, tierPrice).run();
    }
  }

  const updated = await c.env.DB.prepare(`
    SELECT p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type,
           c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = ?
  `).bind(id).first();

  const [tierRes, groupRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM product_price_tiers WHERE product_id = ? ORDER BY price ASC').bind(id).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(`
      SELECT pgi.*, cp.name AS component_name, cp.sku AS component_sku
      FROM product_group_items pgi
      JOIN products cp ON cp.id = pgi.component_product_id
      WHERE pgi.parent_product_id = ?
    `).bind(id).all().catch(() => ({ results: [] })),
  ]);

  const responseObj = {
    ...updated,
    price_tiers: tierRes?.results || [],
    group_items: groupRes?.results || [],
  };

  await logAudit(c, 'PRODUCT_UPDATE', 'products', id, existing, responseObj);
  return c.json(responseObj);
});

products.patch('/:id/status', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : (body.isActive ? 1 : 0);

  const existing = await c.env.DB.prepare('SELECT id, is_active FROM products WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Product not found' }, 404);

  await c.env.DB.prepare('UPDATE products SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(isActive, id).run();
  await logAudit(c, 'PRODUCT_STATUS_CHANGE', 'products', id, { is_active: existing.is_active }, { is_active: isActive });

  return c.json({ success: true, is_active: isActive });
});

products.delete('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');

  // Check for active (Confirmed or Paid) sales orders
  const activeSale = await c.env.DB.prepare(`
    SELECT sol.id FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.product_id = ? AND so.status IN ('CONFIRMED', 'PAID')
    LIMIT 1
  `).bind(id).first();
  if (activeSale) return c.json({ message: 'Cannot delete: product is referenced in active (Confirmed or Paid) sales orders.' }, 400);

  // Check for active (Approved) purchase orders
  const activePO = await c.env.DB.prepare(`
    SELECT pol.id FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.purchase_order_id
    WHERE pol.product_id = ? AND po.status IN ('APPROVED', 'RECEIVED')
    LIMIT 1
  `).bind(id).first();
  if (activePO) return c.json({ message: 'Cannot delete: product is referenced in approved or received purchase orders.' }, 400);

  const prod = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!prod) return c.json({ message: 'Product not found' }, 404);

  // Any stock or history (orders of any status, invoices, receipts, movements)
  // must survive: deleting it would rewrite past invoices and stock ledgers.
  const history = await c.env.DB.prepare(`
    SELECT
      (SELECT COALESCE(SUM(quantity_on_hand), 0) FROM inventory_stock WHERE product_id = ?) AS on_hand,
      EXISTS (SELECT 1 FROM inventory_transactions WHERE product_id = ?)
        OR EXISTS (SELECT 1 FROM sales_order_lines WHERE product_id = ?)
        OR EXISTS (SELECT 1 FROM purchase_order_lines WHERE product_id = ?)
        OR EXISTS (SELECT 1 FROM product_group_items WHERE component_product_id = ?) AS referenced
  `).bind(id, id, id, id, id).first() as any;
  if (Number(history?.on_hand || 0) !== 0 || history?.referenced) {
    return c.json({ message: 'Cannot delete: this product has stock or transaction history. Deactivate it instead to keep past records intact.' }, 400);
  }

  const batchStmts = [
    c.env.DB.prepare('DELETE FROM inventory_stock WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'PRODUCT_DELETE', 'products', id, prod, null)
  ];
  await c.env.DB.batch(batchStmts);

  return c.json({ success: true });
});

export default products;
