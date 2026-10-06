import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const products = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

products.use('/*', authMiddleware);

products.get('/', async (c) => {
  const status = c.req.query('status'); // 'active' | 'inactive' | 'all'
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
  if (cost > sell) return c.json({ message: 'Cost price cannot be greater than selling price.' }, 400);

  const productType = (body.productType === 'GROUPED' || body.product_type === 'GROUPED') ? 'GROUPED' : 'STANDARD';
  const groupItems: Array<{ componentProductId: string; quantity: number }> = Array.isArray(body.groupItems)
    ? body.groupItems
    : (Array.isArray(body.group_items) ? body.group_items : []);
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
  if (productType === 'STANDARD') {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, quantity_reserved)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).bind(
      stockId, productId, ownerType, warehouseId, branchId, initialQty
    ));
  }

  // 3. Insert grouped items if GROUPED
  if (productType === 'GROUPED') {
    for (const item of groupItems) {
      const cId = item.componentProductId || (item as any).component_product_id;
      const cQty = Math.max(1, Number(item.quantity || 1));
      if (!cId) continue;
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
  await c.env.DB.batch(stmts);

  const product = await c.env.DB.prepare(`
    SELECT p.*, COALESCE(p.is_active, 1) AS is_active, COALESCE(p.product_type, 'STANDARD') AS product_type
    FROM products WHERE id = ?
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

  const stmts: any[] = [];
  let createdCount = 0;
  const skipped: Array<{ sku: string; barcode: string | null; reason: string }> = [];

  for (const item of items) {
    if (!item.sku || !item.name) continue;
    const sku = String(item.sku).trim();
    const name = String(item.name).trim();
    const barcode = item.barcode ? String(item.barcode).trim() : null;

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
      ON CONFLICT (sku) DO NOTHING
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
    }

    createdCount++;
  }

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

  // Atomically clean up draft/cancelled order lines, inventory transactions, and inventory_stock before deleting product
  const batchStmts = [
    c.env.DB.prepare('DELETE FROM sales_order_lines WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM purchase_order_lines WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM inventory_transactions WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM inventory_stock WHERE product_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id),
    createAuditLogStmt(c, 'PRODUCT_DELETE', 'products', id, prod, null)
  ];
  await c.env.DB.batch(batchStmts);

  return c.json({ success: true });
});

export default products;
