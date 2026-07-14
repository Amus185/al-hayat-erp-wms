import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const products = new Hono<{ Bindings: Env }>();

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
  const id = uuidv4();

  const cost = Number(body.costPrice || 0);
  const sell = Number(body.sellingPrice || 0);
  if (cost > sell) {
    return c.json({ message: 'Cost Price cannot be greater than Selling Price' }, 400);
  }
  
  await c.env.DB.prepare(`
    INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.sku, body.name, body.description || null, body.categoryId || null, 
    body.brandId || null, body.costPrice || 0, body.sellingPrice || 0, body.reorderLevel || 5, body.barcode || null
  ).run();
  
  const { results } = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

products.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM categories ORDER BY name ASC').all();
  return c.json(results);
});

products.post('/categories', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)').bind(id, body.name, body.parentId || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

products.get('/brands', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM brands ORDER BY name ASC').all();
  return c.json(results);
});

products.delete('/categories/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
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
  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default products;
