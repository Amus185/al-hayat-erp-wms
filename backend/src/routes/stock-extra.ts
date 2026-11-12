// Roadmap wave 3 (inventory & warehouse): product variants (19), serial numbers / batches with
// traceability (20) and profit by location from the ledger (21).
import { uuidv4 } from '../db';
import { requireAdmin, requirePermissions } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { canSeeCosts } from '../services/privacy';
import { resolveBranchScope, branchSql, ScopeError, hasAllBranchAccess } from '../services/branch-scope';
import { lotsInStatement, checkLotCodes } from '../services/lots';

const r2 = (n: number) => Math.round(n * 100) / 100;
const text = (v: unknown, max: number) => { const s = v === undefined || v === null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20);

/** Products router: variants and tracking. */
export function registerProductExtra(app: any) {
  // The variants of a product (or, for a variant, its parent and siblings).
  app.get('/:id/variants', async (c: any) => {
    const me = await c.env.DB.prepare('SELECT id, parent_product_id FROM products WHERE id = ?').bind(c.req.param('id')).first() as any;
    if (!me) return c.json({ message: 'Product not found.' }, 404);
    const parentId = me.parent_product_id || me.id;
    const { results } = await c.env.DB.prepare(`
      SELECT p.id, p.sku, p.name, p.variant_label, p.selling_price, p.cost_price, COALESCE(p.is_active, 1) AS is_active, p.parent_product_id, p.tracking,
             (SELECT COALESCE(SUM(s.quantity_on_hand), 0) FROM inventory_stock s WHERE s.product_id = p.id) AS on_hand
      FROM products p WHERE p.id = ? OR p.parent_product_id = ? ORDER BY (p.parent_product_id IS NOT NULL), p.variant_label NULLS FIRST, p.name`).bind(parentId, parentId).all();
    const rows = ((results || []) as any[]).map((r) => ({ ...r, selling_price: Number(r.selling_price), on_hand: Number(r.on_hand), ...(canSeeCosts(c) ? { cost_price: Number(r.cost_price) } : { cost_price: undefined }) }));
    return c.json({ parent_id: parentId, parent: rows.find((r) => r.id === parentId) || null, variants: rows.filter((r) => r.id !== parentId) });
  });
  // A new variant: its own product (own SKU, stock and price), linked to the main product.
  app.post('/:id/variants', requireAdmin, async (c: any) => {
    const parent = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(c.req.param('id')).first() as any;
    if (!parent) return c.json({ message: 'Product not found.' }, 404);
    if (parent.parent_product_id) return c.json({ message: 'Add variants to the main product, not to a variant.' }, 400);
    if ((parent.product_type || 'STANDARD') !== 'STANDARD') return c.json({ message: 'Bundles cannot have variants.' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const label = text(body.label, 60);
    if (!label) return c.json({ message: 'Describe the variant, e.g. "Red / Large".' }, 400);
    if (await c.env.DB.prepare('SELECT 1 FROM products WHERE parent_product_id = ? AND lower(variant_label) = lower(?)').bind(parent.id, label).first()) return c.json({ message: `"${label}" already exists for this product.` }, 409);
    const sku = text(body.sku, 60) || `${parent.sku}-${slug(label)}`;
    if (await c.env.DB.prepare('SELECT 1 FROM products WHERE lower(sku) = lower(?)').bind(sku).first()) return c.json({ message: `The SKU ${sku} is already used.` }, 409);
    const price = body.sellingPrice === undefined || body.sellingPrice === '' ? Number(parent.selling_price || 0) : Number(body.sellingPrice);
    const cost = canSeeCosts(c) && body.costPrice !== undefined && body.costPrice !== '' ? Number(body.costPrice) : Number(parent.cost_price || 0);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) return c.json({ message: 'Prices cannot be negative.' }, 400);
    if (cost > price) return c.json({ message: 'Cost price cannot be greater than selling price.' }, 400);
    const id = uuidv4();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO products (id, sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level, product_type, parent_product_id, variant_label, tracking)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STANDARD', ?, ?, ?)`).bind(id, sku, `${parent.name} – ${label}`, parent.description ?? null, parent.category_id ?? null, parent.brand_id ?? null, cost, price, parent.reorder_level ?? 0, parent.id, label, parent.tracking || 'NONE'),
      createAuditLogStmt(c, 'PRODUCT_VARIANT_CREATE', 'products', id, null, { parent: parent.name, label, sku, price }),
    ]);
    return c.json({ id, sku, name: `${parent.name} – ${label}`, variant_label: label, selling_price: price }, 201);
  });
  // Serial numbers / batches on or off for a product.
  app.put('/:id/tracking', requireAdmin, async (c: any) => {
    const tracking = String((await c.req.json().catch(() => ({}))).tracking || '').toUpperCase();
    if (!['NONE', 'BATCH', 'SERIAL'].includes(tracking)) return c.json({ message: 'Choose: no tracking, batches, or serial numbers.' }, 400);
    const p = await c.env.DB.prepare('SELECT id, name, tracking, product_type FROM products WHERE id = ?').bind(c.req.param('id')).first() as any;
    if (!p) return c.json({ message: 'Product not found.' }, 404);
    if (tracking !== 'NONE' && p.product_type === 'GROUPED') return c.json({ message: 'Bundles are tracked through their parts.' }, 400);
    if (p.tracking !== 'NONE' && tracking !== p.tracking && await c.env.DB.prepare('SELECT 1 FROM stock_lots WHERE product_id = ? AND quantity_left > 0').bind(p.id).first()) {
      return c.json({ message: `${p.name} still has ${p.tracking === 'SERIAL' ? 'serial numbers' : 'batches'} in stock. Sell them first.` }, 400);
    }
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE products SET tracking = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(tracking, p.id),
      createAuditLogStmt(c, 'PRODUCT_TRACKING_SET', 'products', p.id, { tracking: p.tracking }, { tracking }),
    ]);
    return c.json({ tracking });
  });
}

/** Inventory router: lots and traceability. */
export function registerInventoryExtra(app: any) {
  app.get('/lots', async (c: any) => {
    const productId = text(c.req.query('productId'), 80);
    const open = c.req.query('open') !== '0';
    const { results } = await c.env.DB.prepare(`
      SELECT l.*, p.name AS product_name, p.sku, w.name AS warehouse_name, b.name AS branch_name, gr.receipt_number
      FROM stock_lots l JOIN products p ON p.id = l.product_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id LEFT JOIN branches b ON b.id = l.branch_id
      LEFT JOIN goods_receipts gr ON l.source_type = 'GOODS_RECEIPT' AND gr.id = l.source_id
      WHERE 1=1 ${productId ? 'AND l.product_id = ?' : ''} ${open ? 'AND l.quantity_left > 0' : ''}
      ORDER BY p.name, l.received_at, l.code LIMIT 1000`).bind(...(productId ? [productId] : [])).all();
    return c.json({ lots: results || [] });
  });
  // Stock that was already on hand when tracking was switched on: give it its batch / serial numbers.
  app.post('/lots', requirePermissions(['manage_inventory']), async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const productId = text(body.productId, 80) || '';
    const p = await c.env.DB.prepare(`SELECT p.id, p.name, p.tracking,
        (SELECT COALESCE(SUM(GREATEST(s.quantity_on_hand, 0)), 0) FROM inventory_stock s WHERE s.product_id = p.id) AS on_hand,
        (SELECT COALESCE(SUM(l.quantity_left), 0) FROM stock_lots l WHERE l.product_id = p.id) AS in_lots
      FROM products p WHERE p.id = ?`).bind(productId).first() as any;
    if (!p) return c.json({ message: 'Product not found.' }, 404);
    if (p.tracking === 'NONE') return c.json({ message: `Switch on batches or serial numbers for ${p.name} first.` }, 400);
    const serials = Array.isArray(body.serials) ? body.serials.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    const quantity = p.tracking === 'SERIAL' ? serials.length : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return c.json({ message: p.tracking === 'SERIAL' ? 'Enter the serial numbers, one per line.' : 'Enter the quantity of the batch.' }, 400);
    const untracked = Number(p.on_hand) - Number(p.in_lots);
    if (quantity > untracked) return c.json({ message: `Only ${Math.max(0, untracked)} units of ${p.name} in stock have no ${p.tracking === 'SERIAL' ? 'serial number' : 'batch'} yet.` }, 400);
    const code = p.tracking === 'BATCH' ? text(body.code, 60) : null;
    if (p.tracking === 'BATCH' && !code) return c.json({ message: 'Enter the batch code.' }, 400);
    await checkLotCodes(c.env.DB, [{ productId: p.id, quantity, code, serials }]);
    const ref = uuidv4();
    await c.env.DB.batch([
      lotsInStatement(c.env.DB, { productId: p.id, quantity, code, serials, sourceType: 'EXISTING_STOCK', sourceId: ref, tag: 'OPEN' }),
      createAuditLogStmt(c, 'LOTS_REGISTER', 'products', p.id, null, { quantity, code, serials }),
    ]);
    return c.json({ added: quantity }, 201);
  });
  // Where did this serial number / batch come from, and where did it go?
  app.get('/lots/trace', async (c: any) => {
    const code = text(c.req.query('code'), 80);
    if (!code) return c.json({ message: 'Enter a serial number or batch code.' }, 400);
    const { results: lots } = await c.env.DB.prepare(`
      SELECT l.*, p.name AS product_name, p.sku, w.name AS warehouse_name, gr.receipt_number, po.po_number, s.name AS supplier_name
      FROM stock_lots l JOIN products p ON p.id = l.product_id
      LEFT JOIN warehouses w ON w.id = l.warehouse_id
      LEFT JOIN goods_receipts gr ON l.source_type = 'GOODS_RECEIPT' AND gr.id = l.source_id
      LEFT JOIN purchase_orders po ON po.id = gr.purchase_order_id LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE lower(l.code) = lower(?) OR lower(l.code) LIKE lower(?) ORDER BY l.received_at LIMIT 20`).bind(code, `%${code}%`).all();
    const scope = await resolveBranchScope(c);
    const out = [];
    for (const l of (lots || []) as any[]) {
      const { results: moves } = await c.env.DB.prepare(`
        SELECT m.quantity, m.reference_type, m.created_at, i.invoice_number, so.order_number, so.branch_id, b.name AS branch_name, cu.name AS customer_name, cu.phone AS customer_phone
        FROM stock_lot_moves m
        LEFT JOIN invoices i ON m.reference_type IN ('INVOICE', 'INVOICE_CANCEL') AND i.id = m.reference_id
        LEFT JOIN sales_orders so ON so.id = i.sales_order_id LEFT JOIN branches b ON b.id = so.branch_id
        LEFT JOIN customers cu ON cu.id = so.customer_id
        WHERE m.lot_id = ? ORDER BY m.created_at`).bind(l.id).all();
      // A branch sees the customers of its own sales only.
      const shown = ((moves || []) as any[]).map((m) => (scope.kind === 'BRANCH' && m.branch_id && m.branch_id !== scope.branchId) ? { ...m, customer_name: 'Another branch', customer_phone: null } : m);
      out.push({ ...l, moves: shown });
    }
    return c.json({ lots: out });
  });
}

/** Reports router: profit by location, from the ledger (the same numbers as the books). */
export function registerReportExtra(app: any) {
  app.get('/profit-by-location', async (c: any) => {
    const to = isDate(c.req.query('to')) ? c.req.query('to') : new Date().toISOString().slice(0, 10);
    const from = isDate(c.req.query('from')) ? c.req.query('from') : `${to.slice(0, 8)}01`;
    const scope = await resolveBranchScope(c);
    if (scope.kind === 'UNASSIGNED') throw new ScopeError(400, 'Choose a branch or All branches.');
    const [{ results: ledger }, { results: stock }] = await Promise.all([
      c.env.DB.prepare(`
        SELECT jel.branch_id, COALESCE(b.name, 'Company / warehouses') AS location,
          COALESCE(SUM(CASE WHEN coa.account_type = 'REVENUE' THEN jel.credit_amount - jel.debit_amount ELSE 0 END), 0) AS revenue,
          COALESCE(SUM(CASE WHEN coa.account_type = 'COGS' OR (coa.account_type = 'EXPENSE' AND coa.code LIKE '50%') THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS cogs,
          COALESCE(SUM(CASE WHEN coa.account_type = 'EXPENSE' AND NOT (coa.code LIKE '50%') THEN jel.debit_amount - jel.credit_amount ELSE 0 END), 0) AS expenses
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED') AND je.entry_date >= ? AND je.entry_date <= ?
          AND COALESCE(je.reference_type, '') <> 'CLOSING'
        JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type IN ('REVENUE', 'EXPENSE', 'COGS')
        LEFT JOIN branches b ON b.id = jel.branch_id
        WHERE 1=1 ${branchSql(scope, 'jel.branch_id')}
        GROUP BY jel.branch_id, b.name ORDER BY revenue DESC`).bind(from, to).all(),
      c.env.DB.prepare(`
        SELECT s.owner_type, COALESCE(w.name, b.name) AS location, s.branch_id,
               COALESCE(SUM(s.quantity_on_hand), 0) AS units, COALESCE(SUM(s.quantity_on_hand * COALESCE(p.cost_price, 0)), 0) AS inventory_value
        FROM inventory_stock s JOIN products p ON p.id = s.product_id
        LEFT JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.quantity_on_hand > 0 ${scope.kind === 'BRANCH' ? "AND s.owner_type = 'BRANCH' AND s.branch_id = '" + scope.branchId.replace(/'/g, "''") + "'" : ''}
        GROUP BY s.owner_type, COALESCE(w.name, b.name), s.branch_id ORDER BY inventory_value DESC`).all(),
    ]) as any[];
    const rows = ((ledger || []) as any[]).map((r) => {
      const revenue = r2(Number(r.revenue)), cogs = r2(Number(r.cogs)), expenses = r2(Number(r.expenses));
      return { branch_id: r.branch_id, location: r.location, revenue, cogs, gross_profit: r2(revenue - cogs), expenses, net: r2(revenue - cogs - expenses), margin_pct: revenue ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : null };
    });
    const totals = rows.reduce((a, r) => ({ revenue: r2(a.revenue + r.revenue), cogs: r2(a.cogs + r.cogs), gross_profit: r2(a.gross_profit + r.gross_profit), expenses: r2(a.expenses + r.expenses), net: r2(a.net + r.net) }), { revenue: 0, cogs: 0, gross_profit: 0, expenses: 0, net: 0 });
    return c.json({ from, to, rows, totals, stock: ((stock || []) as any[]).map((s) => ({ ...s, kind: s.owner_type === 'WAREHOUSE' ? 'Warehouse' : 'Branch', units: Number(s.units), inventory_value: r2(Number(s.inventory_value)) })), company: hasAllBranchAccess(c.get('jwtPayload')) });
  });
}
