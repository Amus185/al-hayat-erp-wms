import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit } from '../services/audit';

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
  await logAudit(c, 'WAREHOUSE_CREATE', 'warehouses', id, null, body);
  return c.json(results[0], 201);
});

warehouses.patch('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  
  const existing = await c.env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Warehouse not found' }, 404);

  const updates: any = {};
  if (body.code !== undefined) updates.code = body.code.trim();
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.city !== undefined) updates.city = body.city.trim();
  if (body.address !== undefined) updates.address = body.address.trim() || null;
  if (body.phone !== undefined) updates.phone = body.phone.trim() || null;

  if (Object.keys(updates).length === 0) return c.json(existing);

  if (updates.code && updates.code !== existing.code) {
    const codeCheck = await c.env.DB.prepare('SELECT id FROM warehouses WHERE code = ? AND id != ?').bind(updates.code, id).first();
    if (codeCheck) return c.json({ message: 'A warehouse with this code already exists.' }, 409);
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  
  await c.env.DB.prepare(`UPDATE warehouses SET ${setClauses} WHERE id = ?`)
    .bind(...values, id)
    .run();
    
  const updated = await c.env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).first();
  await logAudit(c, 'WAREHOUSE_UPDATE', 'warehouses', id, existing, updated);
  return c.json(updated);
});

warehouses.delete('/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');

  // Check for dependencies (stock)
  const stock = await c.env.DB.prepare('SELECT id FROM inventory_stock WHERE warehouse_id = ? LIMIT 1').bind(id).first();
  if (stock) return c.json({ message: 'Cannot delete: warehouse has active stock records.' }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ message: 'Warehouse not found' }, 404);

  await c.env.DB.prepare('DELETE FROM warehouse_locations WHERE warehouse_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM warehouses WHERE id = ?').bind(id).run();
  
  await logAudit(c, 'WAREHOUSE_DELETE', 'warehouses', id, existing, null);
  return c.json({ success: true });
});

warehouses.get('/:id/locations', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouse_locations WHERE warehouse_id = ? ORDER BY aisle, rack, shelf, bin').bind(id).all();
  return c.json(results);
});

warehouses.post('/:id/locations', requirePermissions(['manage_inventory']), async (c) => {
  const warehouseId = c.req.param('id');
  const body = await c.req.json();

  if (!body.aisle || !body.aisle.trim()) return c.json({ message: 'Aisle is required.' }, 400);
  if (!body.rack || !body.rack.trim()) return c.json({ message: 'Rack is required.' }, 400);
  if (!body.shelf || !body.shelf.trim()) return c.json({ message: 'Shelf is required.' }, 400);
  if (!body.bin || !body.bin.trim()) return c.json({ message: 'Bin is required.' }, 400);
  if (!body.barcode || !body.barcode.trim()) return c.json({ message: 'Barcode is required.' }, 400);

  // Verify warehouse exists
  const wh = await c.env.DB.prepare('SELECT id FROM warehouses WHERE id = ?').bind(warehouseId).first();
  if (!wh) return c.json({ message: 'Warehouse not found.' }, 404);

  // Check barcode uniqueness
  const existingBarcode = await c.env.DB.prepare('SELECT id FROM warehouse_locations WHERE barcode = ?').bind(body.barcode.trim()).first();
  if (existingBarcode) return c.json({ message: 'A location with this barcode already exists.' }, 409);

  const id = uuidv4();
  await c.env.DB.prepare(`
    INSERT INTO warehouse_locations (id, warehouse_id, aisle, rack, shelf, bin, barcode)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, warehouseId, body.aisle.trim(), body.rack.trim(), body.shelf.trim(), body.bin.trim(), body.barcode.trim()).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM warehouse_locations WHERE id = ?').bind(id).all();
  await logAudit(c, 'WAREHOUSE_LOCATION_CREATE', 'warehouses', warehouseId, null, { locationId: id, ...body });
  return c.json(results[0], 201);
});

warehouses.get('/:id/inventory', async (c) => {
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(`
    SELECT i.id, i.product_id, i.owner_type, i.warehouse_id, i.branch_id,
           i.warehouse_location_id, i.quantity_on_hand, i.quantity_reserved, i.updated_at,
           p.name, p.sku, p.barcode
    FROM inventory_stock i
    JOIN products p ON p.id = i.product_id
    WHERE i.warehouse_id = ? AND i.owner_type = 'WAREHOUSE'
    ORDER BY p.name ASC
  `).bind(id).all();
  return c.json(results);
});

warehouses.get('/:id/summary', async (c) => {
  const id = c.req.param('id');

  const stockSummary = await c.env.DB.prepare(`
    SELECT 
      COUNT(DISTINCT i.product_id) as total_products,
      COALESCE(SUM(i.quantity_on_hand), 0) as total_units,
      COALESCE(SUM(i.quantity_on_hand * p.cost_price), 0) as inventory_value
    FROM inventory_stock i
    JOIN products p ON p.id = i.product_id
    WHERE i.warehouse_id = ? AND i.owner_type = 'WAREHOUSE'
  `).bind(id).first();

  const locationCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM warehouse_locations WHERE warehouse_id = ?'
  ).bind(id).first();

  const receiptsCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM goods_receipts WHERE warehouse_id = ?'
  ).bind(id).first();

  const transfersIn = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM transfers WHERE destination_warehouse_id = ? AND status = 'COMPLETED'"
  ).bind(id).first();

  const transfersOut = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM transfers WHERE source_warehouse_id = ? AND status = 'COMPLETED'"
  ).bind(id).first();

  return c.json({
    total_products: stockSummary?.total_products || 0,
    total_units: stockSummary?.total_units || 0,
    inventory_value: stockSummary?.inventory_value || 0,
    location_count: locationCount?.count || 0,
    receipts_count: receiptsCount?.count || 0,
    transfers_in: transfersIn?.count || 0,
    transfers_out: transfersOut?.count || 0,
  });
});

warehouses.get('/:id', async (c) => {
  const id = c.req.param('id');
  const wh = await c.env.DB.prepare('SELECT * FROM warehouses WHERE id = ?').bind(id).first();
  if (!wh) return c.json({ message: 'Warehouse not found' }, 404);
  return c.json(wh);
});

export default warehouses;
