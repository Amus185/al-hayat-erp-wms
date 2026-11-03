// Quick search across the ERP (the staff app's Ctrl+K): order, invoice,
// delivery, transfer, purchase order and web order numbers, customers (name or
// phone) and products (name, SKU, barcode). Each kind is limited to a few
// matches and only searched for people allowed to see it; branch staff only
// find their own branch's orders and deliveries.
import { Hono } from 'hono';
import { Env } from '../db';
import { authMiddleware } from '../middleware/auth';
import { resolveBranchScope, branchSql, customerVisibleSql, productVisibleSql } from '../services/branch-scope';
import { likeTerm } from '../services/listing';

const search = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
search.use('/*', authMiddleware);

const PER_KIND = 5;

export interface SearchHit {
  kind: 'order' | 'invoice' | 'delivery' | 'customer' | 'product' | 'transfer' | 'purchase' | 'web_order';
  id: string;
  title: string;
  subtitle: string;
  /** where the staff app opens it */
  url: string;
}

search.get('/', async (c) => {
  const term = (c.req.query('q') || '').trim().slice(0, 80);
  if (term.length < 2) return c.json({ results: [] });
  const p = c.get('jwtPayload');
  const can = (perm: string) => p.role === 'admin' || p.permissions?.includes(perm) || p.permissions?.includes('*');
  const db = c.env.DB;
  const t = likeTerm(term);
  const digits = /^[\d\s+()-]+$/.test(term) ? term.replace(/\D/g, '') : '';
  // Branch visibility, needed for orders, deliveries, transfers and purchases.
  // Staff whose branch cannot be resolved simply get no branch-scoped results.
  const scope = await resolveBranchScope(c).catch(() => null);
  const jobs: Array<Promise<SearchHit[]>> = [];
  const money = (v: unknown) => `$${Number(v || 0).toFixed(2)}`;

  if (scope && (can('manage_sales') || can('view_reports'))) {
    jobs.push(db.prepare(`
      SELECT so.id, so.order_number, so.status, so.created_at, c.name AS customer
      FROM sales_orders so LEFT JOIN customers c ON c.id = so.customer_id
      WHERE (so.order_number ILIKE ? OR c.name ILIKE ? OR c.phone ILIKE ?) ${branchSql(scope, 'so.branch_id')}
      ORDER BY so.created_at DESC LIMIT ${PER_KIND}
    `).bind(t, t, t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'order', id: r.id, title: r.order_number, subtitle: `${r.customer || 'Walk-in'} · ${r.status}`, url: `/sales?open=${encodeURIComponent(r.id)}`,
    }))));
    jobs.push(db.prepare(`
      SELECT i.invoice_number, i.total_amount, i.status, so.id AS order_id, so.order_number
      FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
      WHERE i.invoice_number ILIKE ? ${branchSql(scope, 'so.branch_id')}
      ORDER BY i.invoice_number DESC LIMIT ${PER_KIND}
    `).bind(t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'invoice', id: r.order_id, title: r.invoice_number, subtitle: `Invoice · ${money(r.total_amount)} · order ${r.order_number}`, url: `/sales?open=${encodeURIComponent(r.order_id)}`,
    }))));
    jobs.push(db.prepare(`
      SELECT d.id, d.delivery_number, d.status, d.customer_name
      FROM deliveries d LEFT JOIN sales_orders so ON so.id = d.sales_order_id
      WHERE (d.delivery_number ILIKE ? OR d.customer_name ILIKE ?) ${branchSql(scope, 'COALESCE(d.branch_id, so.branch_id)')}
      ORDER BY d.created_at DESC LIMIT ${PER_KIND}
    `).bind(t, t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'delivery', id: r.id, title: r.delivery_number, subtitle: `Delivery · ${r.customer_name || ''} · ${r.status}`, url: `/deliveries?open=${encodeURIComponent(r.id)}`,
    }))));
    jobs.push(db.prepare(`
      SELECT cu.id, cu.name, cu.phone FROM customers cu
      WHERE (cu.name ILIKE ? OR cu.email ILIKE ? OR COALESCE(cu.phone, '') ILIKE ?${digits.length >= 3 ? " OR regexp_replace(COALESCE(cu.phone, ''), '\\D', '', 'g') LIKE ?" : ''})
        ${scope.kind === 'BRANCH' ? `AND ${customerVisibleSql(scope.branchId)}` : ''}
      ORDER BY cu.name LIMIT ${PER_KIND}
    `).bind(t, t, t, ...(digits.length >= 3 ? [`%${digits}%`] : [])).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'customer', id: r.id, title: r.name, subtitle: `Customer${r.phone ? ' · ' + r.phone : ''}`, url: `/customers?q=${encodeURIComponent(r.phone || r.name)}`,
    }))));
    // Online orders are company-level: only the company view (not a branch) searches them.
    if (scope.kind === 'ALL') jobs.push(db.prepare(`
      SELECT id, request_number, customer_name, status, total_amount FROM storefront_requests
      WHERE request_number ILIKE ? OR customer_name ILIKE ? OR phone ILIKE ?
      ORDER BY created_at DESC LIMIT ${PER_KIND}
    `).bind(t, t, t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'web_order', id: r.id, title: r.request_number, subtitle: `Online order · ${r.customer_name} · ${money(r.total_amount)} · ${r.status}`, url: `/online-store?tab=orders&open=${encodeURIComponent(r.id)}`,
    }))).catch(() => []));
  }
  if (scope && (can('manage_inventory') || can('manage_sales'))) {
    // A branch finds the products it deals in, with its own stock; the company view sees all.
    const stockOf = scope.kind === 'BRANCH' ? `WHERE owner_type = 'BRANCH' AND branch_id = '${scope.branchId}'` : '';
    jobs.push(db.prepare(`
      SELECT p.id, p.name, p.sku, p.selling_price, COALESCE(st.on_hand, 0) AS on_hand
      FROM products p
      LEFT JOIN (SELECT product_id, SUM(quantity_on_hand) AS on_hand FROM inventory_stock ${stockOf} GROUP BY product_id) st ON st.product_id = p.id
      WHERE (p.name ILIKE ? OR p.sku ILIKE ? OR COALESCE(p.barcode, '') ILIKE ?)
        ${scope.kind === 'BRANCH' ? `AND ${productVisibleSql(scope.branchId)}` : ''}
      ORDER BY (p.sku ILIKE ?) DESC, p.name LIMIT ${PER_KIND}
    `).bind(t, t, t, term).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'product', id: r.id, title: r.name, subtitle: `${r.sku} · ${money(r.selling_price)} · ${Number(r.on_hand)} in stock`, url: `/products?q=${encodeURIComponent(r.sku)}`,
    }))));
  }
  if (scope && can('manage_transfers')) {
    jobs.push(db.prepare(`
      SELECT t.id, t.transfer_number, t.status FROM transfers t
      WHERE t.transfer_number ILIKE ? ${scope.kind === 'BRANCH' ? `AND (t.source_branch_id = '${scope.branchId}' OR t.destination_branch_id = '${scope.branchId}')` : ''}
      ORDER BY t.created_at DESC LIMIT ${PER_KIND}
    `).bind(t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'transfer', id: r.id, title: r.transfer_number, subtitle: `Transfer · ${r.status}`, url: `/transfers?open=${encodeURIComponent(r.id)}`,
    }))));
  }
  if (scope && can('manage_purchasing')) {
    jobs.push(db.prepare(`
      SELECT po.id, po.po_number, po.status, po.total_amount, s.name AS supplier
      FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE (po.po_number ILIKE ? OR s.name ILIKE ?) ${branchSql(scope, 'po.branch_id')}
      ORDER BY po.created_at DESC LIMIT ${PER_KIND}
    `).bind(t, t).all().then(({ results }: any) => (results || []).map((r: any) => ({
      kind: 'purchase', id: r.id, title: r.po_number, subtitle: `Purchase order · ${r.supplier || ''} · ${money(r.total_amount)} · ${r.status}`, url: `/purchasing?open=${encodeURIComponent(r.id)}`,
    }))));
  }

  const settled = await Promise.allSettled(jobs);
  const results = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  return c.json({ results });
});

export default search;
