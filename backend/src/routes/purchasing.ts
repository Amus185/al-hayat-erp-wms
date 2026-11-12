import { lotsInStatement, checkLotCodes } from '../services/lots';
import { resolveCashAccount, methodFor, requireChosenAccount } from '../services/money';
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { PgAdapter } from '../pg-client';
import { authMiddleware, requirePermissions } from '../middleware/auth';
import { logAudit, createAuditLogStmt } from '../services/audit';
import { hideUnless, PERM, PURCHASE_FIELDS, sortsFor } from '../services/privacy';
import { resolveLoc, locSql, locBranch } from '../services/branch-scope';
import { prepareJournalEntryPosting } from '../services/accounting-service';
import { csvResponse, likeTerm, listRequest, pagedResponse, pagedRows, type ListOptions } from '../services/listing';

import { costInStatements } from '../services/costing';
import { newLevelStatements } from '../services/price-levels';

const purchasing = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

purchasing.use('/*', authMiddleware);
// Cost prices, purchase costs and stock value only for people with costs.view (Owner decision D4).
purchasing.use('/*', hideUnless(PERM.COSTS, PURCHASE_FIELDS));

// A purchase order belongs to a branch (or is for a warehouse). Suppliers are shared
// master records; each location sees only its own orders, invoices and balances.
const PO_SCOPE = { branch: 'po.branch_id', warehouse: 'po.warehouse_id' };
async function poScope(c: any): Promise<string> { return locSql(await resolveLoc(c), PO_SCOPE); }
/** A purchase order, only if within the caller's location. */
async function poOr404(c: any, id: string): Promise<any | null> {
  return c.env.DB.prepare(`SELECT po.* FROM purchase_orders po WHERE po.id = ? ${await poScope(c)}`).bind(id).first();
}

// ──────────────────────────────────────────────────────────────────────
// SHARED HELPER — compute payment summary for a purchase invoice
// Returns: { amount_paid, net_total, balance, payment_status }
// ──────────────────────────────────────────────────────────────────────
async function getPurchaseInvoicePaymentSummary(
  db: PgAdapter,
  purchaseInvoiceId: string,
  totalAmount: number,
  discountAmount: number
) {
  const res = await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS amount_paid FROM purchase_invoice_payments WHERE purchase_invoice_id = ?'
  ).bind(purchaseInvoiceId).first();
  const amountPaid = Number(res?.amount_paid || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);
  const balance = Math.max(0, netTotal - amountPaid);
  let payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
  if (amountPaid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (amountPaid > 0) payment_status = 'PARTIALLY_PAID';
  return { amount_paid: amountPaid, net_total: netTotal, balance, payment_status };
}

// ──────────────────────────────────────────────────────────────────────
// SUPPLIERS
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/suppliers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers ORDER BY name').all();
  return c.json(results);
});

purchasing.post('/suppliers', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  if (!body.name || !body.name.trim()) {
    return c.json({ message: 'Supplier name is required.' }, 400);
  }
  const id = uuidv4();
  const contact = body.contactPerson || body.contact_person || body.contactName || body.contact_name || null;
  await c.env.DB.prepare(`
    INSERT INTO suppliers (id, name, contact_person, phone, email, address, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).bind(id, body.name.trim(), contact, body.phone || null, body.email || null, body.address || null).run();
  const { results } = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers WHERE id = ?').bind(id).all();
  await logAudit(c, 'SUPPLIER_CREATE', 'suppliers', id, null, body);
  return c.json(results[0], 201);
});

purchasing.patch('/suppliers/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = await c.env.DB.prepare('SELECT * FROM suppliers WHERE id = ?').bind(id).first() as any;
  if (!existing) return c.json({ message: 'Supplier not found.' }, 404);

  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined && body.name.trim()) { fields.push('name = ?'); vals.push(body.name.trim()); }
  if (body.contactPerson !== undefined || body.contact_person !== undefined || body.contactName !== undefined) {
    fields.push('contact_person = ?');
    vals.push(body.contactPerson ?? body.contact_person ?? body.contactName ?? null);
  }
  if (body.phone !== undefined) { fields.push('phone = ?'); vals.push(body.phone || null); }
  if (body.email !== undefined) { fields.push('email = ?'); vals.push(body.email || null); }
  if (body.address !== undefined) { fields.push('address = ?'); vals.push(body.address || null); }
  if (body.isActive !== undefined || body.is_active !== undefined) {
    fields.push('is_active = ?');
    vals.push((body.isActive ?? body.is_active) ? 1 : 0);
  }
  if (fields.length === 0) return c.json({ message: 'No valid fields provided to update.' }, 400);

  vals.push(id);
  await c.env.DB.prepare(`UPDATE suppliers SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const updated = await c.env.DB.prepare('SELECT id, name, contact_person, contact_person AS contact_name, phone, email, address, COALESCE(is_active, 1) AS is_active FROM suppliers WHERE id = ?').bind(id).first();
  await logAudit(c, 'SUPPLIER_UPDATE', 'suppliers', id, existing, updated);
  return c.json(updated);
});

purchasing.delete('/suppliers/:id', requirePermissions(['manage_purchasing']), async (c) => {
  const id = c.req.param('id');
  const activePO = await c.env.DB.prepare('SELECT id FROM purchase_orders WHERE supplier_id = ? LIMIT 1').bind(id).first();
  if (activePO) return c.json({ message: 'Cannot delete: supplier is linked to purchase orders.' }, 400);
  await c.env.DB.prepare('DELETE FROM suppliers WHERE id = ?').bind(id).run();
  await logAudit(c, 'SUPPLIER_DELETE', 'suppliers', id, null, null);
  return c.json({ success: true });
});

// ──────────────────────────────────────────────────────────────────────
// PURCHASE ORDERS — LIST & GET
// ──────────────────────────────────────────────────────────────────────
const PO_LIST: ListOptions = {
  sortable: {
    date: 'created_at', number: 'po_number', supplier: 'supplier_name', status: 'status', total: 'net_calc',
    balance: 'balance_calc', payment: 'payment_status_calc', expected: 'expected_date',
  },
  defaultSort: 'date', defaultDir: 'desc', tieBreaker: 'id',
};

/** Net total, payment status, balance and remaining quantities of a PO row. */
function enrichPurchaseOrder(row: any) {
  const orderTotal = Number(row.order_total || row.total_amount || 0);
  const invoiceTotal = row.invoice_total != null ? Number(row.invoice_total) : orderTotal;
  const invoiceDiscount = Number(row.invoice_discount || 0);
  const computedNet = invoiceTotal > invoiceDiscount ? (invoiceTotal - invoiceDiscount) : orderTotal;
  const netTotal = orderTotal > 0 ? orderTotal : computedNet;
  const paid = Number(row.amount_paid || 0);
  const balance = Math.max(0, netTotal - paid);
  let payment_status = 'UNPAID';
  if (paid >= netTotal && netTotal > 0) payment_status = 'PAID';
  else if (paid > 0) payment_status = 'PARTIALLY_PAID';
  return {
    ...row,
    total_amount: orderTotal,
    net_total: netTotal,
    balance,
    payment_status,
    total_qty_ordered: Number(row.total_qty_ordered || 0),
    total_qty_received: Number(row.total_qty_received || 0),
    total_qty_remaining: Math.max(0, Number(row.total_qty_ordered || 0) - Number(row.total_qty_received || 0)),
  };
}

purchasing.get('/orders', async (c) => {
  const { search, paymentStatus, dateFrom, dateTo, supplierId } = c.req.query();

  let query = `
    SELECT po.*, s.name AS supplier_name,
           COALESCE(NULLIF(po.total_amount, 0), (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS order_total,
           (SELECT COALESCE(SUM(quantity), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS total_qty_ordered,
           (SELECT COALESCE(SUM(quantity_received), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id) AS total_qty_received,
           pi.id AS purchase_invoice_id,
           COALESCE(pi.total_amount, po.total_amount, (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id)) AS invoice_total,
           COALESCE(pi.discount_amount, (SELECT COALESCE(SUM(discount_amount), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS invoice_discount,
           COALESCE((SELECT SUM(pip.amount) FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id), 0) AS amount_paid
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN purchase_invoices pi ON pi.purchase_order_id = po.id
    WHERE 1=1 ${await poScope(c)}
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (po.po_number LIKE ? OR s.name LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }
  if (supplierId) {
    query += ` AND po.supplier_id = ?`;
    params.push(supplierId);
  }
  if (dateFrom) {
    query += ` AND date(po.created_at) >= date(?)`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND date(po.created_at) <= date(?)`;
    params.push(dateTo);
  }

  const listReq = listRequest(c, sortsFor(c, PO_LIST, ['total', 'balance', 'value', 'paid']));
  if (listReq.paged) {
    // Paged: the same query, with the computed totals and statuses in SQL so
    // the server can filter, sort and count on them.
    const q = (k: string) => (c.req.query(k) || '').trim();
    const where: string[] = [];
    const extra: unknown[] = [];
    if (q('q')) {
      const t = likeTerm(q('q'));
      where.push('(po_number ILIKE ? OR supplier_name ILIKE ? OR COALESCE(notes, \'\') ILIKE ?)');
      extra.push(t, t, t);
    }
    if (q('warehouseId')) { where.push('warehouse_id = ?'); extra.push(q('warehouseId')); }
    if (q('paymentStatus')) { where.push('payment_status_calc = ?'); extra.push(q('paymentStatus')); }
    if (q('receiving') === 'pending') where.push('total_qty_received < total_qty_ordered');
    if (q('receiving') === 'complete') where.push('total_qty_ordered > 0 AND total_qty_received >= total_qty_ordered');
    const statusWhere = [...where];
    const statusExtra = [...extra];
    if (q('status')) { statusWhere.push('status = ?'); statusExtra.push(q('status')); }
    const inner = `FROM (
      SELECT y.*, CASE WHEN amount_paid >= net_calc AND net_calc > 0 THEN 'PAID' WHEN amount_paid > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END AS payment_status_calc,
             GREATEST(0, net_calc - amount_paid) AS balance_calc
      FROM (
        SELECT x.*, CASE WHEN COALESCE(order_total, 0) > 0 THEN order_total
                         WHEN COALESCE(invoice_total, 0) > COALESCE(invoice_discount, 0) THEN invoice_total - invoice_discount
                         ELSE COALESCE(order_total, 0) END AS net_calc
        FROM (${query}) x
      ) y
    ) z`;
    const base = `${inner} ${statusWhere.length ? 'WHERE ' + statusWhere.join(' AND ') : ''}`;
    const { rows, total } = await pagedRows(c.env.DB, '*', base, [...params, ...statusExtra], listReq);
    const items = rows.map(enrichPurchaseOrder);
    if (listReq.csv) {
      return csvResponse(c, 'purchase-orders', [
        { label: 'PO', value: (o: any) => o.po_number },
        { label: 'Date', value: (o: any) => (o.created_at instanceof Date ? o.created_at.toISOString() : String(o.created_at)).slice(0, 10) },
        { label: 'Supplier', value: (o: any) => o.supplier_name },
        { label: 'Status', value: (o: any) => o.status },
        { label: 'Ordered', value: (o: any) => o.total_qty_ordered },
        { label: 'Received', value: (o: any) => o.total_qty_received },
        { label: 'Total', value: (o: any) => Number(o.net_total).toFixed(2), perm: PERM.COSTS },
        { label: 'Paid', value: (o: any) => Number(o.amount_paid || 0).toFixed(2), perm: PERM.COSTS },
        { label: 'Balance', value: (o: any) => Number(o.balance).toFixed(2), perm: PERM.COSTS },
        { label: 'Payment', value: (o: any) => o.payment_status },
      ], items);
    }
    const sum = await c.env.DB.prepare(`SELECT COALESCE(SUM(net_calc), 0) AS value, COALESCE(SUM(balance_calc), 0) AS owed ${base}`).bind(...params, ...statusExtra).first() as any;
    const { results: grouped } = await c.env.DB.prepare(`SELECT status, COUNT(*)::int AS n ${inner} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY status`).bind(...params, ...extra).all();
    const counts: Record<string, number> = { ALL: 0 };
    for (const g of (grouped || []) as any[]) { counts[g.status] = Number(g.n); counts.ALL += Number(g.n); }
    return pagedResponse(c, listReq, items, total, { counts, totals: { value: Math.round(Number(sum?.value || 0) * 100) / 100, outstanding: Math.round(Number(sum?.owed || 0) * 100) / 100 } });
  }

  query += ` ORDER BY po.created_at DESC LIMIT 200`;

  const stmt = c.env.DB.prepare(query);
  const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  // Compute net_total, payment_status, balance and remaining items for each row
  const enriched = (results || []).map(enrichPurchaseOrder);

  // Filter by computed payment status if requested
  if (paymentStatus && paymentStatus !== 'ALL') {
    return c.json(enriched.filter((r: any) => r.payment_status === paymentStatus));
  }

  return c.json(enriched);
});

purchasing.get('/orders/:id', async (c) => {
  const id = c.req.param('id');
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name,
      COALESCE(NULLIF(po.total_amount, 0), (SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE purchase_order_id = po.id), 0) AS total_amount
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ? ${await poScope(c)}
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku, p.selling_price AS current_selling_price, p.cost_price AS current_cost_price,
      (SELECT COALESCE(SUM(GREATEST(s.quantity_on_hand, 0)), 0) FROM inventory_stock s WHERE s.product_id = p.id) AS current_on_hand,
      COALESCE(pol.quantity_received, (
        SELECT COALESCE(SUM(grl.quantity_received), 0) 
        FROM goods_receipt_lines grl 
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id 
        WHERE gr.purchase_order_id = pol.purchase_order_id AND grl.product_id = pol.product_id
      ), 0) as quantity_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
    ORDER BY pol.id ASC
  `).bind(id).all();

  const enrichedLines = (lines || []).map((l: any) => {
    const ordered = Number(l.quantity_ordered || l.quantity || 0);
    const received = Number(l.quantity_received || 0);
    return {
      ...l,
      quantity_ordered: ordered,
      quantity_received: received,
      quantity_remaining: Math.max(0, ordered - received),
    };
  });

  // Fetch all Goods Receipts history for this PO
  const { results: receipts } = await c.env.DB.prepare(`
    SELECT gr.id, gr.receipt_number, gr.received_at, gr.status, gr.notes,
           w.name AS warehouse_name, u.full_name AS received_by_name,
           (SELECT COALESCE(SUM(quantity_received), 0) FROM goods_receipt_lines WHERE goods_receipt_id = gr.id) AS total_items_received
    FROM goods_receipts gr
    LEFT JOIN warehouses w ON w.id = gr.warehouse_id
    LEFT JOIN users u ON u.id = gr.received_by
    WHERE gr.purchase_order_id = ?
    ORDER BY gr.received_at DESC
  `).bind(id).all();

  // Ensure invoice exists or auto-backfill for existing PO
  let invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE purchase_order_id = ?'
  ).bind(id).first().catch(() => null);

  if (!invoice) {
    const invId = `pi-${id}`;
    const invNum = `PI-${(po as any).po_number || Date.now()}`;
    const grossTot = enrichedLines.reduce((acc: number, l: any) => acc + (Number(l.quantity_ordered || l.quantity) * Number(l.unit_cost)), 0);
    const disc = enrichedLines.reduce((acc: number, l: any) => acc + Number(l.discount_amount || 0), 0);
    try {
      await c.env.DB.prepare(`
        INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
        VALUES (?, ?, ?, ?, ?, 'UNPAID')
        ON CONFLICT (id) DO NOTHING
      `).bind(invId, invNum, id, grossTot || Number((po as any).total_amount || 0), disc).run();
      invoice = await c.env.DB.prepare('SELECT * FROM purchase_invoices WHERE id = ?').bind(invId).first();
    } catch {
      // Ignore conflict
    }
  }

  // Enrich invoice with payment summary and history
  let invoiceWithPayments = null;
  if (invoice) {
    const piSummary = await getPurchaseInvoicePaymentSummary(
      c.env.DB,
      invoice.id as string,
      Number(invoice.total_amount),
      Number((invoice as any).discount_amount || 0)
    );
    const { results: payments } = await c.env.DB.prepare(`
      SELECT pip.*, u.full_name AS recorded_by_name, COALESCE(ma.name, 'Main Cash') AS money_account_name
      FROM purchase_invoice_payments pip
      LEFT JOIN users u ON u.id = pip.recorded_by
      LEFT JOIN money_accounts ma ON ma.id = pip.money_account_id
      WHERE pip.purchase_invoice_id = ?
      ORDER BY pip.created_at DESC
    `).bind(invoice.id).all();
    invoiceWithPayments = { ...invoice, ...piSummary, payments: payments || [] };
  }

  return c.json({ ...po, lines: enrichedLines, receipts: receipts || [], invoice: invoiceWithPayments });
});

purchasing.get('/orders/:id/print-invoice', async (c) => {
  const id = c.req.param('id');
  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name, s.contact_name, s.phone AS supplier_phone, s.email AS supplier_email, s.address AS supplier_address,
           w.name AS warehouse_name, w.address AS warehouse_address
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN warehouses w ON w.id = po.warehouse_id
    WHERE po.id = ? ${await poScope(c)}
  `).bind(id).first();

  if (!po) return c.json({ message: 'PO not found' }, 404);

  const { results: lines } = await c.env.DB.prepare(`
    SELECT pol.*, pol.quantity AS quantity_ordered, p.name as product_name, p.sku as variant_sku
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(id).all();

  const invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE purchase_order_id = ?'
  ).bind(id).first().catch(() => null);

  let invoiceData = invoice || null;
  if (invoice) {
    const piSummary = await getPurchaseInvoicePaymentSummary(
      c.env.DB,
      invoice.id as string,
      Number(invoice.total_amount),
      Number((invoice as any).discount_amount || 0)
    );
    invoiceData = { ...invoice, ...piSummary };
  }

  return c.json({
    po,
    lines,
    invoice: invoiceData,
    supplier: {
      name: po.supplier_name,
      contactName: po.contact_name,
      phone: po.supplier_phone,
      email: po.supplier_email,
      address: po.supplier_address,
    },
    warehouse: {
      name: po.warehouse_name || 'Central Warehouse',
      address: po.warehouse_address,
    },
  });
});

// ──────────────────────────────────────────────────────────────────────
// CREATE PO — with full input validation
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders', requirePermissions(['manage_purchasing', PERM.COSTS]), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Validate supplier
  if (!body.supplierId) return c.json({ message: 'Supplier is required.' }, 400);
  const supplier = await c.env.DB.prepare('SELECT id FROM suppliers WHERE id = ?').bind(body.supplierId).first();
  if (!supplier) return c.json({ message: 'Supplier does not exist.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one line item is required.' }, 400);
  }

  const seenProducts = new Set<string>();
  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    if (!line.quantity || !Number.isInteger(line.quantity) || line.quantity <= 0) {
      return c.json({ message: `Line ${i + 1}: quantity must be a positive integer.` }, 400);
    }
    if (line.unitCost === undefined || line.unitCost === null || Number(line.unitCost) < 0) {
      return c.json({ message: `Line ${i + 1}: unitCost cannot be negative.` }, 400);
    }
    if (seenProducts.has(line.productId)) {
      return c.json({ message: `Line ${i + 1}: duplicate product. Combine quantities into one line.` }, 400);
    }
    seenProducts.add(line.productId);

    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(line.productId).first();
    if (!product) return c.json({ message: `Line ${i + 1}: product does not exist.` }, 400);
  }

  const id = uuidv4();
  const poNumber = `PO-${Date.now()}`;

  let grossAmount = 0;
  let totalDiscount = 0;
  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    totalDiscount += discountAmount;
    grossAmount += (line.quantity * line.unitCost);
  }
  const totalAmount = grossAmount - totalDiscount;

  // The order belongs to the buyer's branch; company level may name a branch (or none = company-level).
  const loc = await resolveLoc(c);
  let poBranch: string | null = locBranch(loc);
  if (loc.kind === 'ALL' && body.branchId) {
    const b = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(body.branchId).first();
    if (!b) return c.json({ message: 'Branch does not exist.' }, 400);
    poBranch = body.branchId;
  }
  const poWarehouse = loc.kind === 'WAREHOUSE' ? loc.warehouseId : (body.warehouseId || null);

  const stmts = [];
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_orders (id, po_number, supplier_id, warehouse_id, branch_id, status, total_amount, notes, expected_date, created_by)
    VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, ?, ?)
  `).bind(id, poNumber, body.supplierId, poWarehouse, poBranch, totalAmount, body.notes || null, body.expectedDate || null, userId));

  for (const line of body.lines) {
    const discountAmount = Number(line.discountAmount || 0);
    const lineTotal = (line.quantity * line.unitCost) - discountAmount;
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_order_lines (id, purchase_order_id, product_id, quantity, unit_cost, discount_amount, line_total, quantity_received) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).bind(uuidv4(), id, line.productId, line.quantity, line.unitCost, discountAmount, lineTotal));
  }

  // Create corresponding purchase invoice immediately so payments and AP balance can be tracked from inception
  const invoiceId = `pi-${id}`;
  const invoiceNumber = `PI-${poNumber}`;
  stmts.push(c.env.DB.prepare(`
    INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
    VALUES (?, ?, ?, ?, ?, 'UNPAID')
  `).bind(invoiceId, invoiceNumber, id, grossAmount, totalDiscount));

  stmts.push(createAuditLogStmt(c, 'PURCHASE_ORDER_CREATE', 'purchase_orders', id, null, { poNumber, supplierId: body.supplierId, lines: body.lines }));
  await c.env.DB.batch(stmts);
  const { results } = await c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// ──────────────────────────────────────────────────────────────────────
// APPROVE PO — SUBMITTED → RECEIVED
// Creates purchase_invoice with status UNPAID (not PAID) so payments
// can be tracked from this point forward
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/orders/:id/approve', requirePermissions(['manage_purchasing', PERM.COSTS]), async (c) => {
  const id = c.req.param('id');
  const userId = c.get('jwtPayload').sub;

  const po = await c.env.DB.prepare(`
    SELECT po.*, s.name AS supplier_name
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.id = ? ${await poScope(c)}
  `).bind(id).first() as any;

  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'SUBMITTED') {
    return c.json({ message: `Cannot approve: PO status is already '${po.status}'.` }, 400);
  }

  await c.env.DB.prepare(
    "UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).bind(userId, id).run();

  await logAudit(c, 'PURCHASE_ORDER_APPROVE', 'purchase_orders', id, { status: 'SUBMITTED' }, { status: 'APPROVED' });

  const updated = await c.env.DB.prepare(
    'SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?'
  ).bind(id).first();

  return c.json(updated);
});

// ──────────────────────────────────────────────────────────────────────
// GOODS RECEIPT — Partial or full receipt with inventory & GL updates
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/receipts', requirePermissions(['manage_purchasing']), async (c) => {
  const body = await c.req.json();
  const userId = c.get('jwtPayload').sub;

  // Validate PO exists and is in receivable state
  if (!body.purchaseOrderId) return c.json({ message: 'Purchase order ID is required.' }, 400);
  const po = await poOr404(c, body.purchaseOrderId);
  if (!po) return c.json({ message: 'Purchase order not found.' }, 404);
  if (po.status !== 'SUBMITTED' && po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
    return c.json({ message: `Cannot receive goods: PO is '${po.status}'. Must be SUBMITTED, APPROVED, or PARTIALLY_RECEIVED.` }, 400);
  }

  // Resolve warehouse
  let warehouseId = body.warehouseId || po.warehouse_id;
  if (!warehouseId) {
    const firstWH = await c.env.DB.prepare('SELECT id FROM warehouses LIMIT 1').first();
    warehouseId = firstWH?.id;
  }
  if (!warehouseId) return c.json({ message: 'No receiving warehouse specified.' }, 400);

  // Validate lines
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return c.json({ message: 'At least one receipt line is required.' }, 400);
  }

  // Fetch all PO lines with current received counts
  const { results: poLines } = await c.env.DB.prepare(`
    SELECT pol.*, p.name AS product_name, p.tracking,
      COALESCE(pol.quantity_received, (
        SELECT COALESCE(SUM(grl.quantity_received), 0)
        FROM goods_receipt_lines grl
        JOIN goods_receipts gr ON gr.id = grl.goods_receipt_id
        WHERE gr.purchase_order_id = pol.purchase_order_id AND grl.product_id = pol.product_id
      ), 0) AS current_received
    FROM purchase_order_lines pol
    JOIN products p ON p.id = pol.product_id
    WHERE pol.purchase_order_id = ?
  `).bind(body.purchaseOrderId).all();

  const poLineMap = new Map<string, any>();
  for (const pol of (poLines || []) as any[]) {
    poLineMap.set(pol.product_id, pol);
  }

  let totalReceivedThisBatch = 0;
  let batchValue = 0;

  for (let i = 0; i < body.lines.length; i++) {
    const line = body.lines[i];
    if (!line.productId) return c.json({ message: `Line ${i + 1}: productId is required.` }, 400);
    const qty = Number(line.quantityReceived);
    if (!Number.isInteger(qty) || qty <= 0) {
      return c.json({ message: `Line ${i + 1}: quantityReceived must be a positive integer.` }, 400);
    }

    const pol = poLineMap.get(line.productId);
    if (!pol) {
      return c.json({ message: `Line ${i + 1}: product is not on this purchase order.` }, 400);
    }

    const currentReceived = Number(pol.current_received || 0);
    const ordered = Number(pol.quantity);
    const remaining = ordered - currentReceived;

    if (qty > remaining) {
      return c.json({
        message: `Cannot receive ${qty} units of ${pol.product_name || 'product'}. Only ${remaining} units remaining to receive (Ordered: ${ordered}, Already received: ${currentReceived}).`
      }, 400);
    }

    totalReceivedThisBatch += qty;
    const lineUnitCost = Number(pol.unit_cost);
    const lineDiscount = Number(pol.discount_amount || 0);
    const netUnitCost = ordered > 0 ? ((ordered * lineUnitCost) - lineDiscount) / ordered : lineUnitCost;
    batchValue += (qty * netUnitCost);
  }

  await checkLotCodes(c.env.DB, body.lines.map((l: any) => ({ productId: l.productId, quantity: Number(l.quantityReceived), code: l.batchCode || null, serials: Array.isArray(l.serials) ? l.serials : null })));

  // Cost before this receipt, for the Owner's alert. (Prices are changed only in Products.)
  const productInfo = new Map<string, any>();
  // Pre-flight: existing stock rows
  const stockLookups = new Map<string, string | null>();
  const receiptId = uuidv4();
  const receiptNumber = `GR-${Date.now()}`;
  // Product details, stock rows and the journal entry don't depend on each other: prepare them
  // all at once (each read is a round trip; one after another they made receiving slow).
  const [, , preparedJournal] = await Promise.all([
    Promise.all(body.lines.map(async (line: any) => {
      const info = await c.env.DB.prepare(`
      SELECT p.id, p.name, COALESCE(p.cost_price, 0) AS cost, COALESCE(p.selling_price, 0) AS price,
             (SELECT COALESCE(SUM(GREATEST(s.quantity_on_hand, 0)), 0) FROM inventory_stock s WHERE s.product_id = p.id) AS on_hand,
             EXISTS (SELECT 1 FROM product_price_levels l WHERE l.product_id = p.id) AS has_levels,
             (SELECT selling_price FROM product_price_levels l WHERE l.product_id = p.id ORDER BY level_no DESC LIMIT 1) AS newest_price
      FROM products p WHERE p.id = ?`).bind(line.productId).first() as any;
      productInfo.set(line.productId, info);
    })),
    Promise.all(body.lines.map(async (line: any) => {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM inventory_stock
        WHERE product_id = ? AND owner_type = 'WAREHOUSE' AND warehouse_id = ? AND branch_id IS NULL
      `).bind(line.productId, warehouseId).first();
      stockLookups.set(line.productId, (existing?.id as string) || null);
    })),
    // The receipt, physical stock and inventory accounting must commit together.
    // Receipt ID (not PO ID) is the idempotency key because a PO can be received
    // in multiple batches.
    batchValue > 0 ? prepareJournalEntryPosting(c, {
      description: `Purchase Goods Received #${receiptNumber}`,
      referenceType: 'PURCHASE',
      referenceId: receiptId,
      branchId: po.branch_id || null,
      userId,
      lines: [
        { accountCode: '1030', debitAmount: batchValue, creditAmount: 0 },
        { accountCode: '2010', debitAmount: 0, creditAmount: batchValue },
      ],
    }) : Promise.resolve(null),
  ]);

  // Build atomic batch
  const stmts: any[] = [];

  // 1. Goods Receipt header
  stmts.push(c.env.DB.prepare(`
    INSERT INTO goods_receipts (id, receipt_number, purchase_order_id, warehouse_id, status, received_by, notes)
    VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?)
  `).bind(receiptId, receiptNumber, body.purchaseOrderId, warehouseId, userId, body.notes || null));

  // 2. Receipt lines, inventory transactions, inventory stock, and PO line quantity_received
  for (const line of body.lines) {
    const pol = poLineMap.get(line.productId);
    const qty = Number(line.quantityReceived);
    const lineUnitCost = Number(pol.unit_cost);
    const lineDiscount = Number(pol.discount_amount || 0);
    const netUnitCost = Number(pol.quantity) > 0 ? ((Number(pol.quantity) * lineUnitCost) - lineDiscount) / Number(pol.quantity) : lineUnitCost;
    const lineTotal = qty * netUnitCost;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO goods_receipt_lines (id, goods_receipt_id, product_id, warehouse_location_id, quantity_received, unit_cost, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(uuidv4(), receiptId, line.productId, line.warehouseLocationId || null, qty, lineUnitCost, lineTotal));

    stmts.push(c.env.DB.prepare(`
      INSERT INTO inventory_transactions (id, product_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_location_id, reference_type, reference_id, created_by)
      VALUES (?, ?, 'PURCHASE_RECEIPT', ?, 'WAREHOUSE', ?, ?, 'GOODS_RECEIPT', ?, ?)
    `).bind(uuidv4(), line.productId, qty, warehouseId, line.warehouseLocationId || null, receiptId, userId));

    // Serial numbers / batches of tracked products (typed ones, or numbered automatically).
    stmts.push(lotsInStatement(c.env.DB, { productId: line.productId, quantity: qty, code: line.batchCode || null, serials: Array.isArray(line.serials) ? line.serials : null, warehouseId, sourceType: 'GOODS_RECEIPT', sourceId: receiptId, tag: receiptNumber.slice(-6) }));
    // Running-average cost: computed from stock on hand BEFORE these units are added.
    stmts.push(...costInStatements(c.env.DB, { productId: line.productId, quantity: qty, unitCost: netUnitCost, source: 'PURCHASE_RECEIPT', referenceId: receiptId, userId }));
    // A product sold by price levels: these goods become a new level (sold after the older ones),
    // at their cost and the newest level's selling price; the Owner can change that price.
    if (productInfo.get(line.productId)?.has_levels) {
      stmts.push(...newLevelStatements(c.env.DB, { productId: line.productId, costPrice: Math.round(netUnitCost * 10000) / 10000, sellingPrice: Number(productInfo.get(line.productId)?.newest_price ?? productInfo.get(line.productId)?.price ?? 0), quantity: qty, source: 'PURCHASE_RECEIPT', refId: receiptId, note: `Received ${receiptNumber}`, userId }));
    }
    // Tell the Owner when the cost went up, with the price that keeps the old margin.
    {
      const info = productInfo.get(line.productId);
      const onHand = Number(info?.on_hand || 0);
      const oldCost = Number(info?.cost || 0);
      const newCost = onHand > 0 ? (onHand * oldCost + qty * netUnitCost) / (onHand + qty) : netUnitCost;
      if (info && newCost > oldCost + 0.005) {
        const price = Number(info.price || 0);
        const oldMargin = price > 0 ? (price - oldCost) / price : 0;
        const newMargin = price > 0 ? (price - newCost) / price : 0;
        const suggested = oldMargin > 0 && oldMargin < 1 ? newCost / (1 - oldMargin) : null;
        const pct = (m: number) => `${(m * 100).toFixed(1)}%`;
        const msg = `${info.name}: cost ${oldCost.toFixed(2)} → ${newCost.toFixed(2)} after receipt ${receiptNumber}. `
          + (price > 0 ? `At the selling price ${price.toFixed(2)} the margin falls from ${pct(oldMargin)} to ${pct(newMargin)}.` : 'It has no selling price yet.')
          + (suggested ? ` To keep ${pct(oldMargin)}, the price would be ${suggested.toFixed(2)}.` : '')
          + ' Change it in Products → Edit (Owner only).';
        stmts.push(c.env.DB.prepare(`
          INSERT INTO notifications (id, user_id, title, message, type)
          SELECT gen_random_uuid()::text, u.id, ?, ?, 'PRICE'
          FROM users u WHERE u.is_active = 1 AND u.branch_id IS NULL
            AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.code = 'admin')
        `).bind(`Cost went up: ${info.name}`, msg));
      }
      if (info) { info.cost = newCost; info.on_hand = onHand + qty; }
    }

    const existingStockId = stockLookups.get(line.productId);
    if (existingStockId) {
      stmts.push(c.env.DB.prepare(
        'UPDATE inventory_stock SET quantity_on_hand = quantity_on_hand + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(qty, existingStockId));
    } else {
      stmts.push(c.env.DB.prepare(`
        INSERT INTO inventory_stock (id, product_id, owner_type, warehouse_id, quantity_on_hand)
        VALUES (?, ?, 'WAREHOUSE', ?, ?)
      `).bind(uuidv4(), line.productId, warehouseId, qty));
    }

    // Guarded: a double-submitted receipt cannot push received past ordered.
    stmts.push(c.env.DB.prepare(`
      UPDATE purchase_order_lines
      SET quantity_received = COALESCE(quantity_received, 0) + ?
      WHERE purchase_order_id = ? AND product_id = ? AND COALESCE(quantity_received, 0) + ? <= quantity
    `).bind(qty, body.purchaseOrderId, line.productId, qty)
      .mustAffect('These goods were just received by another request. Please refresh the purchase order.'));
  }

  // 3. Determine if all items across entire PO are fully received
  let allFullyReceived = true;
  for (const pol of (poLines || []) as any[]) {
    const previouslyReceived = Number(pol.current_received || 0);
    const receivingNow = body.lines.find((l: any) => l.productId === pol.product_id)?.quantityReceived || 0;
    const totalWillBe = previouslyReceived + Number(receivingNow);
    if (totalWillBe < Number(pol.quantity)) {
      allFullyReceived = false;
      break;
    }
  }

  const newStatus = allFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  stmts.push(c.env.DB.prepare(`
    UPDATE purchase_orders
    SET status = ?,
        approved_by = COALESCE(approved_by, ?),
        approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP),
        warehouse_id = COALESCE(warehouse_id, ?)
    WHERE id = ?
  `).bind(newStatus, userId, warehouseId, body.purchaseOrderId));

  stmts.push(createAuditLogStmt(c, 'GOODS_RECEIPT_CREATE', 'goods_receipts', receiptId, null, {
    receiptNumber,
    purchaseOrderId: body.purchaseOrderId,
    warehouseId,
    lines: body.lines,
    newStatus,
    batchValue
  }));

  if (preparedJournal) stmts.push(...preparedJournal.statements);

  await c.env.DB.batch(stmts);

  const { results: receiptRows } = await c.env.DB.prepare('SELECT * FROM goods_receipts WHERE id = ?').bind(receiptId).all();
  return c.json({ success: true, receipt: receiptRows?.[0], newStatus }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// RECORD PURCHASE INVOICE PAYMENT (supplier deposit / installment)
// ──────────────────────────────────────────────────────────────────────
purchasing.post('/invoices/:id/payments', requirePermissions(['manage_purchasing', PERM.COSTS]), async (c) => {
  const purchaseInvoiceId = c.req.param('id');
  if (!purchaseInvoiceId) return c.json({ message: 'Purchase invoice id is required.' }, 400);
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.json();

  const amount = Number(body.amount);
  if (!amount || amount <= 0) {
    return c.json({ message: 'Payment amount must be a positive number.' }, 400);
  }

  let paymentMethod = body.paymentMethod || 'CASH';
  const validMethods = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'WIRE', 'MOBILE_MONEY'];
  if (!validMethods.includes(paymentMethod)) {
    return c.json({ message: `Invalid payment method. Must be one of: ${validMethods.join(', ')}.` }, 400);
  }

  const paymentDate = body.paymentDate || new Date().toISOString().split('T')[0];

  // Fetch purchase invoice (support both purchase_invoice_id and purchase_order_id)
  let invoice = await c.env.DB.prepare(
    'SELECT * FROM purchase_invoices WHERE id = ? OR purchase_order_id = ?'
  ).bind(purchaseInvoiceId, purchaseInvoiceId).first() as any;

  if (invoice && !(await poOr404(c, invoice.purchase_order_id))) invoice = null;
  if (!invoice) {
    const po = await poOr404(c, purchaseInvoiceId);
    if (po) {
      const invId = `pi-${po.id}`;
      const invNum = `PI-${po.po_number || Date.now()}`;
      await c.env.DB.prepare(`
        INSERT INTO purchase_invoices (id, invoice_number, purchase_order_id, total_amount, discount_amount, status)
        VALUES (?, ?, ?, ?, 0, 'UNPAID')
      `).bind(invId, invNum, po.id, Number(po.total_amount || 0)).run();
      invoice = await c.env.DB.prepare('SELECT * FROM purchase_invoices WHERE id = ?').bind(invId).first() as any;
    }
  }

  if (!invoice) return c.json({ message: 'Purchase invoice not found.' }, 404);
  const realInvoiceId = invoice.id as string;

  // Compute current balance
  const summary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, realInvoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  if (summary.balance <= 0) {
    return c.json({ message: 'This invoice is already fully paid.' }, 400);
  }
  if (amount > summary.balance + 0.001) {
    return c.json({
      message: `Payment of $${amount.toFixed(2)} exceeds remaining balance of $${summary.balance.toFixed(2)}.`,
      balance: summary.balance,
    }, 400);
  }

  const paymentId = uuidv4();
  // "Paid from": the Bank & Cash account the money leaves. The Owner must choose it (never assumed).
  requireChosenAccount(body.moneyAccountId ?? body.money_account_id, 'this supplier');
  const cash = await resolveCashAccount(c.env.DB, body.moneyAccountId ?? body.money_account_id, invoice.branch_id || null);
  paymentMethod = methodFor(cash, paymentMethod);
  const isFullyPaid = Math.abs(amount - summary.balance) < 0.01;

  const stmts: any[] = [
    // Serialize payments on this invoice, then re-check the balance after the
    // lock so a double-submit cannot overpay the supplier.
    c.env.DB.prepare('SELECT id FROM purchase_invoices WHERE id = ? FOR UPDATE').bind(realInvoiceId),
    c.env.DB.prepare(`
      SELECT 1 FROM purchase_invoices pi
      WHERE pi.id = ? AND (pi.total_amount - COALESCE(pi.discount_amount, 0))
        - (SELECT COALESCE(SUM(amount), 0) FROM purchase_invoice_payments WHERE purchase_invoice_id = pi.id) >= ? - 0.001
    `).bind(realInvoiceId, amount).mustAffect('Payment exceeds the remaining balance (another payment was just recorded). Please refresh.'),
    c.env.DB.prepare(`
      INSERT INTO purchase_invoice_payments (id, purchase_invoice_id, amount, payment_method, payment_date, notes, recorded_by, money_account_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(paymentId, realInvoiceId, amount, paymentMethod, paymentDate, body.notes || null, userId, cash.id),
  ];

  // Update invoice payment status (PAID or PARTIALLY_PAID)
  const newStatus = isFullyPaid ? 'PAID' : 'PARTIALLY_PAID';
  stmts.push(c.env.DB.prepare(
    "UPDATE purchase_invoices SET status = ? WHERE id = ?"
  ).bind(newStatus, realInvoiceId));

  stmts.push(createAuditLogStmt(c, 'PURCHASE_INVOICE_PAYMENT', 'purchase_invoices', realInvoiceId, null, {
    amount, paymentMethod, paymentDate, isFullyPaid, paidFrom: cash.name,
  }));

  const paymentJournal = await prepareJournalEntryPosting(c, {
    description: `Payment to Supplier for Invoice #${invoice.invoice_number || invoice.id}`,
    referenceType: 'PURCHASE',
    referenceId: paymentId,
    entryDate: paymentDate,
    branchId: invoice.branch_id || null,
    userId,
    lines: [
      { accountCode: '2010', debitAmount: amount, creditAmount: 0 },
      { accountCode: cash.code, debitAmount: 0, creditAmount: amount },
    ],
  });
  stmts.push(...paymentJournal.statements);

  await c.env.DB.batch(stmts);

  // Return updated summary
  const newSummary = await getPurchaseInvoicePaymentSummary(
    c.env.DB, realInvoiceId,
    Number(invoice.total_amount),
    Number(invoice.discount_amount || 0)
  );

  return c.json({ success: true, payment_id: paymentId, invoice_summary: newSummary }, 201);
});

// ──────────────────────────────────────────────────────────────────────
// GET PURCHASE INVOICE PAYMENT HISTORY
// NEW ENDPOINT — GET /purchasing/invoices/:id/payments
// ──────────────────────────────────────────────────────────────────────
purchasing.get('/invoices/:id/payments', async (c) => {
  const purchaseInvoiceId = c.req.param('id');

  const invoice = await c.env.DB.prepare(
    `SELECT pi.id, pi.total_amount, pi.discount_amount FROM purchase_invoices pi
     JOIN purchase_orders po ON po.id = pi.purchase_order_id WHERE pi.id = ? ${await poScope(c)}`
  ).bind(purchaseInvoiceId).first();
  if (!invoice) return c.json({ message: 'Purchase invoice not found.' }, 404);

  const { results: payments } = await c.env.DB.prepare(`
    SELECT pip.*, u.full_name AS recorded_by_name, COALESCE(ma.name, 'Main Cash') AS money_account_name
    FROM purchase_invoice_payments pip
    LEFT JOIN users u ON u.id = pip.recorded_by
    LEFT JOIN money_accounts ma ON ma.id = pip.money_account_id
    WHERE pip.purchase_invoice_id = ?
    ORDER BY pip.created_at ASC
  `).bind(purchaseInvoiceId).all();

  const totalAmount = Number(invoice.total_amount);
  const discountAmount = Number((invoice as any).discount_amount || 0);
  const netTotal = Math.max(0, totalAmount - discountAmount);

  let runningBalance = netTotal;
  const paymentsWithBalance = (payments || []).map((p: any) => {
    runningBalance -= Number(p.amount);
    return { ...p, running_balance: Math.max(0, runningBalance) };
  });

  const summary = await getPurchaseInvoicePaymentSummary(c.env.DB, purchaseInvoiceId, totalAmount, discountAmount);

  return c.json({
    payments: paymentsWithBalance.reverse(), // newest first
    summary,
  });
});

// ──────────────────────────────────────────────────────────────────────
// PURCHASING FINANCIAL SUMMARY — for dashboard
// NEW ENDPOINT — GET /purchasing/summary
// ──────────────────────────────────────────────────────────────────────
// Accounts payable ageing: what we owe suppliers, by how long it is overdue (as of a date).
// Due date = invoice date + the supplier's payment terms (30 days unless set).
// ?supplierId=&asOf=YYYY-MM-DD&branch_id=   Needs cost access (supplier money).
purchasing.get('/payables-ageing', requirePermissions([PERM.COSTS]), async (c) => {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('asOf') || '') ? c.req.query('asOf')! : new Date().toISOString().slice(0, 10);
  const supplierId = c.req.query('supplierId') || '';
  const { results } = await c.env.DB.prepare(`
    SELECT pi.id, pi.invoice_number, pi.issued_at, po.po_number, po.id AS po_id, s.id AS supplier_id, s.name AS supplier_name,
           COALESCE(s.payment_terms_days, 30) AS terms, b.name AS branch_name,
           (pi.total_amount - COALESCE(pi.discount_amount, 0)) AS total,
           COALESCE((SELECT SUM(pip.amount) FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id AND pip.payment_date::date <= ?::date), 0) AS paid
    FROM purchase_invoices pi
    JOIN purchase_orders po ON po.id = pi.purchase_order_id
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN branches b ON b.id = po.branch_id
    WHERE pi.status <> 'CANCELLED' AND po.status <> 'CANCELLED' AND pi.issued_at::date <= ?::date
      ${supplierId ? 'AND s.id = ?' : ''} ${await poScope(c)}
    ORDER BY pi.issued_at
  `).bind(...(supplierId ? [asOf, asOf, supplierId] : [asOf, asOf])).all();
  const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
  const bucketOf = (overdue: number) => overdue <= 0 ? 'current' : overdue <= 30 ? 'd1_30' : overdue <= 60 ? 'd31_60' : overdue <= 90 ? 'd61_90' : 'd90_plus';
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const bySupplier = new Map<string, any>();
  const invoices: any[] = [];
  const end = new Date(`${asOf}T00:00:00Z`).getTime();
  for (const r of (results || []) as any[]) {
    const balance = r2(Number(r.total) - Number(r.paid));
    if (balance <= 0.005) continue;
    const issued = new Date(r.issued_at); const due = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), issued.getUTCDate() + Number(r.terms)));
    const overdue = Math.floor((end - due.getTime()) / 86_400_000);
    const bucket = bucketOf(overdue);
    invoices.push({ id: r.id, po_id: r.po_id, invoice_number: r.invoice_number, po_number: r.po_number, supplier_id: r.supplier_id, supplier_name: r.supplier_name, branch_name: r.branch_name,
      issued_at: r.issued_at, due_date: due.toISOString().slice(0, 10), days_overdue: Math.max(0, overdue), total: r2(Number(r.total)), paid: r2(Number(r.paid)), balance, bucket });
    const g = bySupplier.get(r.supplier_id) || { supplier_id: r.supplier_id, supplier_name: r.supplier_name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
    g[bucket] = r2(g[bucket] + balance); g.total = r2(g.total + balance);
    bySupplier.set(r.supplier_id, g);
  }
  const suppliers = [...bySupplier.values()].sort((a, b) => b.total - a.total);
  const totals: any = { total: 0 }; for (const k of BUCKETS) totals[k] = 0;
  for (const g of suppliers) { for (const k of BUCKETS) totals[k] = r2(totals[k] + g[k]); totals.total = r2(totals.total + g.total); }
  return c.json({ asOf, suppliers, invoices, totals });
});

purchasing.get('/summary', async (c) => {
  const { results: invoices } = await c.env.DB.prepare(`
    SELECT pi.id, pi.total_amount, COALESCE(pi.discount_amount, 0) AS discount_amount, pi.status,
           COALESCE((SELECT SUM(pip.amount) FROM purchase_invoice_payments pip WHERE pip.purchase_invoice_id = pi.id), 0) AS amount_paid,
           po.status AS po_status
    FROM purchase_invoices pi
    JOIN purchase_orders po ON po.id = pi.purchase_order_id
    WHERE 1=1 ${await poScope(c)}
  `).all();

  let totalOutstandingBalance = 0;
  let countUnpaid = 0;
  let countPartiallyPaid = 0;
  let depositsTotal = 0;
  let awaitingPayment = 0;

  for (const inv of (invoices || []) as any[]) {
    const netTotal = Math.max(0, Number(inv.total_amount) - Number(inv.discount_amount));
    const paid = Number(inv.amount_paid);
    const balance = Math.max(0, netTotal - paid);
    if (balance <= 0) continue;
    totalOutstandingBalance += balance;
    if (paid === 0) {
      countUnpaid++;
      awaitingPayment += balance;
    } else {
      countPartiallyPaid++;
      depositsTotal += paid;
    }
  }

  return c.json({
    total_outstanding_balance: totalOutstandingBalance,
    count_unpaid: countUnpaid,
    count_partially_paid: countPartiallyPaid,
    deposits_total: depositsTotal,
    awaiting_payment: awaitingPayment,
  });
});

export default purchasing;
