// Product costing: running (moving) weighted average, the method used by most ERPs.
//
// - A product's cost is never typed after it has stock: goods coming in set it.
//   New average = (units on hand × current cost + units in × their cost) ÷ (on hand + in).
//   With nothing on hand, the incoming cost becomes the cost.
// - Every sale line stores the unit cost at the moment of sale (sales_order_lines.unit_cost),
//   so later cost changes never change the profit of past sales.
// - Every cost or selling-price change is kept in product_price_history (old, new, why, who).
//
// The average is company-wide (products are shared by all branches and warehouses).
// All statements here are meant to run inside the caller's db.batch (one transaction).
// Products with price levels (services/price-levels.ts) follow their levels instead.

/** Units on hand everywhere, ignoring negative rows. */
const ON_HAND = `(SELECT COALESCE(SUM(GREATEST(s.quantity_on_hand, 0)), 0) FROM inventory_stock s WHERE s.product_id = p.id)`;

/**
 * Goods coming in at a known unit cost (purchase receipt, return of goods, finished production).
 * Returns the statements that record the change and update the average.
 * `stockAlreadyAdded`: true when the caller's batch increases inventory_stock BEFORE these run.
 * Grouped products have no stock of their own and are skipped.
 */
export function costInStatements(db: any, o: {
  productId: string; quantity: number; unitCost: number; source: string; referenceId?: string | null; userId?: string | null; stockAlreadyAdded?: boolean;
}): any[] {
  const q = Number(o.quantity);
  const u = Math.max(0, Number(o.unitCost));
  if (!(q > 0) || !Number.isFinite(u)) return [];
  const before = o.stockAlreadyAdded ? `GREATEST(${ON_HAND} - ?::double precision, 0)` : ON_HAND;
  const newCost = `ROUND((CASE WHEN ${before} <= 0 OR p.cost_price IS NULL THEN ?::double precision
                     ELSE (${before} * p.cost_price + ?::double precision * ?::double precision) / (${before} + ?::double precision) END)::numeric, 4)::double precision`;
  // Bind order follows the placeholders in newCost.
  const binds = o.stockAlreadyAdded ? [q, u, q, q, u, q, q] : [u, q, u, q];
  return [
    db.prepare(`
      INSERT INTO product_price_history (id, product_id, kind, old_value, new_value, source, reference_id, changed_by)
      SELECT gen_random_uuid()::text, p.id, 'COST', p.cost_price, ${newCost}, ?, ?, ?
      FROM products p WHERE p.id = ? AND COALESCE(p.product_type, 'STANDARD') <> 'GROUPED'
        AND NOT EXISTS (SELECT 1 FROM product_price_levels l WHERE l.product_id = p.id)
        AND abs(COALESCE(p.cost_price, -1) - ${newCost}) > 0.00005
    `).bind(...binds, o.source, o.referenceId ?? null, o.userId ?? null, o.productId, ...binds),
    db.prepare(`
      UPDATE products p SET cost_price = ${newCost}, updated_at = CURRENT_TIMESTAMP
      WHERE p.id = ? AND COALESCE(p.product_type, 'STANDARD') <> 'GROUPED'
        AND NOT EXISTS (SELECT 1 FROM product_price_levels l WHERE l.product_id = p.id)
    `).bind(...binds, o.productId),
  ];
}

/** Unit cost of each product now: its average cost; a grouped product = sum of its components. */
export async function unitCosts(db: any, productIds: string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const { results } = await db.prepare(`
    SELECT p.id,
           CASE WHEN COALESCE(p.product_type, 'STANDARD') = 'GROUPED'
                THEN (SELECT COALESCE(SUM(pgi.quantity * COALESCE(cp.cost_price, 0)), 0)
                      FROM product_group_items pgi JOIN products cp ON cp.id = pgi.component_product_id
                      WHERE pgi.parent_product_id = p.id)
                ELSE COALESCE(p.cost_price, 0) END AS unit_cost
    FROM products p WHERE p.id IN (${ids.map(() => '?').join(', ')})
  `).bind(...ids).all();
  for (const r of (results || []) as any[]) out.set(r.id, Number(r.unit_cost || 0));
  return out;
}

/** Stamps each line of an order with its unit cost now (lines already stamped keep theirs). */
export function stampOrderLineCosts(db: any, orderId: string) {
  return db.prepare(`
    UPDATE sales_order_lines sol SET unit_cost =
      CASE WHEN COALESCE(p.product_type, 'STANDARD') = 'GROUPED'
           THEN (SELECT COALESCE(SUM(pgi.quantity * COALESCE(cp.cost_price, 0)), 0)
                 FROM product_group_items pgi JOIN products cp ON cp.id = pgi.component_product_id
                 WHERE pgi.parent_product_id = p.id)
           ELSE COALESCE(p.cost_price, 0) END
    FROM products p
    WHERE p.id = sol.product_id AND sol.sales_order_id = ? AND sol.unit_cost IS NULL
  `).bind(orderId);
}

/** Records a selling-price change (Owner edits, or a price set while receiving goods). */
export function sellingPriceHistoryStmt(db: any, o: { productId: string; oldPrice: number | null; newPrice: number; source: string; referenceId?: string | null; userId?: string | null }) {
  return db.prepare(`
    INSERT INTO product_price_history (id, product_id, kind, old_value, new_value, source, reference_id, changed_by)
    VALUES (gen_random_uuid()::text, ?, 'SELLING', ?, ?, ?, ?, ?)
  `).bind(o.productId, o.oldPrice, o.newPrice, o.source, o.referenceId ?? null, o.userId ?? null);
}

/** The Owner: an administrator with no branch (not an accountant, not a branch "admin"). */
export function isOwner(p: any): boolean {
  return !!p && !p.branch_id && (p.role === 'admin' || (p.roles ?? []).includes('admin'));
}
