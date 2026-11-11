// Rules shared by sales, quotations, commissions and the sales reports (roadmap items 9, 11, 13-16, 23).
import { ScopeError } from './branch-scope';
import { isAdminUser } from '../middleware/auth';
import { levelPlanner } from './price-levels';

export const r2 = (n: number) => Math.round(n * 100) / 100;
/** The business day of a timestamp (Hargeisa time). */
export const dayOf = (col: string) => `(${col} AT TIME ZONE 'Africa/Mogadishu')::date`;
/** A sale that counts: it has an invoice, and neither the order nor the invoice was cancelled. */
export const COUNTED_SALE = `so.status <> 'CANCELLED' AND i.status <> 'CANCELLED'`;

/**
 * The selling price level of a sale. It comes from the customer (set by the Owner on the customer).
 * Only the Owner / an accountant may choose another level on a single sale.
 * Returns null for the default level (Retail = the product's own price).
 */
export async function resolveSaleLevel(c: any, requested: unknown, customerId: string | null | undefined): Promise<string | null> {
  const db = c.env.DB;
  let levelId: string | null = null;
  if (customerId) levelId = ((await db.prepare('SELECT price_level_id FROM customers WHERE id = ?').bind(customerId).first()) as any)?.price_level_id ?? null;
  if (typeof requested === 'string' && requested.trim() && requested !== levelId) {
    if (!isAdminUser(c.get('jwtPayload'))) throw new ScopeError(403, 'The price level comes from the customer. Only the Owner can choose another level on a sale.');
    levelId = requested.trim();
  }
  if (!levelId) return null;
  const level = await db.prepare('SELECT id, is_default, is_active FROM selling_price_levels WHERE id = ?').bind(levelId).first() as any;
  if (!level) throw new ScopeError(400, 'That price level does not exist.');
  if (Number(level.is_active) !== 1) throw new ScopeError(400, 'That price level is not in use any more.');
  return Number(level.is_default) === 1 ? null : level.id;
}

/** Prices the Owner set for a level: product id -> price. Products without one keep their regular price. */
export async function levelPriceMap(db: any, levelId: string | null, productIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!levelId || !productIds.length) return map;
  const { results } = await db.prepare(`SELECT product_id, price FROM selling_level_prices WHERE level_id = ? AND product_id IN (${productIds.map(() => '?').join(', ')})`).bind(levelId, ...productIds).all();
  for (const r of (results || []) as any[]) map.set(r.product_id, Number(r.price));
  return map;
}

/** The price of each product for a quotation: the level's price, else the product's regular price (stock price levels oldest first). */
export async function priceFor(db: any, levelId: string | null, lines: { productId: string; quantity: number }[]) {
  const ids = Array.from(new Set(lines.map((l) => l.productId)));
  if (!ids.length) return { price: new Map<string, number>(), product: new Map<string, any>() };
  const [levels, planner, rows] = await Promise.all([
    levelPriceMap(db, levelId, ids),
    levelPlanner(db, ids),
    db.prepare(`SELECT id, name, sku, selling_price, COALESCE(is_active, 1) AS is_active FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all(),
  ]);
  const product = new Map<string, any>((((rows as any).results || []) as any[]).map((p) => [p.id, p]));
  const price = new Map<string, number>();
  for (const l of lines) {
    const p = product.get(l.productId); if (!p) continue;
    let unit = Number(p.selling_price || 0);
    if (levels.has(l.productId)) unit = levels.get(l.productId)!;
    else if (planner.has(l.productId)) { const t = planner.take(l.productId, l.quantity, false); if (Number.isFinite(t.unitPrice)) unit = Math.round(t.unitPrice * 10000) / 10000; }
    price.set(l.productId, unit);
  }
  return { price, product };
}

/** What a customer owes on sales (all branches) and how much of it is overdue. */
export async function customerCredit(db: any, customerId: string) {
  const cu = await db.prepare('SELECT id, name, credit_limit, credit_days, price_level_id FROM customers WHERE id = ?').bind(customerId).first() as any;
  if (!cu) return null;
  const days = Number(cu.credit_days ?? 30) || 30;
  const { results } = await db.prepare(`
    SELECT i.id, i.invoice_number, i.issued_at,
      GREATEST(0, (COALESCE(i.total_amount, 0) - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0))
        - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0)) AS balance,
      FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.issued_at)) / 86400)::int AS age_days
    FROM sales_orders so JOIN invoices i ON i.sales_order_id = so.id
    WHERE so.customer_id = ? AND ${COUNTED_SALE} AND i.status <> 'PAID'
  `).bind(customerId).all();
  const [debts, credit] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(remaining_balance), 0) AS v FROM customer_debts WHERE customer_id = ? AND status <> 'CANCELLED'`).bind(customerId).first(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM customer_payments WHERE customer_id = ? AND allocation_type = 'ACCOUNT'`).bind(customerId).first(),
  ]) as any[];
  const open = ((results || []) as any[]).map((r) => ({ ...r, balance: r2(Number(r.balance)), days_overdue: Math.max(0, Number(r.age_days) - days) })).filter((r) => r.balance > 0.005);
  const invoices = r2(open.reduce((a, r) => a + r.balance, 0));
  const outstanding = Math.max(0, r2(invoices + Number(debts?.v || 0) - Number(credit?.v || 0)));
  const overdue = open.filter((r) => r.days_overdue > 0);
  const limit = Number(cu.credit_limit || 0);
  return {
    customer_id: cu.id, customer_name: cu.name, credit_limit: limit, credit_days: days, price_level_id: cu.price_level_id ?? null,
    outstanding, available: limit > 0 ? r2(limit - outstanding) : null,
    overdue_amount: r2(overdue.reduce((a, r) => a + r.balance, 0)), overdue_invoices: overdue.length,
    oldest_overdue_days: overdue.reduce((a, r) => Math.max(a, r.days_overdue), 0),
    over_limit: limit > 0 && outstanding > limit + 0.005,
  };
}

/**
 * Credit control on a new credit sale. Over the limit: refused, unless the Owner / an accountant
 * approves it on this sale (`override`), which is written to the audit log by the caller.
 * Returns the reason when an override was used, else null.
 */
export async function checkCredit(c: any, customerId: string | null | undefined, newDebt: number, override: boolean): Promise<string | null> {
  if (!customerId || newDebt <= 0.005) return null;
  const cr = await customerCredit(c.env.DB, customerId);
  if (!cr || cr.credit_limit <= 0) return null; // no limit set for this customer
  const after = r2(cr.outstanding + newDebt);
  if (after <= cr.credit_limit + 0.005) return null;
  const msg = `${cr.customer_name} owes ${cr.outstanding.toFixed(2)} and this sale adds ${newDebt.toFixed(2)}: that is ${after.toFixed(2)}, over the credit limit of ${cr.credit_limit.toFixed(2)}.`;
  if (override && isAdminUser(c.get('jwtPayload'))) return msg;
  throw new CreditLimitError(`${msg} Take a larger deposit, or ask the Owner to approve it.`, cr);
}
export class CreditLimitError extends ScopeError {
  credit: unknown;
  constructor(message: string, credit: unknown) { super(400, message); this.credit = credit; }
}

/** Net sales per seller for a period: invoices issued, less discounts, less returns. Cancelled sales do not count. */
export async function sellerSales(db: any, from: string, to: string, bf = '') {
  const { results } = await db.prepare(`
    WITH inv AS (
      SELECT so.created_by AS user_id, COUNT(*)::int AS sales, COALESCE(SUM(i.total_amount), 0) AS gross, COALESCE(SUM(i.discount_amount), 0) AS discounts
      FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
      WHERE ${COUNTED_SALE} AND ${dayOf('i.issued_at')} BETWEEN ?::date AND ?::date ${bf}
      GROUP BY so.created_by
    ), ret AS (
      SELECT so.created_by AS user_id, COALESCE(SUM(sr.return_value), 0) AS returns
      FROM sales_returns sr JOIN sales_orders so ON so.id = sr.sales_order_id
      WHERE ${dayOf('sr.created_at')} BETWEEN ?::date AND ?::date ${bf}
      GROUP BY so.created_by
    )
    SELECT COALESCE(inv.user_id, ret.user_id) AS user_id, u.full_name, u.branch_id, b.name AS branch_name,
           COALESCE(inv.sales, 0) AS sales, COALESCE(inv.gross, 0) AS gross, COALESCE(inv.discounts, 0) AS discounts, COALESCE(ret.returns, 0) AS returns
    FROM inv FULL OUTER JOIN ret ON ret.user_id = inv.user_id
    LEFT JOIN users u ON u.id = COALESCE(inv.user_id, ret.user_id)
    LEFT JOIN branches b ON b.id = u.branch_id
  `).bind(from, to, from, to).all();
  return ((results || []) as any[]).map((r) => {
    const gross = r2(Number(r.gross)), discounts = r2(Number(r.discounts)), returns = r2(Number(r.returns));
    const net = r2(gross - discounts - returns);
    return { user_id: r.user_id, full_name: r.full_name || 'Unknown', branch_id: r.branch_id, branch_name: r.branch_name, sales: Number(r.sales), gross, discounts, returns, net, average: Number(r.sales) ? r2(net / Number(r.sales)) : 0 };
  }).sort((a, b) => b.net - a.net);
}
