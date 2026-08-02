import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const products = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

products.use('/*', authMiddleware);

products.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT p.*, c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    ORDER BY p.name ASC
    LIMIT 100
  `).all();
  return c.json(results);
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
    // Branch user: force ownerType = BRANCH and assign their branch_id
    ownerType = 'BRANCH';
    branchId = payload.branch_id;
  } else if (body.initialBranchId) {
    ownerType = 'BRANCH';
    branchId = body.initialBranchId;
  } else if (body.initialWarehouseId) {
    ownerType = 'WAREHOUSE';
    warehouseId = body.initialWarehouseId;
  } else {
    // Admin default: attempt main warehouse first, fallback to first branch
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
    INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    productId, body.sku.trim(), body.name.trim(), body.description || null, body.categoryId || null, 
    body.brandId || null, cost, sell, body.reorderLevel || 5, body.barcode || null
  ));

  // 2. Insert initial inventory_stock entry bound to owner context ONLY if specified or initialQty > 0
  const hasExplicitLocation = Boolean(body.initialWarehouseId || body.initialBranchId || (payload && !isAdminUser(payload) && payload.branch_id));
  if (hasExplicitLocation || initialQty > 0) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, quantity_reserved)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).bind(
      stockId, productId, ownerType, warehouseId, branchId, initialQty
    ));
  }

  // 3. Audit log statement
  stmts.push(createAuditLogStmt(c, 'PRODUCT_CREATE', 'products', productId, null, {
    ...body,
    initialInventory: { ownerType, warehouseId, branchId, initialQuantity: initialQty }
  }));

  // Atomic batch execution to guarantee tight coupling
  await c.env.DB.batch(stmts);

  const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(productId).first();
  return c.json(product, 201);
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
    SELECT p.*, c.name as category_name, b.name as brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.id = ?
  `).bind(id).first();
  if (!product) return c.json({ message: 'Product not found' }, 404);
  return c.json(product);
});

products.delete('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');

  // Check for active references
  const inOrders = await c.env.DB.prepare('SELECT id FROM sales_order_lines WHERE product_id = ? LIMIT 1').bind(id).first();
  if (inOrders) return c.json({ message: 'Cannot delete: product is referenced in sales orders.' }, 400);

  const inPO = await c.env.DB.prepare('SELECT id FROM purchase_order_lines WHERE product_id = ? LIMIT 1').bind(id).first();
  if (inPO) return c.json({ message: 'Cannot delete: product is referenced in purchase orders.' }, 400);

  const inStock = await c.env.DB.prepare('SELECT id FROM inventory_stock WHERE product_id = ? AND quantity_on_hand > 0 LIMIT 1').bind(id).first();
  if (inStock) return c.json({ message: 'Cannot delete: product has active inventory stock.' }, 400);

  const prod = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!prod) return c.json({ message: 'Product not found' }, 404);

  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  await logAudit(c, 'PRODUCT_DELETE', 'products', id, prod, null);
  return c.json({ success: true });
});

export default products;
