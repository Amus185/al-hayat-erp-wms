import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { prepareJournalEntryPosting } from '../services/accounting-service';
import { csvResponse, dateRange, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';

const manufacturing = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

manufacturing.use('/*', authMiddleware);

// Standard Manufacturing Stages
const DEFAULT_STAGES = [
  '1. Cutting & Material Prep',
  '2. Carpentry & Assembly',
  '3. Sanding & Finishing / Polish',
  '4. Quality Inspection & Packaging',
];

// ──────────────────────────────────────────────────────────────────────
// KPI STATS
// ──────────────────────────────────────────────────────────────────────
manufacturing.get('/stats', async (c) => {
  const db = c.env.DB;

  const activeWorkOrders = await db.prepare("SELECT COUNT(*) AS count FROM work_orders WHERE status = 'IN_PROGRESS'").first();
  const inProductionUnits = await db.prepare("SELECT COALESCE(SUM(target_quantity - completed_quantity), 0) AS units FROM work_orders WHERE status = 'IN_PROGRESS'").first();
  const completedThisMonth = await db.prepare(`
    SELECT COALESCE(SUM(completed_quantity), 0) AS units FROM work_orders
    WHERE status = 'COMPLETED' AND date_trunc('month', completed_at) = date_trunc('month', CURRENT_DATE)
  `).first();
  const totalBoms = await db.prepare('SELECT COUNT(*) AS count FROM bill_of_materials WHERE is_active = 1').first();

  return c.json({
    activeWorkOrders: Number(activeWorkOrders?.count || 0),
    inProductionUnits: Number(inProductionUnits?.units || 0),
    completedThisMonth: Number(completedThisMonth?.units || 0),
    totalBoms: Number(totalBoms?.count || 0),
  });
});

// ──────────────────────────────────────────────────────────────────────
// BILLS OF MATERIALS (BOM) — LIST & GET
// ──────────────────────────────────────────────────────────────────────
manufacturing.get('/boms', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT b.*, p.name AS product_name, p.sku AS product_sku,
           (SELECT COUNT(*) FROM bom_items bi WHERE bi.bom_id = b.id) AS components_count,
           (SELECT COALESCE(SUM(bi.quantity_required * bi.unit_cost), 0) FROM bom_items bi WHERE bi.bom_id = b.id) AS raw_material_cost
    FROM bill_of_materials b
    JOIN products p ON p.id = b.product_id
    WHERE b.is_active = 1
    ORDER BY b.created_at DESC
  `).all();

  return c.json(results || []);
});

manufacturing.get('/boms/:id', async (c) => {
  const id = c.req.param('id');
  const bom = await c.env.DB.prepare(`
    SELECT b.*, p.name AS product_name, p.sku AS product_sku
    FROM bill_of_materials b
    JOIN products p ON p.id = b.product_id
    WHERE b.id = ?
  `).bind(id).first();

  if (!bom) return c.json({ message: 'BOM not found' }, 404);

  const { results: items } = await c.env.DB.prepare(`
    SELECT bi.*, p.name AS material_name, p.sku AS material_sku, p.cost_price AS current_cost_price
    FROM bom_items bi
    JOIN products p ON p.id = bi.material_product_id
    WHERE bi.bom_id = ?
  `).bind(id).all();

  return c.json({ ...bom, items: items || [] });
});

manufacturing.post('/boms', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();

  if (!body.name || !body.name.trim()) return c.json({ message: 'BOM recipe name is required.' }, 400);
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ message: 'At least one raw material component is required.' }, 400);
  }

  let targetProductId = body.productId;

  // Support creating a new manufactured item from scratch
  if (!targetProductId && body.newProduct) {
    if (!body.newProduct.name || !body.newProduct.name.trim()) {
      return c.json({ message: 'Manufactured item name is required.' }, 400);
    }
    const newProdId = uuidv4();
    const sku = body.newProduct.sku?.trim() || `MFG-${Date.now().toString().slice(-6)}`;
    const costPrice = Number(body.newProduct.unitCost || 0);
    const sellingPrice = Number(body.newProduct.sellingPrice || 0);

    await c.env.DB.prepare(`
      INSERT INTO products (id, sku, name, description, category_id, cost_price, selling_price, unit_of_measure)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'UNIT')
    `).bind(
      newProdId,
      sku,
      body.newProduct.name.trim(),
      body.newProduct.description?.trim() || `Manufactured item: ${body.newProduct.name.trim()}`,
      body.newProduct.categoryId || null,
      costPrice,
      sellingPrice
    ).run();

    targetProductId = newProdId;
  }

  if (!targetProductId) {
    return c.json({ message: 'Target manufactured product definition is required.' }, 400);
  }

  const id = uuidv4();
  const bomCode = body.bomCode?.trim() || `BOM-${Date.now().toString().slice(-6)}`;
  const laborCost = Number(body.laborCost || 0);
  const overheadCost = Number(body.overheadCost || 0);

  const stmts: any[] = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO bill_of_materials (
      id, bom_code, name, product_id, quantity, unit_of_measure, labor_cost, overhead_cost, estimated_hours, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    bomCode,
    body.name.trim(),
    targetProductId,
    Number(body.quantity || 1),
    body.unitOfMeasure?.trim() || 'UNIT',
    laborCost,
    overheadCost,
    Number(body.estimatedHours || 0),
    body.notes?.trim() || null
  ));

  for (const item of body.items) {
    if (item.materialProductId && Number(item.quantityRequired) > 0) {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO bom_items (id, bom_id, material_product_id, quantity_required, unit_cost, scrap_percentage, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        uuidv4(),
        id,
        item.materialProductId,
        Number(item.quantityRequired),
        Number(item.unitCost || 0),
        Number(item.scrapPercentage || 0),
        item.notes?.trim() || null
      ));
    }
  }

  stmts.push(createAuditLogStmt(c, 'BOM_CREATE', 'bill_of_materials', id, null, { bomCode, name: body.name }));
  await c.env.DB.batch(stmts);

  const created = await c.env.DB.prepare('SELECT * FROM bill_of_materials WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

// ──────────────────────────────────────────────────────────────────────
// WORK ORDERS (PRODUCTION RUNS) — LIST & GET
// ──────────────────────────────────────────────────────────────────────
const WORK_ORDER_LIST: ListOptions = {
  sortable: { date: 'created_at', number: 'wo_number', product: 'product_name', status: 'status', stage: 'current_stage', warehouse: 'warehouse_name', quantity: 'target_quantity', due: 'target_completion_date' },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

manufacturing.get('/work-orders', async (c) => {
  const { status, stage, warehouseId } = c.req.query();
  const search = c.req.query('search') || c.req.query('q');
  const listReq = listRequest(c, WORK_ORDER_LIST);

  let query = `
    SELECT wo.*, p.name AS product_name, p.sku AS product_sku, w.name AS warehouse_name,
           u.full_name AS created_by_name, bom.bom_code, bom.name AS bom_name
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN warehouses w ON w.id = wo.warehouse_id
    LEFT JOIN bill_of_materials bom ON bom.id = wo.bom_id
    LEFT JOIN users u ON u.id = wo.created_by
    WHERE 1=1
  `;
  const params: any[] = [];

  if (status && status !== 'ALL' && !listReq.paged) {
    query += ` AND wo.status = ?`;
    params.push(status);
  }
  if (stage && stage !== 'ALL') {
    query += ` AND wo.current_stage = ?`;
    params.push(stage);
  }
  if (warehouseId) {
    query += ` AND wo.warehouse_id = ?`;
    params.push(warehouseId);
  }
  if (search) {
    query += ` AND (wo.wo_number ILIKE ? OR p.name ILIKE ? OR p.sku ILIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (listReq.paged) {
    const where: string[] = [];
    const extra: unknown[] = [];
    dateRange(c, 'created_at', where, extra);
    const statusWhere = [...where];
    const statusParams = [...extra];
    if (status && status !== 'ALL') { statusWhere.push('status = ?'); statusParams.push(status); }
    const base = `FROM (${query}) x ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;
    const { rows, total } = await pagedRows(c.env.DB, '*', base, [...params, ...statusParams], listReq);
    if (listReq.csv) {
      return csvResponse(c, 'work-orders', [
        { label: 'Work order', value: (w: any) => w.wo_number },
        { label: 'Created', value: (w: any) => String(w.created_at instanceof Date ? w.created_at.toISOString() : w.created_at).slice(0, 10) },
        { label: 'Product', value: (w: any) => w.product_name },
        { label: 'SKU', value: (w: any) => w.product_sku },
        { label: 'Target quantity', value: (w: any) => w.target_quantity },
        { label: 'Completed', value: (w: any) => w.completed_quantity },
        { label: 'Warehouse', value: (w: any) => w.warehouse_name },
        { label: 'Status', value: (w: any) => w.status },
        { label: 'Stage', value: (w: any) => w.current_stage },
      ], rows);
    }
    const { results: grouped } = await c.env.DB.prepare(`SELECT status, COUNT(*)::int AS n FROM (${query}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY status`).bind(...params, ...extra).all();
    const counts: Record<string, number> = { ALL: 0 };
    for (const g of (grouped || []) as any[]) { counts[g.status] = Number(g.n); counts.ALL += Number(g.n); }
    return pagedResponse(c, listReq, rows, total, { counts });
  }

  query += ` ORDER BY wo.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json(results || []);
});

manufacturing.get('/work-orders/:id', async (c) => {
  const id = c.req.param('id');
  const wo = await c.env.DB.prepare(`
    SELECT wo.*, p.name AS product_name, p.sku AS product_sku, w.name AS warehouse_name,
           u.full_name AS created_by_name, bom.bom_code, bom.name AS bom_name
    FROM work_orders wo
    JOIN products p ON p.id = wo.product_id
    JOIN warehouses w ON w.id = wo.warehouse_id
    LEFT JOIN bill_of_materials bom ON bom.id = wo.bom_id
    LEFT JOIN users u ON u.id = wo.created_by
    WHERE wo.id = ?
  `).bind(id).first();

  if (!wo) return c.json({ message: 'Work order not found' }, 404);

  const { results: materials } = await c.env.DB.prepare(`
    SELECT wom.*, p.name AS material_name, p.sku AS material_sku,
           (SELECT COALESCE(quantity_on_hand, 0) FROM inventory_stock WHERE product_id = wom.material_product_id AND warehouse_id = ? LIMIT 1) AS stock_available
    FROM work_order_materials wom
    JOIN products p ON p.id = wom.material_product_id
    WHERE wom.work_order_id = ?
  `).bind((wo as any).warehouse_id, id).all();

  const { results: stages } = await c.env.DB.prepare(`
    SELECT * FROM work_order_stages WHERE work_order_id = ? ORDER BY sequence_order ASC
  `).bind(id).all();

  return c.json({ ...wo, materials: materials || [], stages: stages || [] });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE WORK ORDER
// ──────────────────────────────────────────────────────────────────────
manufacturing.post('/work-orders', requirePermissions(['manage_inventory']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  if (!body.warehouseId) return c.json({ message: 'Production warehouse facility is required.' }, 400);
  const targetQty = Number(body.targetQuantity || 0);
  if (!Number.isInteger(targetQty) || targetQty <= 0) {
    return c.json({ message: 'Target quantity must be a positive integer.' }, 400);
  }

  let targetProductId = body.productId;

  // Support creating newly defined manufactured item from scratch
  if (!targetProductId && body.newProduct) {
    if (!body.newProduct.name || !body.newProduct.name.trim()) {
      return c.json({ message: 'Manufactured item name is required.' }, 400);
    }
    const newProdId = uuidv4();
    const sku = body.newProduct.sku?.trim() || `MFG-${Date.now().toString().slice(-6)}`;
    const costPrice = Number(body.newProduct.unitCost || 0);
    const sellingPrice = Number(body.newProduct.sellingPrice || 0);

    await c.env.DB.prepare(`
      INSERT INTO products (id, sku, name, description, category_id, cost_price, selling_price, unit_of_measure)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'UNIT')
    `).bind(
      newProdId,
      sku,
      body.newProduct.name.trim(),
      body.newProduct.description?.trim() || `Manufactured item: ${body.newProduct.name.trim()}`,
      body.newProduct.categoryId || null,
      costPrice,
      sellingPrice
    ).run();

    targetProductId = newProdId;
  }

  if (!targetProductId) {
    return c.json({ message: 'Please specify or define the finished good to manufacture.' }, 400);
  }

  const id = uuidv4();
  const woNumber = `WO-${Date.now().toString().slice(-6)}`;

  // Find BOM if specified or latest for product
  let bomId = body.bomId || null;
  if (!bomId) {
    const defaultBom = await c.env.DB.prepare(`
      SELECT id FROM bill_of_materials WHERE product_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1
    `).bind(targetProductId).first();
    bomId = (defaultBom?.id as string) || null;
  }

  const stmts: any[] = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO work_orders (
      id, wo_number, product_id, bom_id, warehouse_id, target_quantity, completed_quantity,
      rejected_quantity, status, current_stage, estimated_start_date, target_completion_date,
      labor_cost, supervisor_id, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'PLANNED', '1. Cutting & Material Prep', ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    woNumber,
    targetProductId,
    bomId,
    body.warehouseId,
    targetQty,
    body.estimatedStartDate || null,
    body.targetCompletionDate || null,
    Number(body.laborCost || 0),
    body.supervisorId || null,
    body.notes?.trim() || null,
    userId
  ));

  // Populate materials: custom list if supplied, otherwise from BOM scaled by targetQuantity
  if (Array.isArray(body.materials) && body.materials.length > 0) {
    for (const m of body.materials) {
      if (m.materialProductId && Number(m.plannedQuantity || m.quantityRequired) > 0) {
        const qty = Number(m.plannedQuantity || (Number(m.quantityRequired) * targetQty));
        stmts.push(c.env.DB.prepare(`
          INSERT INTO work_order_materials (id, work_order_id, material_product_id, planned_quantity, unit_cost, status)
          VALUES (?, ?, ?, ?, ?, 'PENDING')
        `).bind(uuidv4(), id, m.materialProductId, qty, Number(m.unitCost || 0)));
      }
    }
  } else if (bomId) {
    const { results: bomItems } = await c.env.DB.prepare(`
      SELECT * FROM bom_items WHERE bom_id = ?
    `).bind(bomId).all();

    for (const bi of (bomItems || []) as any[]) {
      const plannedQty = Number(bi.quantity_required) * targetQty;
      stmts.push(c.env.DB.prepare(`
        INSERT INTO work_order_materials (id, work_order_id, material_product_id, planned_quantity, unit_cost, status)
        VALUES (?, ?, ?, ?, ?, 'PENDING')
      `).bind(uuidv4(), id, bi.material_product_id, plannedQty, Number(bi.unit_cost || 0)));
    }
  }

  // Populate 4 standard stages
  DEFAULT_STAGES.forEach((stageName, idx) => {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO work_order_stages (id, work_order_id, stage_name, sequence_order, status)
      VALUES (?, ?, ?, ?, ?)
    `).bind(uuidv4(), id, stageName, idx + 1, 'PENDING'));
  });

  stmts.push(createAuditLogStmt(c, 'WORK_ORDER_CREATE', 'work_orders', id, null, { woNumber, targetQty, productId: targetProductId }));
  await c.env.DB.batch(stmts);

  const created = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first();
  return c.json(created, 201);
});

// ──────────────────────────────────────────────────────────────────────
// START WORK ORDER — CONSUMES RAW MATERIALS & POSTS GL
// ──────────────────────────────────────────────────────────────────────
manufacturing.post('/work-orders/:id/start', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const wo = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first() as any;
  if (!wo) return c.json({ message: 'Work order not found' }, 404);
  if (wo.status === 'IN_PROGRESS') return c.json({ message: 'Work order is already in progress' }, 400);
  if (wo.status === 'COMPLETED') return c.json({ message: 'Work order is already completed' }, 400);

  // Fetch materials needed
  const { results: materials } = await c.env.DB.prepare(`
    SELECT wom.*, p.cost_price
    FROM work_order_materials wom
    JOIN products p ON p.id = wom.material_product_id
    WHERE wom.work_order_id = ?
  `).bind(id).all();

  // Claim the work order (a double-click start must not consume twice).
  const stmts: any[] = [
    c.env.DB.prepare("UPDATE work_orders SET status = 'IN_PROGRESS' WHERE id = ? AND status = ?")
      .bind(id, wo.status).mustAffect('This work order was just started or changed. Please refresh.'),
  ];
  let totalMaterialCost = 0;

  // Refuse to start without the raw materials: consuming stock that is not
  // there would post material cost for goods that were never used.
  const shortages: string[] = [];
  for (const m of (materials || []) as any[]) {
    const stock = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(quantity_on_hand), 0) AS qty FROM inventory_stock
      WHERE product_id = ? AND warehouse_id = ? AND owner_type = 'WAREHOUSE'
    `).bind(m.material_product_id, wo.warehouse_id).first() as any;
    if (Number(stock?.qty || 0) < Number(m.planned_quantity)) {
      shortages.push(`${m.material_product_id}: need ${m.planned_quantity}, available ${Number(stock?.qty || 0)}`);
    }
  }
  if (shortages.length) {
    return c.json({ message: 'Insufficient raw materials in the production warehouse.', details: shortages }, 400);
  }

  // Deduct
  for (const m of (materials || []) as any[]) {
    const qty = Number(m.planned_quantity);
    const unitCost = Number(m.unit_cost || m.cost_price || 0);
    totalMaterialCost += (qty * unitCost);

    // Deduct raw materials from inventory stock in this warehouse (never below zero)
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock
      SET quantity_on_hand = quantity_on_hand - ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE product_id = ? AND warehouse_id = ? AND owner_type = 'WAREHOUSE' AND quantity_on_hand >= ?
    `).bind(qty, m.material_product_id, wo.warehouse_id, qty)
      .mustAffect('Raw material stock changed while starting the work order. Please refresh.'));

    // Record inventory transaction
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, source_owner_type, source_warehouse_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'MANUFACTURING_CONSUMPTION', ?, 'WAREHOUSE', ?, 'WORK_ORDER', ?, ?)
    `).bind(uuidv4(), m.material_product_id, -qty, wo.warehouse_id, id, userId));

    // Update work_order_materials status
    stmts.push(c.env.DB.prepare(`
      UPDATE work_order_materials SET consumed_quantity = ?, status = 'CONSUMED' WHERE id = ?
    `).bind(qty, m.id));
  }

  // Update work order status
  stmts.push(c.env.DB.prepare(`
    UPDATE work_orders
    SET status = 'IN_PROGRESS',
        actual_start_date = CURRENT_TIMESTAMP,
        material_cost = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(totalMaterialCost, id));

  // Mark first stage as IN_PROGRESS
  stmts.push(c.env.DB.prepare(`
    UPDATE work_order_stages SET status = 'IN_PROGRESS', started_at = CURRENT_TIMESTAMP
    WHERE work_order_id = ? AND sequence_order = 1
  `).bind(id));

  // GL (DR 1070 WIP, CR 1030 Raw Materials) commits with the stock movement.
  if (totalMaterialCost > 0) {
    stmts.push(...(await prepareJournalEntryPosting(c, {
      description: `Manufacturing Material Consumption for WO #${wo.wo_number}`,
      referenceType: 'MANUFACTURING',
      referenceId: wo.id,
      userId,
      lines: [
        { accountCode: '1070', debitAmount: totalMaterialCost, creditAmount: 0 },
        { accountCode: '1030', debitAmount: 0, creditAmount: totalMaterialCost },
      ],
    })).statements);
  }

  await c.env.DB.batch(stmts);
  await logAudit(c, 'WORK_ORDER_START', 'work_orders', id, { status: wo.status }, { status: 'IN_PROGRESS', totalMaterialCost });

  const updated = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first();
  return c.json({ success: true, workOrder: updated });
});

// ──────────────────────────────────────────────────────────────────────
// ADVANCE WORK ORDER STAGE
// ──────────────────────────────────────────────────────────────────────
manufacturing.post('/work-orders/:id/advance-stage', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  const wo = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first() as any;
  if (!wo) return c.json({ message: 'Work order not found' }, 404);

  const { results: stages } = await c.env.DB.prepare(`
    SELECT * FROM work_order_stages WHERE work_order_id = ? ORDER BY sequence_order ASC
  `).bind(id).all();

  const currentStageIndex = (stages || []).findIndex((s: any) => s.stage_name === wo.current_stage);
  const nextStage = stages && stages[currentStageIndex + 1];

  const stmts: any[] = [];
  if (stages && stages[currentStageIndex]) {
    // Complete current stage
    stmts.push(c.env.DB.prepare(`
      UPDATE work_order_stages
      SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, technician_name = ?, notes = ?
      WHERE id = ?
    `).bind(body.technicianName?.trim() || null, body.notes?.trim() || null, (stages[currentStageIndex] as any).id));
  }

  if (nextStage) {
    // Start next stage
    stmts.push(c.env.DB.prepare(`
      UPDATE work_order_stages SET status = 'IN_PROGRESS', started_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind((nextStage as any).id));

    stmts.push(c.env.DB.prepare(`
      UPDATE work_orders SET current_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind((nextStage as any).stage_name, id));
  } else {
    // Reached final stage
    stmts.push(c.env.DB.prepare(`
      UPDATE work_orders SET current_stage = 'Completed Quality Inspection', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(id));
  }

  await c.env.DB.batch(stmts);
  const updated = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first();
  return c.json({ success: true, workOrder: updated });
});

// ──────────────────────────────────────────────────────────────────────
// COMPLETE WORK ORDER — DEPOSITS FINISHED GOODS & POSTS GL
// ──────────────────────────────────────────────────────────────────────
manufacturing.post('/work-orders/:id/complete', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const userId = c.get('jwtPayload').sub;

  const wo = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first() as any;
  if (!wo) return c.json({ message: 'Work order not found' }, 404);
  if (wo.status === 'COMPLETED') return c.json({ message: 'Work order is already completed' }, 400);
  if (wo.status !== 'IN_PROGRESS') return c.json({ message: 'Start the work order (consume materials) before completing it.' }, 400);

  const completedQty = Number(body.completedQuantity || wo.target_quantity);
  const rejectedQty = Number(body.rejectedQuantity || 0);
  if (!Number.isInteger(completedQty) || completedQty < 0 || !Number.isInteger(rejectedQty) || rejectedQty < 0) {
    return c.json({ message: 'Completed and rejected quantities must be whole numbers of zero or more.' }, 400);
  }
  const materialCost = Number(wo.material_cost || 0);
  const laborCost = Number(body.laborCost || wo.labor_cost || 0);
  const totalProductionCost = materialCost + laborCost;
  const unitProductionCost = completedQty > 0 ? (totalProductionCost / completedQty) : 0;

  // Claim: a double-click complete must not add finished goods twice.
  const stmts: any[] = [
    c.env.DB.prepare("UPDATE work_orders SET status = 'COMPLETED' WHERE id = ? AND status = 'IN_PROGRESS'")
      .bind(id).mustAffect('This work order was just completed or changed. Please refresh.'),
  ];

  // Check if finished good exists in warehouse stock
  const existingStock = await c.env.DB.prepare(`
    SELECT id FROM inventory_stock
    WHERE product_id = ? AND warehouse_id = ? AND owner_type = 'WAREHOUSE'
  `).bind(wo.product_id, wo.warehouse_id).first();

  if (existingStock) {
    stmts.push(c.env.DB.prepare(`
      UPDATE inventory_stock
      SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(completedQty, (existingStock as any).id));
  } else {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, quantity_on_hand)
      VALUES (?, ?, 'WAREHOUSE', ?, ?)
    `).bind(uuidv4(), wo.product_id, wo.warehouse_id, completedQty));
  }

  // Update newly manufactured product unit cost from actual production run
  if (unitProductionCost > 0) {
    stmts.push(c.env.DB.prepare(`
      UPDATE products SET cost_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(unitProductionCost, wo.product_id));
  }

  // Inventory transaction for finished product
  stmts.push(c.env.DB.prepare(`
    INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, reference_type, reference_id, created_by)
    VALUES (?, ?, 'MANUFACTURING_FINISH', ?, 'WAREHOUSE', ?, 'WORK_ORDER', ?, ?)
  `).bind(uuidv4(), wo.product_id, completedQty, wo.warehouse_id, id, userId));

  // Mark all stages as completed
  stmts.push(c.env.DB.prepare(`
    UPDATE work_order_stages
    SET status = 'COMPLETED', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
    WHERE work_order_id = ?
  `).bind(id));

  // Mark work order as COMPLETED
  stmts.push(c.env.DB.prepare(`
    UPDATE work_orders
    SET status = 'COMPLETED',
        current_stage = 'COMPLETED',
        completed_quantity = ?,
        rejected_quantity = ?,
        labor_cost = ?,
        total_production_cost = ?,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(completedQty, rejectedQty, laborCost, totalProductionCost, id));

  // GL (DR 1030 Finished Goods, CR 1070 WIP) for the material cost that start
  // moved into WIP. Own reference key: sharing the consumption entry's key made
  // the idempotency guard silently skip this posting. Labor is not yet
  // journaled anywhere (no labor/payroll account) — see AUDIT_REPORT.
  if (materialCost > 0) {
    stmts.push(...(await prepareJournalEntryPosting(c, {
      description: `Finished Goods Produced for WO #${wo.wo_number}`,
      referenceType: 'MANUFACTURING',
      referenceId: `${wo.id}:complete`,
      userId,
      lines: [
        { accountCode: '1030', debitAmount: materialCost, creditAmount: 0 },
        { accountCode: '1070', debitAmount: 0, creditAmount: materialCost },
      ],
    })).statements);
  }

  await c.env.DB.batch(stmts);
  await logAudit(c, 'WORK_ORDER_COMPLETE', 'work_orders', id, { status: wo.status }, { status: 'COMPLETED', completedQty, totalProductionCost });

  const updated = await c.env.DB.prepare('SELECT * FROM work_orders WHERE id = ?').bind(id).first();
  return c.json({ success: true, workOrder: updated });
});

// ──────────────────────────────────────────────────────────────────────
// MANUAL MANUFACTURE: free-typed items (name + price), reusable item
// groups ("Fadhi", "Somali Bed"…) and manufacture jobs combining them.
// ──────────────────────────────────────────────────────────────────────
type ManualItem = { name: string; price: number; group_name?: string | null };

function readItems(raw: unknown): ManualItem[] {
  if (!Array.isArray(raw)) throw new Error('Add at least one item');
  const items: ManualItem[] = [];
  for (const it of raw as any[]) {
    const name = typeof it?.name === 'string' ? it.name.trim().slice(0, 200) : '';
    if (!name) continue; // blank rows are ignored
    const price = Math.round(Number(it.price ?? 0) * 100) / 100;
    if (!Number.isFinite(price) || price < 0) throw new Error(`Price of "${name}" must be zero or more`);
    const group = typeof it.group_name === 'string' && it.group_name.trim() ? it.group_name.trim().slice(0, 120) : null;
    items.push({ name, price, group_name: group });
  }
  if (!items.length) throw new Error('Add at least one item with a name');
  if (items.length > 500) throw new Error('Too many items');
  return items;
}

const groupWithItems = async (db: any, id: string) => {
  const g = await db.prepare('SELECT * FROM mfg_item_groups WHERE id = ?').bind(id).first();
  if (!g) return null;
  const { results } = await db.prepare('SELECT id, name, price::float AS price, sort_order FROM mfg_item_group_items WHERE group_id = ? ORDER BY sort_order, name').bind(id).all();
  return { ...g, items: results || [] };
};

manufacturing.get('/item-groups', async (c) => {
  const q = (c.req.query('q') || '').trim();
  const { results } = await c.env.DB.prepare(`
    SELECT g.id, g.name, g.updated_at,
           COUNT(i.id)::int AS item_count, COALESCE(SUM(i.price), 0)::float AS total,
           COALESCE(json_agg(json_build_object('name', i.name, 'price', i.price::float) ORDER BY i.sort_order, i.name) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
    FROM mfg_item_groups g LEFT JOIN mfg_item_group_items i ON i.group_id = g.id
    ${q ? 'WHERE g.name ILIKE ?' : ''}
    GROUP BY g.id ORDER BY g.name LIMIT 100
  `).bind(...(q ? [likeTerm(q)] : [])).all();
  return c.json(results || []);
});

manufacturing.get('/item-groups/:id', async (c) => {
  const g = await groupWithItems(c.env.DB, c.req.param('id'));
  return g ? c.json(g) : c.json({ error: 'Group not found' }, 404);
});

async function saveGroup(c: any, id: string | null) {
  const body = await c.req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return c.json({ error: 'Give the group a name' }, 400);
  let items: ManualItem[];
  try { items = readItems(body.items); } catch (e: any) { return c.json({ error: e.message }, 400); }
  const db = c.env.DB;
  const clash = await db.prepare('SELECT id FROM mfg_item_groups WHERE lower(name) = lower(?) AND id <> ?').bind(name, id ?? '').first();
  if (clash) return c.json({ error: `A group named "${name}" already exists` }, 409);
  const gid = id ?? uuidv4();
  const stmts: any[] = [];
  if (id) {
    stmts.push(db.prepare('UPDATE mfg_item_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(name, id).mustAffect('Group not found'));
    stmts.push(db.prepare('DELETE FROM mfg_item_group_items WHERE group_id = ?').bind(id));
  } else {
    stmts.push(db.prepare('INSERT INTO mfg_item_groups (id, name, created_by) VALUES (?, ?, ?)').bind(gid, name, c.get('jwtPayload')?.sub ?? null));
  }
  items.forEach((it, i) => stmts.push(db.prepare('INSERT INTO mfg_item_group_items (id, group_id, name, price, sort_order) VALUES (?, ?, ?, ?, ?)').bind(uuidv4(), gid, it.name, it.price, i)));
  stmts.push(createAuditLogStmt(c, id ? 'MFG_GROUP_UPDATE' : 'MFG_GROUP_CREATE', 'mfg_item_groups', gid, null, { name, items: items.length }));
  await db.batch(stmts);
  return c.json(await groupWithItems(db, gid), id ? 200 : 201);
}

manufacturing.post('/item-groups', requirePermissions(['manage_inventory']), (c) => saveGroup(c, null));
manufacturing.put('/item-groups/:id', requirePermissions(['manage_inventory']), (c) => saveGroup(c, c.req.param('id') as string));
manufacturing.delete('/item-groups/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM mfg_item_groups WHERE id = ?').bind(id).mustAffect('Group not found'),
    createAuditLogStmt(c, 'MFG_GROUP_DELETE', 'mfg_item_groups', id, null, null),
  ]);
  return c.json({ success: true });
});

const JOB_LIST: ListOptions = {
  sortable: { date: 'created_at', number: 'job_number', title: 'title', total: 'total', status: 'status', items: 'item_count' },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};
const JOB_SELECT = `
  SELECT j.id, j.job_number, j.title, j.notes, j.status, j.created_by, j.created_at, j.updated_at, j.total::float AS total, u.full_name AS created_by_name,
         (SELECT COUNT(*)::int FROM mfg_job_items i WHERE i.job_id = j.id) AS item_count,
         (SELECT string_agg(DISTINCT i.group_name, ', ') FROM mfg_job_items i WHERE i.job_id = j.id) AS groups
  FROM mfg_jobs j LEFT JOIN users u ON u.id = j.created_by`;

manufacturing.get('/jobs', async (c) => {
  const listReq = listRequest(c, JOB_LIST);
  const q = (k: string) => (c.req.query(k) || '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q('q')) {
    const t = likeTerm(q('q'));
    where.push(`(job_number ILIKE ? OR title ILIKE ? OR COALESCE(groups, '') ILIKE ? OR EXISTS (SELECT 1 FROM mfg_job_items i WHERE i.job_id = x.id AND i.name ILIKE ?))`);
    params.push(t, t, t, t);
  }
  dateRange(c, 'created_at', where, params);
  const statusWhere = [...where];
  const statusParams = [...params];
  if (q('status')) { statusWhere.push('status = ?'); statusParams.push(q('status')); }
  const base = `FROM (${JOB_SELECT}) x ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;
  const { rows, total } = await pagedRows(c.env.DB, '*', base, statusParams, { ...listReq, paged: true });
  if (listReq.csv) {
    return csvResponse(c, 'manufacture-jobs', [
      { label: 'Number', value: (r: any) => r.job_number },
      { label: 'Created', value: (r: any) => String(r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at).slice(0, 10) },
      { label: 'Title', value: (r: any) => r.title },
      { label: 'Groups', value: (r: any) => r.groups },
      { label: 'Items', value: (r: any) => r.item_count },
      { label: 'Total', value: (r: any) => Number(r.total) },
      { label: 'Status', value: (r: any) => r.status },
    ], rows);
  }
  const { results: grouped } = await c.env.DB.prepare(`SELECT status, COUNT(*)::int AS n FROM (${JOB_SELECT}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY status`).bind(...params).all();
  const counts: Record<string, number> = { ALL: 0 };
  for (const g of (grouped || []) as any[]) { counts[g.status] = Number(g.n); counts.ALL += Number(g.n); }
  const sums = await c.env.DB.prepare(`SELECT COALESCE(SUM(total), 0)::float AS value ${base}`).bind(...statusParams).first() as any;
  return pagedResponse(c, listReq, rows, total, { counts, totals: { value: Number(sums?.value || 0) } });
});

manufacturing.get('/jobs/:id', async (c) => {
  const db = c.env.DB;
  const job = await db.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Manufacture not found' }, 404);
  const { results } = await db.prepare('SELECT id, name, price::float AS price, group_name, sort_order FROM mfg_job_items WHERE job_id = ? ORDER BY sort_order').bind(c.req.param('id')).all();
  return c.json({ ...job, items: results || [] });
});

async function saveJob(c: any, id: string | null) {
  const body = await c.req.json().catch(() => ({}));
  let items: ManualItem[];
  try { items = readItems(body.items); } catch (e: any) { return c.json({ error: e.message }, 400); }
  const db = c.env.DB;
  const groups = Array.from(new Set(items.map((i) => i.group_name).filter(Boolean)));
  const title = (typeof body.title === 'string' && body.title.trim() ? body.title.trim() : groups.join(' + ') || items[0].name).slice(0, 200);
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 1000) : null;
  const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  const jid = id ?? uuidv4();
  const stmts: any[] = [];
  if (id) {
    const cur = await db.prepare('SELECT status FROM mfg_jobs WHERE id = ?').bind(id).first() as any;
    if (!cur) return c.json({ error: 'Manufacture not found' }, 404);
    if (cur.status !== 'OPEN') return c.json({ error: `A ${cur.status.toLowerCase()} manufacture cannot be edited` }, 400);
    stmts.push(db.prepare(`UPDATE mfg_jobs SET title = ?, notes = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'OPEN'`).bind(title, notes, total, id).mustAffect('This manufacture changed; reopen it'));
    stmts.push(db.prepare('DELETE FROM mfg_job_items WHERE job_id = ?').bind(id));
  } else {
    const n = await db.prepare(`SELECT COALESCE(MAX(NULLIF(regexp_replace(job_number, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM mfg_jobs`).first() as any;
    const number = `MF-${String(n?.n ?? 1).padStart(5, '0')}`;
    stmts.push(db.prepare('INSERT INTO mfg_jobs (id, job_number, title, notes, total, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(jid, number, title, notes, total, c.get('jwtPayload')?.sub ?? null));
  }
  items.forEach((it, i) => stmts.push(db.prepare('INSERT INTO mfg_job_items (id, job_id, name, price, group_name, sort_order) VALUES (?, ?, ?, ?, ?, ?)').bind(uuidv4(), jid, it.name, it.price, it.group_name ?? null, i)));
  stmts.push(createAuditLogStmt(c, id ? 'MFG_JOB_UPDATE' : 'MFG_JOB_CREATE', 'mfg_jobs', jid, null, { title, total, items: items.length }));
  await db.batch(stmts);
  const job = await db.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(jid).first();
  return c.json(job, id ? 200 : 201);
}

manufacturing.post('/jobs', requirePermissions(['manage_inventory']), (c) => saveJob(c, null));
manufacturing.put('/jobs/:id', requirePermissions(['manage_inventory']), (c) => saveJob(c, c.req.param('id') as string));
manufacturing.post('/jobs/:id/status', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const { status } = await c.req.json().catch(() => ({}));
  if (!['OPEN', 'DONE', 'CANCELLED'].includes(status)) return c.json({ error: 'Status must be OPEN, DONE or CANCELLED' }, 400);
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE mfg_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(status, id).mustAffect('Manufacture not found'),
    createAuditLogStmt(c, 'MFG_JOB_STATUS', 'mfg_jobs', id, null, { status }),
  ]);
  return c.json(await db.prepare(`${JOB_SELECT} WHERE j.id = ?`).bind(id).first());
});
manufacturing.delete('/jobs/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM mfg_jobs WHERE id = ?').bind(id).mustAffect('Manufacture not found'),
    createAuditLogStmt(c, 'MFG_JOB_DELETE', 'mfg_jobs', id, null, null),
  ]);
  return c.json({ success: true });
});

export default manufacturing;
