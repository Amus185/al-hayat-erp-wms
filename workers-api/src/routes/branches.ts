import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const branches = new Hono<{ Bindings: Env }>();

branches.use('/*', authMiddleware);

branches.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM branches ORDER BY name').all();
  return c.json(results);
});

branches.post('/', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO branches (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code, body.name, body.city, body.address || null, body.phone || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

branches.get('/:id', async (c) => {
  const id = c.req.param('id');
  const branch = await c.env.DB.prepare('SELECT * FROM branches WHERE id = ?').bind(id).first();
  if (!branch) return c.json({ message: 'Branch not found' }, 404);
  return c.json(branch);
});

branches.get('/:id/performance', async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB.prepare(`
    SELECT 
      b.id, b.code, b.name,
      COUNT(DISTINCT so.id) as order_count,
      COALESCE(SUM(i.total_amount), 0) as invoiced_amount,
      COALESCE(SUM(sol.quantity), 0) as units_sold
    FROM branches b
    LEFT JOIN sales_orders so ON so.branch_id = b.id
    LEFT JOIN invoices i ON i.sales_order_id = so.id
    LEFT JOIN sales_order_lines sol ON sol.sales_order_id = so.id
    WHERE b.id = ?
    GROUP BY b.id, b.code, b.name
  `).bind(id).first();
  if (!result) return c.json({ message: 'Branch not found' }, 404);
  return c.json(result);
});

branches.get('/:id/inventory', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT p.name, p.sku, p.barcode,
           s.quantity_on_hand, s.quantity_reserved,
           (s.quantity_on_hand - s.quantity_reserved) as available_quantity
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.branch_id = ? AND s.owner_type = 'BRANCH'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});

export default branches;
