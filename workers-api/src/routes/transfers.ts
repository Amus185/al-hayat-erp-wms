import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';

const transfers = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

transfers.use('/*', authMiddleware);

transfers.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers ORDER BY requested_at DESC LIMIT 100').all();
  return c.json(results);
});

transfers.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { results: transfers } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  if (!transfers.length) return c.json({ message: 'Not found' }, 404);
  const transfer = transfers[0];
  
  const { results: lines } = await c.env.DB.prepare(`
    SELECT tl.*, p.name as product_name, p.sku as product_sku 
    FROM transfer_lines tl
    JOIN products p ON p.id = tl.product_id
    WHERE tl.transfer_id = ?
  `).bind(id).all();
  
  return c.json({ ...transfer, lines });
});

transfers.post('/', requirePermissions(['manage_transfers']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;
  const id = uuidv4();
  const transferNumber = `TR-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO transfers (id, transfer_number, status, source_owner_type, source_warehouse_id, source_branch_id, destination_owner_type, destination_warehouse_id, destination_branch_id, requested_by)
    VALUES (?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, transferNumber, body.sourceOwnerType, body.sourceWarehouseId || null, body.sourceBranchId || null, body.destinationOwnerType, body.destinationWarehouseId || null, body.destinationBranchId || null, userId));

  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO transfer_lines (id, transfer_id, product_id, quantity_requested) VALUES (?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantityRequested));
  }

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

transfers.post('/:id/approve', requirePermissions(['manage_transfers']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  await c.env.DB.prepare("UPDATE transfers SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId, id).run();
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

// Note: Dispatch and Receive in NestJS performed stock adjustments. 
// We will do simplified batch updates here. D1 batch is very fast.
transfers.post('/:id/dispatch', requirePermissions(['manage_transfers']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  
  const { results: transferList } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  const transfer = transferList[0];
  if (!transfer || transfer.status !== 'APPROVED') return c.json({ message: 'Invalid transfer state' }, 400);

  const { results: lines } = await c.env.DB.prepare('SELECT * FROM transfer_lines WHERE transfer_id = ?').bind(id).all();

  const stmts = [];
  for (const line of lines) {
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand - ?, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ? AND owner_type = ? 
        AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
        AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
    `).bind(line.quantity_requested, line.product_id, transfer.source_owner_type, transfer.source_warehouse_id || null, transfer.source_warehouse_id || null, transfer.source_branch_id || null, transfer.source_branch_id || null));
    
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_warehouse_id, source_branch_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'TRANSFER_OUT', ?, ?, ?, ?, 'TRANSFER', ?, ?)
    `).bind(uuidv4(), line.product_id, -(line.quantity_requested as number), transfer.source_owner_type, transfer.source_warehouse_id || null, transfer.source_branch_id || null, id, userId));

    stmts.push(c.env.DB.prepare('UPDATE transfer_lines SET quantity_dispatched = quantity_requested WHERE id = ?').bind(line.id));
  }

  stmts.push(c.env.DB.prepare("UPDATE transfers SET status = 'DISPATCHED', dispatched_by = ?, dispatched_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId, id));

  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

transfers.post('/:id/receive', requirePermissions(['manage_transfers']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;
  
  const { results: transferList } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  const transfer = transferList[0];
  if (!transfer || transfer.status !== 'DISPATCHED') return c.json({ message: 'Invalid transfer state' }, 400);

  const { results: lines } = await c.env.DB.prepare('SELECT * FROM transfer_lines WHERE transfer_id = ?').bind(id).all();

  const stmts = [];
  for (const line of lines) {
    const qty = line.quantity_dispatched as number;
    // For D1 we can use UPSERT (INSERT ... ON CONFLICT) if we had the right constraints, but let's just do sequential checks 
    // or try UPDATE then INSERT in batch if update fails. For simplicity in this migration, we assume stock row exists or we just run the transaction.
    // In a real edge app, we'd do this via a worker script logic.
    // D1 allows multiple queries, we'll fetch existing first.
    const existingStock = await c.env.DB.prepare(`
      SELECT id FROM inventory_stock
      WHERE product_id = ? AND owner_type = ? 
        AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
        AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
    `).bind(line.product_id, transfer.destination_owner_type, transfer.destination_warehouse_id || null, transfer.destination_warehouse_id || null, transfer.destination_branch_id || null, transfer.destination_branch_id || null).first();

    if (existingStock) {
      stmts.push(c.env.DB.prepare(`UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(qty, existingStock.id));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(uuidv4(), line.product_id, transfer.destination_owner_type, transfer.destination_warehouse_id || null, transfer.destination_branch_id || null, qty));
    }

    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'TRANSFER_IN', ?, ?, ?, ?, 'TRANSFER', ?, ?)
    `).bind(uuidv4(), line.product_id, qty, transfer.destination_owner_type, transfer.destination_warehouse_id || null, transfer.destination_branch_id || null, id, userId));

    stmts.push(c.env.DB.prepare('UPDATE transfer_lines SET quantity_received = quantity_dispatched WHERE id = ?').bind(line.id));
  }

  stmts.push(c.env.DB.prepare("UPDATE transfers SET status = 'RECEIVED', received_by = ?, received_at = CURRENT_TIMESTAMP WHERE id = ?").bind(userId, id));

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  return c.json(results[0]);
});

export default transfers;
