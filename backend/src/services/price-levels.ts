// Price levels (Owner request): one product, several batches at different cost and selling
// prices. The oldest level that still has units is the one being sold (first in, first out);
// when its units reach zero the next level's prices switch on by themselves.
//
// - A product without levels works as before (one cost, one price).
// - The first time a level is added, today's stock becomes level 1 at today's cost and price,
//   so the old stock is sold at the old price first.
// - products.selling_price = the price of the level being sold now; products.cost_price =
//   the average cost of the units left in all levels, so stock value (units × cost) equals the
//   sum of every level's units × its cost. Cost of each sale = the cost of the levels it took.
// - Levels are company-wide (products are shared); every move is kept in product_price_level_moves.
import { uuidv4 } from '../db';
import { unitCosts } from './costing';

export interface LevelRow { id: string; product_id: string; level_no: number; cost_price: number; selling_price: number; quantity_left: number }
export interface Take { levelId: string | null; productId: string; quantity: number; cost: number; price: number }

/** In-memory FIFO over the levels of some products (one per request; take() decrements). */
export async function levelPlanner(db: any, productIds: string[]) {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  const byProduct = new Map<string, LevelRow[]>();
  // Levels and fallback costs are independent: read both at once (each read is a round trip).
  const [levelRows, fallback] = await Promise.all([
    ids.length
      ? db.prepare(`
      SELECT id, product_id, level_no, cost_price, selling_price, quantity_left
      FROM product_price_levels WHERE product_id IN (${ids.map(() => '?').join(', ')}) ORDER BY product_id, level_no
    `).bind(...ids).all()
      : Promise.resolve({ results: [] }),
    unitCosts(db, ids),
  ]);
  if (ids.length) {
    const results = (levelRows as any)?.results;
    for (const r of (results || []) as any[]) {
      const list = byProduct.get(r.product_id) || [];
      list.push({ ...r, cost_price: Number(r.cost_price), selling_price: Number(r.selling_price), quantity_left: Number(r.quantity_left) });
      byProduct.set(r.product_id, list);
    }
  }
  const taken: Take[] = [];
  return {
    has: (pid: string) => byProduct.has(pid),
    /** Takes `qty` units FIFO. Units beyond all levels are at the newest level's price and the product's cost. */
    take(pid: string, qty: number, record = true) {
      const levels = byProduct.get(pid) || [];
      let left = qty; const parts: Take[] = [];
      for (const l of levels) {
        if (left <= 0) break;
        const q = Math.min(left, l.quantity_left);
        if (q <= 0) continue;
        l.quantity_left -= q; left -= q;
        parts.push({ levelId: l.id, productId: pid, quantity: q, cost: l.cost_price, price: l.selling_price });
      }
      if (left > 0) {
        const last = levels[levels.length - 1];
        parts.push({ levelId: null, productId: pid, quantity: left, cost: fallback.get(pid) ?? 0, price: last ? last.selling_price : NaN });
      }
      if (record) taken.push(...parts.filter((p) => p.levelId));
      const cost = parts.reduce((a, p) => a + p.quantity * p.cost, 0);
      const priced = parts.every((p) => Number.isFinite(p.price));
      const total = priced ? parts.reduce((a, p) => a + p.quantity * p.price, 0) : NaN;
      const breakdown = parts.length > 1 && priced ? parts.map((p) => `${p.quantity} × ${p.price.toFixed(2)}`).join(' + ') : null;
      return { cost, unitCost: qty > 0 ? cost / qty : 0, total, unitPrice: qty > 0 ? total / qty : NaN, breakdown, parts };
    },
    /** Statements that apply every recorded take (guarded), log the moves and re-sync the products. */
    statements(refType: string, refId: string, userId: string | null) {
      const stmts: any[] = [];
      for (const t of taken) {
        stmts.push(db.prepare(`
          UPDATE product_price_levels SET quantity_left = quantity_left - ?, depleted_at = CASE WHEN quantity_left - ? <= 0 THEN CURRENT_TIMESTAMP ELSE depleted_at END
          WHERE id = ? AND quantity_left >= ?
        `).bind(t.quantity, t.quantity, t.levelId, t.quantity).mustAffect('A price level was just used by another sale. Please try again.'));
        stmts.push(db.prepare(`
          INSERT INTO product_price_level_moves (id, level_id, product_id, quantity, unit_cost, reference_type, reference_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(uuidv4(), t.levelId, t.productId, -t.quantity, t.cost, refType, refId, userId));
      }
      for (const pid of new Set(taken.map((t) => t.productId))) stmts.push(...syncProductStatements(db, pid, userId));
      return stmts;
    },
  };
}

/**
 * Puts units back into the levels they came from (a cancelled sale, a returned item),
 * newest of that reference first. Returns the statements and the cost of what was put back.
 */
export async function restoreToLevels(db: any, o: { productId: string; quantity: number; fromRefId: string; refType: string; refId: string; userId: string | null }) {
  const { results } = await db.prepare(`
    SELECT m.level_id, -SUM(m.quantity) AS out_qty, MAX(m.unit_cost) AS unit_cost, l.level_no
    FROM product_price_level_moves m JOIN product_price_levels l ON l.id = m.level_id
    WHERE m.product_id = ? AND m.reference_id IN (?, ?)
    GROUP BY m.level_id, l.level_no HAVING -SUM(m.quantity) > 0 ORDER BY l.level_no DESC
  `).bind(o.productId, o.fromRefId, `${o.fromRefId}:back`).all();
  let left = o.quantity; let cost = 0; const stmts: any[] = [];
  for (const r of (results || []) as any[]) {
    if (left <= 0) break;
    const q = Math.min(left, Number(r.out_qty));
    left -= q; cost += q * Number(r.unit_cost);
    stmts.push(db.prepare('UPDATE product_price_levels SET quantity_left = quantity_left + ?, depleted_at = NULL WHERE id = ?').bind(q, r.level_id));
    stmts.push(db.prepare(`INSERT INTO product_price_level_moves (id, level_id, product_id, quantity, unit_cost, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uuidv4(), r.level_id, o.productId, q, Number(r.unit_cost), o.refType, `${o.fromRefId}:back`, o.userId));
  }
  if (stmts.length) stmts.push(...syncProductStatements(db, o.productId, o.userId));
  return { stmts, restored: o.quantity - left, cost };
}

/** Units coming in at the price being sold now (e.g. stock found in a count): added to the active level. */
export function addToActiveLevelStatements(db: any, productId: string, qty: number, refType: string, refId: string, userId: string | null) {
  return [
    db.prepare(`
      INSERT INTO product_price_level_moves (id, level_id, product_id, quantity, unit_cost, reference_type, reference_id, created_by)
      SELECT ?, l.id, l.product_id, ?, l.cost_price, ?, ?, ? FROM product_price_levels l
      WHERE l.id = (SELECT id FROM product_price_levels WHERE product_id = ? ORDER BY (quantity_left > 0) DESC, level_no ASC LIMIT 1)
    `).bind(uuidv4(), qty, refType, refId, userId, productId),
    db.prepare(`
      UPDATE product_price_levels SET quantity_left = quantity_left + ?, depleted_at = NULL
      WHERE id = (SELECT id FROM product_price_levels WHERE product_id = ? ORDER BY (quantity_left > 0) DESC, level_no ASC LIMIT 1)
    `).bind(qty, productId),
    ...syncProductStatements(db, productId, userId),
  ];
}

/** A new level at the end of the queue (new prices for goods coming in). */
export function newLevelStatements(db: any, o: { productId: string; costPrice: number; sellingPrice: number; quantity: number; source: string; refId?: string | null; note?: string | null; userId: string | null; levelId?: string }) {
  const id = o.levelId || uuidv4();
  return [
    db.prepare(`
      INSERT INTO product_price_levels (id, product_id, level_no, cost_price, selling_price, quantity_in, quantity_left, source, reference_id, note, created_by)
      SELECT ?, ?, COALESCE((SELECT MAX(level_no) FROM product_price_levels WHERE product_id = ?), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
    `).bind(id, o.productId, o.productId, o.costPrice, o.sellingPrice, o.quantity, o.quantity, o.source, o.refId ?? null, o.note ?? null, o.userId),
    db.prepare(`INSERT INTO product_price_level_moves (id, level_id, product_id, quantity, unit_cost, reference_type, reference_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(uuidv4(), id, o.productId, o.quantity, o.costPrice, o.source, o.refId ?? id, o.userId),
    ...syncProductStatements(db, o.productId, o.userId),
  ];
}

/** Today's stock becomes level 1 (at today's cost and price) if the product has no levels yet. */
export function baseLevelStatement(db: any, productId: string, userId: string | null) {
  return db.prepare(`
    INSERT INTO product_price_levels (id, product_id, level_no, cost_price, selling_price, quantity_in, quantity_left, source, created_by, activated_at)
    SELECT gen_random_uuid()::text, p.id, 1, COALESCE(p.cost_price, 0), COALESCE(p.selling_price, 0), s.q, s.q, 'STOCK_BEFORE_LEVELS', ?, CURRENT_TIMESTAMP
    FROM products p CROSS JOIN LATERAL (SELECT COALESCE(SUM(GREATEST(quantity_on_hand, 0)), 0)::int AS q FROM inventory_stock WHERE product_id = p.id) s
    WHERE p.id = ? AND s.q > 0 AND NOT EXISTS (SELECT 1 FROM product_price_levels WHERE product_id = p.id)
  `).bind(userId, productId);
}

/**
 * The product follows its levels: price of the oldest level with units (else the newest level),
 * cost = average of the units left (else the newest level's cost). Price changes go into the
 * price history. No-op for products without levels.
 */
export function syncProductStatements(db: any, productId: string, userId: string | null) {
  const price = `COALESCE(
    (SELECT selling_price FROM product_price_levels WHERE product_id = ? AND quantity_left > 0 ORDER BY level_no LIMIT 1),
    (SELECT selling_price FROM product_price_levels WHERE product_id = ? ORDER BY level_no DESC LIMIT 1))`;
  const cost = `COALESCE(
    (SELECT ROUND((SUM(quantity_left * cost_price) / NULLIF(SUM(quantity_left), 0))::numeric, 4)::double precision FROM product_price_levels WHERE product_id = ? AND quantity_left > 0),
    (SELECT cost_price FROM product_price_levels WHERE product_id = ? ORDER BY level_no DESC LIMIT 1))`;
  return [
    db.prepare(`
      INSERT INTO product_price_history (id, product_id, kind, old_value, new_value, source, changed_by)
      SELECT gen_random_uuid()::text, p.id, 'SELLING', p.selling_price, ${price}, 'PRICE_LEVEL_ACTIVATED', ?
      FROM products p WHERE p.id = ? AND ${price} IS NOT NULL AND abs(COALESCE(p.selling_price, 0) - ${price}) > 0.005
    `).bind(productId, productId, userId, productId, productId, productId, productId, productId),
    db.prepare(`
      INSERT INTO product_price_history (id, product_id, kind, old_value, new_value, source, changed_by)
      SELECT gen_random_uuid()::text, p.id, 'COST', p.cost_price, ${cost}, 'PRICE_LEVEL_ACTIVATED', ?
      FROM products p WHERE p.id = ? AND ${cost} IS NOT NULL AND abs(COALESCE(p.cost_price, 0) - ${cost}) > 0.00005
    `).bind(productId, productId, userId, productId, productId, productId, productId, productId),
    db.prepare(`
      UPDATE products SET selling_price = COALESCE(${price}, selling_price), cost_price = COALESCE(${cost}, cost_price), updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND EXISTS (SELECT 1 FROM product_price_levels WHERE product_id = ?)
    `).bind(productId, productId, productId, productId, productId, productId),
    db.prepare(`
      UPDATE product_price_levels SET activated_at = COALESCE(activated_at, CURRENT_TIMESTAMP)
      WHERE id = (SELECT id FROM product_price_levels WHERE product_id = ? AND quantity_left > 0 ORDER BY level_no LIMIT 1)
    `).bind(productId),
  ];
}
