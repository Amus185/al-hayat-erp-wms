// Roadmap wave 2 (sales & customers): selling price levels, quotations, credit control,
// sales performance, sales targets and the daily / monthly / yearly sales report.
// Mounted inside /sales (signed-in users; each route states its permission).
import { uuidv4 } from '../db';
import { requirePermissions, isAdminUser } from '../middleware/auth';
import { createAuditLogStmt } from '../services/audit';
import { resolveBranchScope, branchSql, ScopeError, customerVisibleSql } from '../services/branch-scope';
import { r2, dayOf, COUNTED_SALE, resolveSaleLevel, priceFor, customerCredit, sellerSales } from '../services/sales-rules';

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isPeriod = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const text = (v: unknown, max: number) => { const s = v === undefined || v === null ? '' : String(v).trim(); return s ? s.slice(0, max) : null; };
const owner = (c: any, what: string) => { if (!isAdminUser(c.get('jwtPayload'))) throw new ScopeError(403, `Only the Owner can ${what}.`); };
const today = () => new Date().toISOString().slice(0, 10);
const range = (c: any) => {
  const to = isDate(c.req.query('to')) ? c.req.query('to') : today();
  const from = isDate(c.req.query('from')) ? c.req.query('from') : `${to.slice(0, 8)}01`;
  return { from, to };
};
const monthEnds = (period: string) => { const [y, m] = period.split('-').map(Number); return { from: `${period}-01`, to: `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }; };

export function registerSalesExtra(app: any) {
  const view = requirePermissions(['manage_sales']);

  // ── 9. Selling price levels ──
  app.get('/price-levels', async (c: any) => {
    const { results } = await c.env.DB.prepare(`
      SELECT l.*, (SELECT COUNT(*)::int FROM selling_level_prices p WHERE p.level_id = l.id) AS products_priced,
             (SELECT COUNT(*)::int FROM customers cu WHERE cu.price_level_id = l.id) AS customers
      FROM selling_price_levels l ORDER BY l.sort_order, l.name`).all();
    return c.json({ levels: results || [] });
  });
  app.post('/price-levels', async (c: any) => {
    owner(c, 'add a price level');
    const name = text((await c.req.json().catch(() => ({}))).name, 40);
    if (!name) return c.json({ message: 'Give the price level a name.' }, 400);
    if (await c.env.DB.prepare('SELECT 1 FROM selling_price_levels WHERE lower(name) = lower(?)').bind(name).first()) return c.json({ message: `A price level named "${name}" already exists.` }, 409);
    const id = uuidv4();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO selling_price_levels (id, name, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM selling_price_levels))').bind(id, name),
      createAuditLogStmt(c, 'PRICE_LEVEL_CREATE', 'selling_price_levels', id, null, { name }),
    ]);
    return c.json({ id, name }, 201);
  });
  app.patch('/price-levels/:id', async (c: any) => {
    owner(c, 'change a price level');
    const id = c.req.param('id'); const body = await c.req.json().catch(() => ({}));
    const old = await c.env.DB.prepare('SELECT * FROM selling_price_levels WHERE id = ?').bind(id).first() as any;
    if (!old) return c.json({ message: 'Price level not found.' }, 404);
    const sets: string[] = []; const vals: unknown[] = [];
    if ('name' in body) { const n = text(body.name, 40); if (!n) return c.json({ message: 'Give the price level a name.' }, 400); sets.push('name = ?'); vals.push(n); }
    if ('is_active' in body) {
      if (Number(old.is_default) === 1 && !body.is_active) return c.json({ message: 'The regular price level is always in use.' }, 400);
      sets.push('is_active = ?'); vals.push(body.is_active ? 1 : 0);
    }
    if (!sets.length) return c.json({ message: 'Nothing to change.' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE selling_price_levels SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id),
      createAuditLogStmt(c, 'PRICE_LEVEL_UPDATE', 'selling_price_levels', id, old, body),
    ]);
    return c.json({ ok: true });
  });
  // Prices of one level (for the sale screen: what this customer pays).
  app.get('/price-levels/:id/prices', async (c: any) => {
    const { results } = await c.env.DB.prepare('SELECT product_id, price FROM selling_level_prices WHERE level_id = ?').bind(c.req.param('id')).all();
    return c.json({ prices: Object.fromEntries(((results || []) as any[]).map((r) => [r.product_id, Number(r.price)])) });
  });
  // The price of one product at each level (Products → edit).
  app.get('/products/:productId/level-prices', async (c: any) => {
    const { results } = await c.env.DB.prepare(`
      SELECT l.id AS level_id, l.name, l.is_default, p.price
      FROM selling_price_levels l LEFT JOIN selling_level_prices p ON p.level_id = l.id AND p.product_id = ?
      WHERE l.is_active = 1 ORDER BY l.sort_order, l.name`).bind(c.req.param('productId')).all();
    return c.json({ levels: ((results || []) as any[]).map((r) => ({ ...r, price: r.price === null ? null : Number(r.price) })) });
  });
  app.put('/products/:productId/level-prices', async (c: any) => {
    owner(c, 'change prices');
    const productId = c.req.param('productId');
    const product = await c.env.DB.prepare('SELECT id, name, selling_price FROM products WHERE id = ?').bind(productId).first() as any;
    if (!product) return c.json({ message: 'Product not found.' }, 404);
    const rows = Array.isArray((await c.req.json().catch(() => ({}))).prices) ? (await c.req.json()).prices : [];
    const { results: levels } = await c.env.DB.prepare('SELECT id, name, is_default FROM selling_price_levels').all();
    const byId = new Map<string, any>(((levels || []) as any[]).map((l) => [l.id, l]));
    const stmts: any[] = []; const userId = c.get('jwtPayload').sub; const changed: any[] = [];
    for (const r of rows) {
      const level = byId.get(String(r.levelId || ''));
      if (!level) return c.json({ message: 'That price level does not exist.' }, 400);
      if (Number(level.is_default) === 1) continue; // Retail is the product's own price
      if (r.price === null || r.price === '' || r.price === undefined) {
        stmts.push(c.env.DB.prepare('DELETE FROM selling_level_prices WHERE level_id = ? AND product_id = ?').bind(level.id, productId));
        changed.push({ level: level.name, price: null });
        continue;
      }
      const price = Math.round(Number(r.price) * 100) / 100;
      if (!Number.isFinite(price) || price <= 0) return c.json({ message: `${level.name}: the price must be more than 0 (leave it empty to use the regular price).` }, 400);
      stmts.push(c.env.DB.prepare(`INSERT INTO selling_level_prices (level_id, product_id, price, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT (level_id, product_id) DO UPDATE SET price = EXCLUDED.price, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`).bind(level.id, productId, price, userId));
      changed.push({ level: level.name, price });
    }
    if (stmts.length) await c.env.DB.batch([...stmts, createAuditLogStmt(c, 'LEVEL_PRICE_SET', 'products', productId, null, { product: product.name, prices: changed })]);
    return c.json({ ok: true, changed: changed.length });
  });

  // ── 13. Credit control ──
  const customerInScope = async (c: any, id: string) => {
    const scope = await resolveBranchScope(c);
    if (scope.kind !== 'BRANCH') return true;
    return Boolean(await c.env.DB.prepare(`SELECT 1 FROM customers cu WHERE cu.id = ? AND ${customerVisibleSql(scope.branchId)}`).bind(id).first());
  };
  app.get('/customers/:id/credit', view, async (c: any) => {
    if (!(await customerInScope(c, c.req.param('id')))) return c.json({ message: 'Customer not found.' }, 404);
    const cr = await customerCredit(c.env.DB, c.req.param('id'));
    if (!cr) return c.json({ message: 'Customer not found.' }, 404);
    return c.json(cr);
  });
  app.put('/customers/:id/credit', async (c: any) => {
    owner(c, 'set credit limits and price levels');
    const id = c.req.param('id'); const body = await c.req.json().catch(() => ({}));
    const old = await c.env.DB.prepare('SELECT id, name, credit_limit, credit_days, price_level_id FROM customers WHERE id = ?').bind(id).first() as any;
    if (!old) return c.json({ message: 'Customer not found.' }, 404);
    const sets: string[] = []; const vals: unknown[] = [];
    if ('creditLimit' in body) {
      const v = Number(body.creditLimit || 0);
      if (!Number.isFinite(v) || v < 0) return c.json({ message: 'The credit limit must be 0 (no limit) or more.' }, 400);
      sets.push('credit_limit = ?'); vals.push(r2(v));
    }
    if ('creditDays' in body) {
      const v = Number(body.creditDays);
      if (!Number.isInteger(v) || v < 1 || v > 365) return c.json({ message: 'Days to pay must be between 1 and 365.' }, 400);
      sets.push('credit_days = ?'); vals.push(v);
    }
    if ('priceLevelId' in body) {
      const lv = body.priceLevelId ? String(body.priceLevelId) : null;
      if (lv && !(await c.env.DB.prepare('SELECT 1 FROM selling_price_levels WHERE id = ? AND is_active = 1').bind(lv).first())) return c.json({ message: 'That price level does not exist.' }, 400);
      sets.push('price_level_id = ?'); vals.push(lv);
    }
    if (!sets.length) return c.json({ message: 'Nothing to change.' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE customers SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...vals, id),
      createAuditLogStmt(c, 'CUSTOMER_CREDIT_SET', 'customers', id, old, body),
    ]);
    return c.json(await customerCredit(c.env.DB, id));
  });
  // Customers over their limit or with overdue invoices (for managers).
  app.get('/credit-watch', view, async (c: any) => {
    const scope = await resolveBranchScope(c);
    const { results } = await c.env.DB.prepare(`
      SELECT DISTINCT so.customer_id FROM sales_orders so JOIN invoices i ON i.sales_order_id = so.id
      WHERE so.customer_id IS NOT NULL AND ${COUNTED_SALE} AND i.status <> 'PAID' ${branchSql(scope, 'so.branch_id')} LIMIT 500`).all();
    const rows = (await Promise.all(((results || []) as any[]).map((r) => customerCredit(c.env.DB, r.customer_id)))).filter((r: any) => r && (r.over_limit || r.overdue_invoices > 0));
    rows.sort((a: any, b: any) => b.overdue_amount - a.overdue_amount || b.outstanding - a.outstanding);
    return c.json({ customers: rows });
  });

  // ── 11. Quotations ──
  const quoteOut = (q: any) => {
    const expired = q.status !== 'CONVERTED' && q.status !== 'CANCELLED' && q.valid_until && new Date(q.valid_until).getTime() < Date.now();
    return { ...q, total_amount: r2(Number(q.total_amount)), discount_amount: r2(Number(q.discount_amount || 0)), status: expired ? 'EXPIRED' : q.status };
  };
  const QUOTE_SELECT = `
    SELECT q.*, COALESCE(cu.name, q.customer_name, 'Walk-in customer') AS customer, cu.phone AS customer_phone, b.name AS branch_name,
           u.full_name AS created_by_name, so.order_number AS converted_order_number, l.name AS price_level_name
    FROM quotations q
    LEFT JOIN customers cu ON cu.id = q.customer_id LEFT JOIN branches b ON b.id = q.branch_id
    LEFT JOIN users u ON u.id = q.created_by LEFT JOIN sales_orders so ON so.id = q.converted_order_id
    LEFT JOIN selling_price_levels l ON l.id = q.price_level_id`;
  app.get('/quotations', view, async (c: any) => {
    const scope = await resolveBranchScope(c);
    const { results } = await c.env.DB.prepare(`${QUOTE_SELECT} WHERE 1=1 ${branchSql(scope, 'q.branch_id')} ORDER BY q.created_at DESC LIMIT 500`).all();
    return c.json({ quotations: ((results || []) as any[]).map(quoteOut) });
  });
  const quoteOr404 = async (c: any, id: string) => {
    const scope = await resolveBranchScope(c);
    return await c.env.DB.prepare(`${QUOTE_SELECT} WHERE q.id = ? ${branchSql(scope, 'q.branch_id')}`).bind(id).first() as any;
  };
  app.get('/quotations/:id', view, async (c: any) => {
    const q = await quoteOr404(c, c.req.param('id'));
    if (!q) return c.json({ message: 'Quotation not found.' }, 404);
    const { results } = await c.env.DB.prepare(`SELECT ql.*, p.name AS product_name, p.sku FROM quotation_lines ql JOIN products p ON p.id = ql.product_id WHERE ql.quotation_id = ? ORDER BY p.name`).bind(q.id).all();
    return c.json({ ...quoteOut(q), lines: ((results || []) as any[]).map((l) => ({ ...l, unit_price: Number(l.unit_price), discount_amount: Number(l.discount_amount || 0), line_total: r2(Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount || 0)) })) });
  });
  /** Validates and prices quotation lines (prices are never taken from the client). */
  const buildLines = async (c: any, body: any, levelId: string | null) => {
    const raw = Array.isArray(body.lines) ? body.lines : [];
    if (!raw.length) throw new ScopeError(400, 'Add at least one product to the quotation.');
    const seen = new Set<string>();
    const lines = raw.map((l: any, i: number) => {
      const productId = String(l.productId || ''); const quantity = Number(l.quantity);
      if (!productId) throw new ScopeError(400, `Line ${i + 1}: choose a product.`);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new ScopeError(400, `Line ${i + 1}: quantity must be a whole number above 0.`);
      if (seen.has(productId)) throw new ScopeError(400, `Line ${i + 1}: this product is already on the quotation.`);
      seen.add(productId);
      return { productId, quantity, discount: Number(l.discountAmount || 0) };
    });
    const { price, product } = await priceFor(c.env.DB, levelId, lines);
    let subtotal = 0, discount = 0;
    const out = lines.map((l: any, i: number) => {
      const p = product.get(l.productId);
      if (!p) throw new ScopeError(400, `Line ${i + 1}: that product does not exist.`);
      if (Number(p.is_active) === 0) throw new ScopeError(400, `"${p.name}" is inactive and cannot be quoted.`);
      const unit = price.get(l.productId)!; const gross = r2(l.quantity * unit);
      if (!Number.isFinite(l.discount) || l.discount < 0 || l.discount > gross + 0.005) throw new ScopeError(400, `Line ${i + 1}: the discount must be between 0 and the line itself (${gross.toFixed(2)}).`);
      subtotal += gross; discount += r2(l.discount);
      return { ...l, discount: r2(l.discount), unit };
    });
    return { lines: out, subtotal: r2(subtotal), discount: r2(discount) };
  };
  app.post('/quotations', view, async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const scope = await resolveBranchScope(c, 'ALL');
    const branchId = scope.kind === 'BRANCH' ? scope.branchId : text(body.branchId, 80);
    if (!branchId || !(await c.env.DB.prepare('SELECT 1 FROM branches WHERE id = ?').bind(branchId).first())) return c.json({ message: 'Choose the branch of the quotation.' }, 400);
    const customerId = text(body.customerId, 80);
    if (customerId && !(await customerInScope(c, customerId))) return c.json({ message: 'Customer does not exist.' }, 400);
    const validDays = body.validDays === undefined ? 14 : Number(body.validDays);
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) return c.json({ message: 'A quotation is valid for 1 to 365 days.' }, 400);
    const levelId = await resolveSaleLevel(c, body.priceLevelId, customerId);
    const built = await buildLines(c, body, levelId);
    const id = uuidv4(); const number = `QT-${Date.now()}`;
    const validUntil = new Date(Date.now() + validDays * 86_400_000).toISOString();
    const stmts: any[] = [c.env.DB.prepare(`
      INSERT INTO quotations (id, quotation_number, customer_id, customer_name, branch_id, status, valid_until, total_amount, discount_amount, notes, created_by, price_level_id)
      VALUES (?, ?, ?, ?, ?, 'SENT', ?, ?, ?, ?, ?, ?)`).bind(id, number, customerId, customerId ? null : text(body.customerName, 120), branchId, validUntil, r2(built.subtotal - built.discount), built.discount, text(body.notes, 500), c.get('jwtPayload').sub, levelId)];
    for (const l of built.lines) stmts.push(c.env.DB.prepare('INSERT INTO quotation_lines (id, quotation_id, product_id, quantity, unit_price, discount_amount) VALUES (?, ?, ?, ?, ?, ?)').bind(uuidv4(), id, l.productId, l.quantity, l.unit, l.discount));
    stmts.push(createAuditLogStmt(c, 'QUOTATION_CREATE', 'quotations', id, null, { quotation_number: number, total: r2(built.subtotal - built.discount) }));
    await c.env.DB.batch(stmts);
    return c.json({ id, quotation_number: number, total_amount: r2(built.subtotal - built.discount), valid_until: validUntil }, 201);
  });
  // Cancel, or extend the validity. A converted quotation is kept as it is.
  app.patch('/quotations/:id', view, async (c: any) => {
    const q = await quoteOr404(c, c.req.param('id'));
    if (!q) return c.json({ message: 'Quotation not found.' }, 404);
    if (q.converted_order_id) return c.json({ message: 'This quotation is already a sale and cannot be changed.' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const sets: string[] = []; const vals: unknown[] = [];
    if (body.status === 'CANCELLED') { sets.push("status = 'CANCELLED'"); }
    if (body.validDays !== undefined) {
      const d = Number(body.validDays);
      if (!Number.isInteger(d) || d < 1 || d > 365) return c.json({ message: 'A quotation is valid for 1 to 365 days.' }, 400);
      if (q.status === 'CANCELLED') return c.json({ message: 'This quotation was cancelled.' }, 400);
      sets.push('valid_until = ?'); vals.push(new Date(Date.now() + d * 86_400_000).toISOString());
    }
    if ('notes' in body) { sets.push('notes = ?'); vals.push(text(body.notes, 500)); }
    if (!sets.length) return c.json({ message: 'Nothing to change.' }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE quotations SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND converted_order_id IS NULL`).bind(...vals, q.id),
      createAuditLogStmt(c, 'QUOTATION_UPDATE', 'quotations', q.id, { status: q.status, valid_until: q.valid_until }, body),
    ]);
    return c.json({ ok: true });
  });

  // ── 14. Sales performance per employee ──
  app.get('/performance', view, async (c: any) => {
    const { from, to } = range(c);
    const scope = await resolveBranchScope(c);
    const payload = c.get('jwtPayload');
    let rows = await sellerSales(c.env.DB, from, to, branchSql(scope, 'so.branch_id'));
    // A seller without management rights sees their own figures only.
    const manages = isAdminUser(payload) || (payload.permissions || []).includes('view_reports') || ['manager', 'branch_manager'].some((r) => (payload.roles || [payload.role]).includes(r));
    if (!manages) rows = rows.filter((r) => r.user_id === payload.sub);
    const totals = rows.reduce((a, r) => ({ sales: a.sales + r.sales, gross: r2(a.gross + r.gross), discounts: r2(a.discounts + r.discounts), returns: r2(a.returns + r.returns), net: r2(a.net + r.net) }), { sales: 0, gross: 0, discounts: 0, returns: 0, net: 0 });
    return c.json({ from, to, rows: rows.map((r, i) => ({ ...r, rank: i + 1, share: totals.net > 0 ? Math.round((r.net / totals.net) * 1000) / 10 : 0 })), totals });
  });

  // ── 15. Sales targets (per month) ──
  app.get('/targets', view, async (c: any) => {
    const period = isPeriod(c.req.query('period')) ? c.req.query('period') : today().slice(0, 7);
    const { from, to } = monthEnds(period);
    const scope = await resolveBranchScope(c);
    const payload = c.get('jwtPayload');
    const [{ results: targets }, sellers, { results: byBranch }] = await Promise.all([
      c.env.DB.prepare(`
        SELECT t.*, CASE t.scope_type WHEN 'EMPLOYEE' THEN u.full_name WHEN 'BRANCH' THEN b.name ELSE 'Whole company' END AS scope_name, u.branch_id AS user_branch
        FROM sales_targets t LEFT JOIN users u ON t.scope_type = 'EMPLOYEE' AND u.id = t.scope_id LEFT JOIN branches b ON t.scope_type = 'BRANCH' AND b.id = t.scope_id
        WHERE t.period = ? ORDER BY t.scope_type, scope_name`).bind(period).all(),
      sellerSales(c.env.DB, from, to),
      c.env.DB.prepare(`
        SELECT so.branch_id, COALESCE(SUM(i.total_amount - i.discount_amount), 0)
          - COALESCE((SELECT SUM(sr.return_value) FROM sales_returns sr JOIN sales_orders s2 ON s2.id = sr.sales_order_id WHERE s2.branch_id = so.branch_id AND ${dayOf('sr.created_at')} BETWEEN ?::date AND ?::date), 0) AS net
        FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
        WHERE ${COUNTED_SALE} AND ${dayOf('i.issued_at')} BETWEEN ?::date AND ?::date GROUP BY so.branch_id`).bind(from, to, from, to).all(),
    ]) as any[];
    const bySeller = new Map<string, number>((sellers as any[]).map((s) => [s.user_id, s.net]));
    const branchNet = new Map<string, number>(((byBranch || []) as any[]).map((b) => [b.branch_id, r2(Number(b.net))]));
    const companyNet = r2([...branchNet.values()].reduce((a, v) => a + v, 0));
    let rows = ((targets || []) as any[]).map((t) => {
      const amount = Number(t.amount);
      const actual = t.scope_type === 'EMPLOYEE' ? (bySeller.get(t.scope_id) || 0) : t.scope_type === 'BRANCH' ? (branchNet.get(t.scope_id) || 0) : companyNet;
      return { id: t.id, scope_type: t.scope_type, scope_id: t.scope_id, scope_name: t.scope_name || 'Unknown', period: t.period, amount, actual: r2(actual), remaining: Math.max(0, r2(amount - actual)), percent: amount > 0 ? Math.round((actual / amount) * 1000) / 10 : 0, branch_id: t.scope_type === 'BRANCH' ? t.scope_id : t.user_branch };
    });
    if (scope.kind === 'BRANCH') rows = rows.filter((r) => r.scope_type !== 'COMPANY' && r.branch_id === scope.branchId);
    if (!isAdminUser(payload) && !(payload.permissions || []).includes('view_reports')) rows = rows.filter((r) => r.scope_type !== 'EMPLOYEE' || r.scope_id === payload.sub);
    return c.json({ period, from, to, targets: rows });
  });
  app.put('/targets', async (c: any) => {
    owner(c, 'set sales targets');
    const body = await c.req.json().catch(() => ({}));
    const type = String(body.scopeType || '').toUpperCase();
    if (!['EMPLOYEE', 'BRANCH', 'COMPANY'].includes(type)) return c.json({ message: 'Choose who the target is for: an employee, a branch or the whole company.' }, 400);
    if (!isPeriod(body.period)) return c.json({ message: 'Choose the month of the target.' }, 400);
    const scopeId = type === 'COMPANY' ? null : text(body.scopeId, 80);
    if (type === 'EMPLOYEE' && !(await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(scopeId).first())) return c.json({ message: 'Choose the employee.' }, 400);
    if (type === 'BRANCH' && !(await c.env.DB.prepare('SELECT 1 FROM branches WHERE id = ?').bind(scopeId).first())) return c.json({ message: 'Choose the branch.' }, 400);
    const amount = r2(Number(body.amount));
    const existing = await c.env.DB.prepare(`SELECT id, amount FROM sales_targets WHERE scope_type = ? AND COALESCE(scope_id, '') = ? AND period = ?`).bind(type, scopeId || '', body.period).first() as any;
    if (!Number.isFinite(amount) || amount < 0) return c.json({ message: 'The target must be an amount of money.' }, 400);
    if (amount === 0) {
      if (existing) await c.env.DB.batch([c.env.DB.prepare('DELETE FROM sales_targets WHERE id = ?').bind(existing.id), createAuditLogStmt(c, 'SALES_TARGET_REMOVE', 'sales_targets', existing.id, existing, null)]);
      return c.json({ removed: true });
    }
    const id = existing?.id || uuidv4();
    await c.env.DB.batch([
      existing ? c.env.DB.prepare('UPDATE sales_targets SET amount = ? WHERE id = ?').bind(amount, id)
        : c.env.DB.prepare('INSERT INTO sales_targets (id, scope_type, scope_id, period, amount, created_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, type, scopeId, body.period, amount, c.get('jwtPayload').sub),
      createAuditLogStmt(c, 'SALES_TARGET_SET', 'sales_targets', id, existing || null, { scopeType: type, scopeId, period: body.period, amount }),
    ]);
    return c.json({ id, amount });
  });
  // People who sell (for the target form).
  app.get('/sellers', view, async (c: any) => {
    const scope = await resolveBranchScope(c);
    const { results } = await c.env.DB.prepare(`
      SELECT u.id, u.full_name, u.branch_id, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.is_active = 1 AND (u.branch_id IS NOT NULL OR EXISTS (SELECT 1 FROM sales_orders so WHERE so.created_by = u.id)) ${branchSql(scope, 'u.branch_id')}
      ORDER BY u.full_name`).all();
    return c.json({ sellers: results || [] });
  });

  // ── 16. Sales report: per day, month or year ──
  app.get('/sales-report', view, async (c: any) => {
    const { from, to } = range(c);
    const group = ['day', 'month', 'year'].includes(c.req.query('group')) ? c.req.query('group') : 'day';
    const fmt = group === 'day' ? 'YYYY-MM-DD' : group === 'month' ? 'YYYY-MM' : 'YYYY';
    const scope = await resolveBranchScope(c);
    const payload = c.get('jwtPayload');
    const seesAll = isAdminUser(payload) || (payload.permissions || []).includes('view_reports') || ['manager', 'branch_manager'].some((r) => (payload.roles || [payload.role]).includes(r));
    const filters: string[] = [branchSql(scope, 'so.branch_id')]; const binds: unknown[] = [];
    const sellerId = seesAll ? text(c.req.query('sellerId'), 80) : payload.sub;
    if (sellerId) { filters.push('AND so.created_by = ?'); binds.push(sellerId); }
    const customerId = text(c.req.query('customerId'), 80);
    if (customerId) { filters.push('AND so.customer_id = ?'); binds.push(customerId); }
    const f = filters.join(' ');
    const [{ results: inv }, { results: ret }] = await Promise.all([
      c.env.DB.prepare(`
        SELECT to_char(${dayOf('i.issued_at')}, '${fmt}') AS period, COUNT(*)::int AS sales,
               COALESCE(SUM(i.total_amount), 0) AS gross, COALESCE(SUM(i.discount_amount), 0) AS discounts,
               COALESCE(SUM(COALESCE(i.installation_fee, 0)), 0) AS installation
        FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
        WHERE ${COUNTED_SALE} AND ${dayOf('i.issued_at')} BETWEEN ?::date AND ?::date ${f} GROUP BY 1`).bind(from, to, ...binds).all(),
      c.env.DB.prepare(`
        SELECT to_char(${dayOf('sr.created_at')}, '${fmt}') AS period, COUNT(*)::int AS return_count, COALESCE(SUM(sr.return_value), 0) AS returns
        FROM sales_returns sr JOIN sales_orders so ON so.id = sr.sales_order_id
        WHERE ${dayOf('sr.created_at')} BETWEEN ?::date AND ?::date ${f} GROUP BY 1`).bind(from, to, ...binds).all(),
    ]) as any[];
    const map = new Map<string, any>();
    const row = (p: string) => { if (!map.has(p)) map.set(p, { period: p, sales: 0, gross: 0, discounts: 0, returns: 0, return_count: 0, installation: 0, net: 0 }); return map.get(p); };
    for (const r of (inv || []) as any[]) Object.assign(row(r.period), { sales: Number(r.sales), gross: r2(Number(r.gross)), discounts: r2(Number(r.discounts)), installation: r2(Number(r.installation)) });
    for (const r of (ret || []) as any[]) Object.assign(row(r.period), { returns: r2(Number(r.returns)), return_count: Number(r.return_count) });
    const rows = [...map.values()].map((r) => ({ ...r, net: r2(r.gross - r.discounts - r.returns) })).sort((a, b) => b.period.localeCompare(a.period));
    const totals = rows.reduce((a, r) => ({ sales: a.sales + r.sales, gross: r2(a.gross + r.gross), discounts: r2(a.discounts + r.discounts), returns: r2(a.returns + r.returns), installation: r2(a.installation + r.installation), net: r2(a.net + r.net) }), { sales: 0, gross: 0, discounts: 0, returns: 0, installation: 0, net: 0 });
    return c.json({ from, to, group, rows, totals });
  });
}
