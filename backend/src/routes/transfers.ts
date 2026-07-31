import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions, isAdminUser } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';

const transfers = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

transfers.use('/*', authMiddleware);

transfers.get('/', async (c) => {
  const payload = c.get('jwtPayload');
  const scopedBranchId = isAdminUser(payload) ? null : payload.branch_id;

  let query = `
    SELECT
      t.*,
      COALESCE(sw.name, sb.name, 'Unknown') AS source_name,
      COALESCE(dw.name, db.name, 'Unknown') AS destination_name,
      (SELECT COUNT(*) FROM transfer_lines tl WHERE tl.transfer_id = t.id) AS line_count
    FROM transfers t
    LEFT JOIN warehouses sw ON sw.id = t.source_warehouse_id
    LEFT JOIN branches   sb ON sb.id = t.source_branch_id
    LEFT JOIN warehouses dw ON dw.id = t.destination_warehouse_id
    LEFT JOIN branches   db ON db.id = t.destination_branch_id
    WHERE 1=1
  `;
  const params: any[] = [];

  // Branch isolation — branch users see transfers involving their branch
  if (scopedBranchId) {
    query += ` AND (t.source_branch_id = ? OR t.destination_branch_id = ?)`;
    params.push(scopedBranchId, scopedBranchId);
  }

  query += ` ORDER BY t.requested_at DESC LIMIT 200`;
  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
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

// ──────────────────────────────────────────────────────────────────────
// POST /  — Create a new transfer request with full input validation
// ──────────────────────────────────────────────────────────────────────
transfers.post('/', requirePermissions(['manage_transfers']), async (c) => {
  const body = await c.req.json();
  const payload = c.get('jwtPayload');
  const userId = payload.sub;

  // Branch isolation — branch users can only request transfers FROM their own branch
  if (!isAdminUser(payload)) {
    body.sourceOwnerType = 'BRANCH';
    body.sourceBranchId = payload.branch_id;
    body.sourceWarehouseId = undefined;
  }

  // ── Validate owner types ──
  const validOwnerTypes = ['WAREHOUSE', 'BRANCH'];
  if (!body.sourceOwnerType || !validOwnerTypes.includes(body.sourceOwnerType)) {
    return c.json({ message: 'Invalid or missing sourceOwnerType. Must be WAREHOUSE or BRANCH.' }, 400);
  }
  if (!body.destinationOwnerType || !validOwnerTypes.includes(body.destinationOwnerType)) {
    return c.json({ message: 'Invalid or missing destinationOwnerType. Must be WAREHOUSE or BRANCH.' }, 400);
  }

  // ── Validate source / destination IDs ──
  const sourceId = body.sourceOwnerType === 'WAREHOUSE' ? body.sourceWarehouseId : body.sourceBranchId;
  const destId   = body.destinationOwnerType === 'WAREHOUSE' ? body.destinationWarehouseId : body.destinationBranchId;

  if (!sourceId) {
    return c.json({ message: `A source ${body.sourceOwnerType.toLowerCase()} must be selected.` }, 400);
  }
  if (!destId) {
    return c.json({ message: `A destination ${body.destinationOwnerType.toLowerCase()} must be selected.` }, 400);
  }

  // ── Source ≠ Destination ──
  if (body.sourceOwnerType === body.destinationOwnerType && sourceId === destId) {
    return c.json({ message: 'Source and destination cannot be the same location.' }, 400);
  }

  // ── Validate that the referenced warehouse/branch actually exists ──
  if (body.sourceOwnerType === 'WAREHOUSE') {
    const wh = await c.env.DB.prepare('SELECT id FROM warehouses WHERE id = ?').bind(sourceId).first();
    if (!wh) return c.json({ message: 'Source warehouse does not exist.' }, 400);
  } else {
    const br = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(sourceId).first();
    if (!br) return c.json({ message: 'Source branch does not exist.' }, 400);
  }
  if (body.destinationOwnerType === 'WAREHOUSE') {
    const wh = await c.env.DB.prepare('SELECT id FROM warehouses WHERE id = ?').bind(destId).first();
    if (!wh) return c.json({ message: 'Destination warehouse does not exist.' }, 400);
  } else {
    const br = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(destId).first();
    if (!br) return c.json({ message: 'Destination branch does not exist.' }, 400);
  }

  // ── Validate lines array ──
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one line item is required.' }, 400);
  }

  const seenProductIds = new Set<string>();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) {
      return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    }
    if (!line.quantityRequested || !Number.isInteger(line.quantityRequested) || line.quantityRequested <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityRequested must be a positive integer.` }, 400);
    }
    if (seenProductIds.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product detected. Combine quantities into one line.` }, 400);
    }
    seenProductIds.add(line.productId);

    // Verify product exists
    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(line.productId).first();
    if (!product) {
      return c.json({ message: `Line ${i + 1}: product '${line.productId}' does not exist.` }, 400);
    }
  }

  // ── Build & execute ──
  const id = uuidv4();
  const transferNumber = `TR-${Date.now()}`;

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO transfers (id, transfer_number, status, source_owner_type, source_warehouse_id, source_branch_id, destination_owner_type, destination_warehouse_id, destination_branch_id, requested_by, transfer_date)
    VALUES (?, ?, 'PENDING_APPROVAL', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, transferNumber, body.sourceOwnerType, body.sourceWarehouseId || null, body.sourceBranchId || null, body.destinationOwnerType, body.destinationWarehouseId || null, body.destinationBranchId || null, userId, body.transferDate || null));

  for (const line of body.lines) {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO transfer_lines (id, transfer_id, product_id, quantity_requested) VALUES (?, ?, ?, ?)
    `).bind(uuidv4(), id, line.productId, line.quantityRequested));
  }

  stmts.push(createAuditLogStmt(c, 'TRANSFER_CREATE', 'transfers', id, null, { transferNumber, sourceOwnerType: body.sourceOwnerType, destinationOwnerType: body.destinationOwnerType, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// POST /:id/approve  — Approve & execute a transfer (atomic, safe)
//
// Guard 1: Optimistic concurrency — we CAS the status from
//          PENDING_APPROVAL → PROCESSING.  If the UPDATE touches 0
//          rows it means another request already claimed it.
// Guard 2: Pre-flight availability check — every requested quantity
//          is verified against the source's quantity_on_hand BEFORE
//          any mutation is queued.
// Guard 3: All mutations (deductions, additions, ledger entries,
//          line updates, final status flip) are sent inside a single
//          D1 batch() call so they succeed or fail atomically.
// ──────────────────────────────────────────────────────────────────────
transfers.post('/:id/approve', requirePermissions(['manage_transfers']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  // ── Step 1: Atomically claim the transfer via CAS ──
  // We update only if current status is PENDING_APPROVAL. If another
  // request already flipped it, meta.changes === 0 and we bail out.
  const cas = await c.env.DB.prepare(
    "UPDATE transfers SET status = 'PROCESSING' WHERE id = ? AND status = 'PENDING_APPROVAL'"
  ).bind(id).run();

  if (!cas.meta.changes || cas.meta.changes === 0) {
    // Either transfer doesn't exist, or it's already been claimed
    const existing = await c.env.DB.prepare('SELECT status FROM transfers WHERE id = ?').bind(id).first();
    if (!existing) return c.json({ message: 'Transfer not found.' }, 404);
    if (existing.status === 'COMPLETED') return c.json({ message: 'This transfer has already been completed.' }, 409);
    if (existing.status === 'PROCESSING') return c.json({ message: 'This transfer is currently being processed by another request.' }, 409);
    return c.json({ message: `Transfer cannot be approved from status '${existing.status}'.` }, 400);
  }

  // From this point on, we own the transfer (status = PROCESSING).
  // If anything fails we must roll it back to PENDING_APPROVAL.

  try {
    // ── Step 2: Load the transfer & its lines ──
    const transfer = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).first();
    if (!transfer) {
      // Shouldn't happen, but be safe
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({ message: 'Transfer not found after lock acquisition.' }, 500);
    }

    // ── Step 2b: Check transfer_date is not in the future ──
    if (transfer.transfer_date) {
      const transferDate = new Date(transfer.transfer_date as string);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      transferDate.setHours(0, 0, 0, 0);
      if (transferDate > today) {
        await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
        return c.json({ message: `Cannot approve: transfer is scheduled for ${(transfer.transfer_date as string).slice(0, 10)}, which is in the future.` }, 400);
      }
    }

    const { results: lines } = await c.env.DB.prepare(
      'SELECT * FROM transfer_lines WHERE transfer_id = ?'
    ).bind(id).all();

    if (!lines || lines.length === 0) {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({ message: 'Transfer has no line items.' }, 400);
    }

    // ── Step 3: Pre-flight stock availability check ──
    // We check EVERY line's source inventory BEFORE we build any
    // mutation statements.  This guarantees we never deduct more
    // than what's available and prevents negative inventory.
    const insufficientLines: string[] = [];

    // We also gather destination stock rows up-front so we know
    // whether to INSERT or UPDATE in the batch (no async in the
    // batch-building loop).
    interface StockInfo {
      sourceStockId: string | null;
      sourceQtyOnHand: number;
      destStockId: string | null;
    }
    const stockInfoMap = new Map<string, StockInfo>();

    await Promise.all(
      lines.map(async (line: any) => {
        const [srcStock, dstStock] = await Promise.all([
          c.env.DB.prepare(`
            SELECT id, quantity_on_hand FROM inventory_stock
            WHERE product_id = ? AND owner_type = ?
              AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
              AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
          `).bind(
            line.product_id,
            transfer.source_owner_type,
            transfer.source_warehouse_id || null, transfer.source_warehouse_id || null,
            transfer.source_branch_id || null, transfer.source_branch_id || null
          ).first(),

          c.env.DB.prepare(`
            SELECT id FROM inventory_stock
            WHERE product_id = ? AND owner_type = ?
              AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
              AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
          `).bind(
            line.product_id,
            transfer.destination_owner_type,
            transfer.destination_warehouse_id || null, transfer.destination_warehouse_id || null,
            transfer.destination_branch_id || null, transfer.destination_branch_id || null
          ).first()
        ]);

        const srcQty = (srcStock?.quantity_on_hand as number) || 0;
        const reqQty = line.quantity_requested as number;

        if (srcQty < reqQty) {
          insufficientLines.push(
            `Product ${line.product_id}: requested ${reqQty}, available ${srcQty}`
          );
        }

        stockInfoMap.set(line.id as string, {
          sourceStockId: (srcStock?.id as string) || null,
          sourceQtyOnHand: srcQty,
          destStockId: (dstStock?.id as string) || null,
        });
      })
    );

    if (insufficientLines.length > 0) {
      // Roll back the CAS lock
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
      return c.json({
        message: 'Insufficient stock to fulfill this transfer.',
        details: insufficientLines,
      }, 400);
    }

    // ── Step 4: Build the atomic batch ──
    // Everything below goes into a single D1 batch() call.
    const stmts: ReturnType<ReturnType<typeof c.env.DB.prepare>['bind']>[] = [];

    for (const line of lines) {
      const qty = line.quantity_requested as number;
      const info = stockInfoMap.get(line.id as string)!;

      // 4a. Deduct from source (row MUST exist because we verified above)
      stmts.push(c.env.DB.prepare(`
        UPDATE inventory_stock
        SET quantity_on_hand = quantity_on_hand - ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND owner_type = ?
          AND (warehouse_id = ? OR (warehouse_id IS NULL AND ? IS NULL))
          AND (branch_id = ? OR (branch_id IS NULL AND ? IS NULL))
      `).bind(
        qty, line.product_id,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null, transfer.source_warehouse_id || null,
        transfer.source_branch_id || null, transfer.source_branch_id || null
      ));

      // 4b. TRANSFER_OUT ledger entry
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions
        (id, product_id, transaction_type, quantity,
         source_owner_type, source_warehouse_id, source_branch_id,
         destination_owner_type, destination_warehouse_id, destination_branch_id,
         reference_type, reference_id, created_by)
        VALUES (?, ?, 'TRANSFER_OUT', ?,  ?, ?, ?,  ?, ?, ?,  'TRANSFER', ?, ?)
      `).bind(
        uuidv4(), line.product_id, -qty,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null, transfer.source_branch_id || null,
        transfer.destination_owner_type,
        transfer.destination_warehouse_id || null, transfer.destination_branch_id || null,
        id, userId
      ));

      // 4c. Add to destination (INSERT or UPDATE)
      if (info.destStockId) {
        stmts.push(c.env.DB.prepare(`
          UPDATE inventory_stock
          SET quantity_on_hand = quantity_on_hand + ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(qty, info.destStockId));
      } else {
        stmts.push(c.env.DB.prepare(`
          INSERT INTO inventory_stock
          (id, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          uuidv4(), line.product_id,
          transfer.destination_owner_type,
          transfer.destination_warehouse_id || null,
          transfer.destination_branch_id || null,
          qty
        ));
      }

      // 4d. TRANSFER_IN ledger entry
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_transactions
        (id, product_id, transaction_type, quantity,
         source_owner_type, source_warehouse_id, source_branch_id,
         destination_owner_type, destination_warehouse_id, destination_branch_id,
         reference_type, reference_id, created_by)
        VALUES (?, ?, 'TRANSFER_IN', ?,  ?, ?, ?,  ?, ?, ?,  'TRANSFER', ?, ?)
      `).bind(
        uuidv4(), line.product_id, qty,
        transfer.source_owner_type,
        transfer.source_warehouse_id || null, transfer.source_branch_id || null,
        transfer.destination_owner_type,
        transfer.destination_warehouse_id || null, transfer.destination_branch_id || null,
        id, userId
      ));

      // 4e. Mark the line as fully dispatched & received
      stmts.push(c.env.DB.prepare(
        'UPDATE transfer_lines SET quantity_dispatched = ?, quantity_received = ? WHERE id = ?'
      ).bind(qty, qty, line.id));
    }

    // 4f. Flip transfer to COMPLETED
    stmts.push(c.env.DB.prepare(`
      UPDATE transfers
      SET status = 'COMPLETED',
          approved_by = ?, approved_at = CURRENT_TIMESTAMP,
          dispatched_by = ?, dispatched_at = CURRENT_TIMESTAMP,
          received_by = ?,  received_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(userId, userId, userId, id));

    // ── Step 5: Execute the batch atomically ──
    stmts.push(createAuditLogStmt(c, 'TRANSFER_APPROVE_COMPLETE', 'transfers', id, { status: 'PENDING_APPROVAL' }, { status: 'COMPLETED' }));
    await c.env.DB.batch(stmts);

    // ── Step 6: Return the completed transfer ──
    const result = await c.env.DB.prepare('SELECT * FROM transfers WHERE id = ?').bind(id).first();
    return c.json(result);

  } catch (err: any) {
    // Something went wrong — roll back the CAS lock so the transfer
    // can be retried.
    try {
      await c.env.DB.prepare("UPDATE transfers SET status = 'PENDING_APPROVAL' WHERE id = ?").bind(id).run();
    } catch (_rollbackErr) {
      // Best-effort rollback; log but don't mask the original error
    }
    console.error('Transfer approval failed:', err);
    return c.json({ message: 'Transfer approval failed. The transfer has been rolled back to Pending.', error: err?.message }, 500);
  }
});

export default transfers;
