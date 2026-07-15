import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const warehouses = new Hono<{ Bindings: Env }>();

warehouses.use('/*', authMiddleware);

warehouses.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouses ORDER BY name').all();
  return c.json(results);
});

warehouses.post('/', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();

  if (!body.code || !body.code.trim()) return c.json({ message: 'Warehouse code is required.' }, 400);
  if (!body.name || !body.name.trim()) return c.json({ message: 'Warehouse name is required.' }, 400);
  if (!body.city || !body.city.trim()) return c.json({ message: 'City is required.' }, 400);

  const existing = await c.env.DB.prepare('SELECT id FROM warehouses WHERE code = ?').bind(body.code.trim()).first();
  if (existing) return c.json({ message: 'A warehouse with this code already exists.' }, 409);

  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouses (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code.trim(), body.name.trim(), body.city.trim(), body.address || null, body.phone || null).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

warehouses.get('/:id/locations', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouse_locations WHERE warehouse_id = ? ORDER BY aisle, rack, shelf, bin').bind(id).all();
  return c.json(results);
});

warehouses.post('/:id/locations', requirePermissions(['manage_inventory']), async (c) => {
  const warehouseId = c.req.param('id');
  const body = await c.req.json();
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouse_locations (id, warehouse_id, aisle, rack, shelf, bin, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, warehouseId, body.aisle, body.rack, body.shelf, body.bin, body.barcode).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouse_locations WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

warehouses.get('/:id/inventory', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT i.*, p.name, p.sku, p.barcode
    FROM inventory_stock i
    JOIN products p ON p.id = i.product_id
    WHERE i.warehouse_id = ? AND i.owner_type = 'WAREHOUSE'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});

export default warehouses;
