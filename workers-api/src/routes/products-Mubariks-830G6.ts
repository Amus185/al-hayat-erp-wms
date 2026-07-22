import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit } from '../services/audit';

const products = new Hono<{ Bindings: Env }>();

products.use('/*', authMiddleware);

products.get('/', async (c) => {
  const url = new URL(c.req.url);
  const search = url.searchParams.get('search');
  const category_id = url.searchParams.get('category_id');
  const brand_id = url.searchParams.get('brand_id');
  const sort_by = url.searchParams.get('sort_by') || 'p.name';
  const sort_dir = url.searchParams.get('sort_dir') === 'DESC' ? 'DESC' : 'ASC';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const exportCsv = url.searchParams.get('export') === 'csv';

  let query = `
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category_id) { query += ` AND p.category_id = ?`; params.push(category_id); }
  if (brand_id) { query += ` AND p.brand_id = ?`; params.push(brand_id); }

  const validSortColumns = ['p.name', 'p.sku', 'c.name', 'b.name', 'p.cost_price', 'p.selling_price'];
  const safeSortBy = validSortColumns.includes(sort_by) ? sort_by : 'p.name';

  const selectCols = `SELECT p.*, c.name as category_name, b.name as brand_name`;

  if (exportCsv) {
    const { results } = await c.env.DB.prepare(`${selectCols} ${query} ORDER BY ${safeSortBy} ${sort_dir}`).bind(...params).all();
    let csv = 'Product ID,Name,Barcode,Category,Brand,Cost Price,Selling Price\n';
    results.forEach((r: any) => {
      csv += `"${r.sku}","${r.name}","${r.barcode || ''}","${r.category_name || ''}","${r.brand_name || ''}","${r.cost_price}","${r.selling_price}"\n`;
    });
    return c.text(csv, 200, {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="products.csv"'
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

products.post('/', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();

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

  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.sku.trim(), body.name.trim(), body.description || null, body.categoryId || null, 
    body.brandId || null, cost, sell, body.reorderLevel || 5, body.barcode || null
  ).run();
  
  const { results } = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).all();
  await logAudit(c, 'PRODUCT_CREATE', 'products', id, null, body);
  return c.json(results[0], 201);
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

products.patch('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const existing = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Product not found' }, 404);

  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.sku !== undefined) updates.sku = body.sku.trim();
  if (body.barcode !== undefined) updates.barcode = body.barcode.trim();
  if (body.description !== undefined) updates.description = body.description.trim();
  if (body.categoryId !== undefined) updates.category_id = body.categoryId;
  if (body.brandId !== undefined) updates.brand_id = body.brandId;
  if (body.costPrice !== undefined) updates.cost_price = Number(body.costPrice);
  if (body.sellingPrice !== undefined) updates.selling_price = Number(body.sellingPrice);
  if (body.reorderLevel !== undefined) updates.reorder_level = Number(body.reorderLevel);

  if (Object.keys(updates).length === 0) return c.json(existing);

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  
  await c.env.DB.prepare(`UPDATE products SET ${setClauses} WHERE id = ?`)
    .bind(...values, id)
    .run();
    
  const updated = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  await logAudit(c, 'PRODUCT_UPDATE', 'products', id, existing, updated);
  return c.json(updated);
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
