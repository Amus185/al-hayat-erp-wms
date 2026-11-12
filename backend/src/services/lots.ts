// Serial numbers and batches (roadmap item 20). Only products whose `tracking` is BATCH or SERIAL
// get lots; for every other product these statements change nothing. Lots are taken oldest first
// (FIFO) when stock leaves on a sale, and given back when the sale is cancelled.
import { ScopeError } from './branch-scope';

/** Lots for goods coming in (a goods receipt). BATCH: one lot; SERIAL: one lot per unit. */
export function lotsInStatement(db: any, p: { productId: string; quantity: number; code?: string | null; serials?: string[] | null; warehouseId?: string | null; branchId?: string | null; sourceType: string; sourceId: string; tag: string }) {
  const serials = JSON.stringify((p.serials || []).map((s) => String(s).trim()).filter(Boolean));
  return db.prepare(`
    INSERT INTO stock_lots (id, product_id, kind, code, quantity_in, quantity_left, warehouse_id, branch_id, source_type, source_id)
    SELECT gen_random_uuid()::text, pr.id, pr.tracking,
      CASE WHEN pr.tracking = 'SERIAL' THEN COALESCE((?::jsonb)->>(g - 1), pr.sku || '-' || ? || '-' || lpad(g::text, 3, '0'))
           ELSE COALESCE(?, pr.sku || '-' || ?) END,
      CASE WHEN pr.tracking = 'SERIAL' THEN 1 ELSE ?::int END,
      CASE WHEN pr.tracking = 'SERIAL' THEN 1 ELSE ?::int END,
      ?, ?, ?, ?
    FROM products pr CROSS JOIN LATERAL generate_series(1, CASE WHEN pr.tracking = 'SERIAL' THEN ?::int ELSE 1 END) g
    WHERE pr.id = ? AND pr.tracking IN ('BATCH', 'SERIAL')
  `).bind(serials, p.tag, p.code || null, p.tag, p.quantity, p.quantity, p.warehouseId ?? null, p.branchId ?? null, p.sourceType, p.sourceId, p.quantity, p.productId);
}

/** Checks typed serial numbers / batch codes before goods are received (the batch would fail on a duplicate). */
export async function checkLotCodes(db: any, lines: { productId: string; quantity: number; code?: string | null; serials?: string[] | null }[]) {
  const ids = Array.from(new Set(lines.map((l) => l.productId)));
  if (!ids.length) return;
  const { results } = await db.prepare(`SELECT id, name, tracking FROM products WHERE id IN (${ids.map(() => '?').join(', ')}) AND tracking <> 'NONE'`).bind(...ids).all();
  const tracked = new Map<string, any>(((results || []) as any[]).map((r) => [r.id, r]));
  for (const l of lines) {
    const pr = tracked.get(l.productId);
    if (!pr) continue;
    const codes = pr.tracking === 'SERIAL' ? (l.serials || []).map((s) => String(s).trim()).filter(Boolean) : (l.code ? [String(l.code).trim()] : []);
    if (pr.tracking === 'SERIAL' && codes.length && codes.length !== l.quantity) throw new ScopeError(400, `${pr.name}: enter one serial number per unit (${l.quantity}), or leave them empty to number them automatically.`);
    if (new Set(codes.map((c) => c.toLowerCase())).size !== codes.length) throw new ScopeError(400, `${pr.name}: the same serial number is typed twice.`);
    if (!codes.length) continue;
    const dup = await db.prepare(`SELECT code FROM stock_lots WHERE product_id = ? AND lower(code) IN (${codes.map(() => '?').join(', ')}) LIMIT 1`).bind(pr.id, ...codes.map((c) => c.toLowerCase())).first() as any;
    if (dup) throw new ScopeError(400, `${pr.name}: ${pr.tracking === 'SERIAL' ? 'serial number' : 'batch'} ${dup.code} is already in the system.`);
  }
}

/**
 * Stock leaving on a sale: the oldest lots of each product first. One statement for all lines;
 * products without lots are skipped. Moves are recorded against the invoice for traceability.
 */
export function lotsOutStatement(db: any, p: { lines: { productId: string; quantity: number }[]; referenceType: string; referenceId: string; userId: string | null }) {
  const req = JSON.stringify(p.lines.filter((l) => l.quantity > 0).map((l) => ({ p: l.productId, q: l.quantity })));
  return db.prepare(`
    WITH req AS (SELECT x->>'p' AS pid, SUM((x->>'q')::int) AS qty FROM jsonb_array_elements(?::jsonb) x GROUP BY 1),
    ordered AS (
      SELECT l.id, l.quantity_left, r.qty,
        COALESCE(SUM(l.quantity_left) OVER (PARTITION BY l.product_id ORDER BY l.received_at, l.code ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
      FROM stock_lots l JOIN req r ON r.pid = l.product_id WHERE l.quantity_left > 0
    ),
    take AS (SELECT id, LEAST(quantity_left, qty - before)::int AS q FROM ordered WHERE before < qty),
    upd AS (UPDATE stock_lots s SET quantity_left = s.quantity_left - t.q FROM take t WHERE s.id = t.id AND t.q > 0 RETURNING s.id, t.q)
    INSERT INTO stock_lot_moves (id, lot_id, quantity, reference_type, reference_id, created_by)
    SELECT gen_random_uuid()::text, id, -q, ?, ?, ? FROM upd
  `).bind(req, p.referenceType, p.referenceId, p.userId);
}

/** A cancelled sale gives its lots back (exactly what it took). */
export function lotsBackStatement(db: any, p: { referenceType: string; referenceId: string; userId: string | null }) {
  return db.prepare(`
    WITH taken AS (
      SELECT lot_id, -SUM(quantity)::int AS q FROM stock_lot_moves WHERE reference_type IN (?, ?) AND reference_id = ? GROUP BY lot_id HAVING SUM(quantity) < 0
    ),
    upd AS (UPDATE stock_lots s SET quantity_left = s.quantity_left + t.q FROM taken t WHERE s.id = t.lot_id RETURNING s.id, t.q)
    INSERT INTO stock_lot_moves (id, lot_id, quantity, reference_type, reference_id, created_by)
    SELECT gen_random_uuid()::text, id, q, ?, ?, ? FROM upd
  `).bind(p.referenceType, `${p.referenceType}_CANCEL`, p.referenceId, `${p.referenceType}_CANCEL`, p.referenceId, p.userId);
}
