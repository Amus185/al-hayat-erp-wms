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
  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouses (id, code, name, city, address, phone)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, body.code, body.name, body.city, body.address || null, body.phone || null).run();
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

export default warehouses;
