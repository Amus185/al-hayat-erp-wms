// Shared logic for the public storefront: settings, availability, slugs and
// the public product shape. The public shape is an explicit whitelist — it is
// built field by field so a column added to `products` later can never leak
// (cost price, price tiers, exact stock counts and branch ids stay private).
import { getR2Config, publicUrl } from './r2';

export type Availability = 'IN_STOCK' | 'LOW' | 'OUT';

export interface StorefrontSettings {
  locationId: string | null;     // the branch the website sells from
  safetyBuffer: number;          // units held back from the website
  lowStockThreshold: number;     // at or below this many sellable units: LOW
  showQuantities: boolean;       // show customers the sellable count, not only In stock / Few left
}

export async function getSettings(db: any): Promise<StorefrontSettings> {
  const { results } = await db.prepare('SELECT key, value FROM storefront_settings').all();
  const map = new Map<string, string>((results || []).map((r: any) => [r.key, r.value]));
  const int = (k: string, d: number) => {
    const n = Number(map.get(k));
    return Number.isInteger(n) && n >= 0 ? n : d;
  };
  return {
    locationId: map.get('location_id') || null,
    safetyBuffer: int('safety_buffer', 0),
    lowStockThreshold: int('low_stock_threshold', 3),
    showQuantities: map.get('show_quantities') === '1',
  };
}

/** Units the website may sell for each product: on hand - reserved at the web branch. */
export async function sellableUnits(db: any, productIds: string[], locationId: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!productIds.length || !locationId) {
    for (const id of productIds) out.set(id, 0);
    return out;
  }
  const ph = productIds.map(() => '?').join(', ');
  const { results: prods } = await db.prepare(
    `SELECT id, COALESCE(product_type, 'STANDARD') AS product_type FROM products WHERE id IN (${ph})`,
  ).bind(...productIds).all();
  const groupedIds = (prods || []).filter((p: any) => p.product_type === 'GROUPED').map((p: any) => p.id as string);

  let components: any[] = [];
  if (groupedIds.length) {
    const gph = groupedIds.map(() => '?').join(', ');
    ({ results: components } = await db.prepare(
      `SELECT parent_product_id, component_product_id, quantity FROM product_group_items WHERE parent_product_id IN (${gph})`,
    ).bind(...groupedIds).all());
  }
  const stockIds = Array.from(new Set([
    ...productIds.filter((id) => !groupedIds.includes(id)),
    ...components.map((c: any) => c.component_product_id as string),
  ]));
  const stock = new Map<string, number>();
  if (stockIds.length) {
    const sph = stockIds.map(() => '?').join(', ');
    const { results } = await db.prepare(`
      SELECT product_id, COALESCE(SUM(quantity_on_hand - quantity_reserved), 0) AS available
      FROM inventory_stock
      WHERE owner_type = 'BRANCH' AND branch_id = ? AND product_id IN (${sph})
      GROUP BY product_id
    `).bind(locationId, ...stockIds).all();
    for (const r of results || []) stock.set((r as any).product_id, Number((r as any).available));
  }

  for (const id of productIds) {
    if (groupedIds.includes(id)) {
      const parts = components.filter((c: any) => c.parent_product_id === id);
      // A bundle is as available as its scarcest component.
      const n = parts.length
        ? Math.min(...parts.map((c: any) => Math.floor((stock.get(c.component_product_id) ?? 0) / Math.max(1, Number(c.quantity)))))
        : 0;
      out.set(id, Math.max(0, n));
    } else {
      out.set(id, Math.max(0, stock.get(id) ?? 0));
    }
  }
  return out;
}

// ── Stock reservations for web requests ──────────────────────────────────────

/**
 * The stock a set of request lines needs: grouped products (bundles) are
 * expanded into their components, and the same product from several lines is
 * added up. Sorted by product id so concurrent requests lock rows in the same
 * order (no deadlocks).
 */
export async function stockRequirements(
  db: any,
  lines: Array<{ productId: string; quantity: number }>,
): Promise<Array<{ productId: string; quantity: number }>> {
  const ids = Array.from(new Set(lines.map((l) => l.productId)));
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(', ');
  const { results: prods } = await db.prepare(
    `SELECT id, COALESCE(product_type, 'STANDARD') AS product_type FROM products WHERE id IN (${ph})`,
  ).bind(...ids).all();
  const grouped = new Set((prods || []).filter((p: any) => p.product_type === 'GROUPED').map((p: any) => p.id as string));
  let components: any[] = [];
  if (grouped.size) {
    const gph = Array.from(grouped).map(() => '?').join(', ');
    ({ results: components } = await db.prepare(
      `SELECT parent_product_id, component_product_id, quantity FROM product_group_items WHERE parent_product_id IN (${gph})`,
    ).bind(...grouped).all());
  }
  const need = new Map<string, number>();
  const add = (id: string, n: number) => need.set(id, (need.get(id) ?? 0) + n);
  for (const l of lines) {
    if (!grouped.has(l.productId)) { add(l.productId, l.quantity); continue; }
    for (const c of components.filter((x: any) => x.parent_product_id === l.productId)) {
      add(c.component_product_id, l.quantity * Math.max(1, Number(c.quantity)));
    }
  }
  return Array.from(need, ([productId, quantity]) => ({ productId, quantity })).sort((a, b) => a.productId.localeCompare(b.productId));
}

/**
 * One statement that, inside the request's transaction, locks the web branch's
 * stock row for a product, checks that enough is free (on hand - reserved -
 * safety buffer), reserves it and records the reservation. It affects no row
 * when the stock is not there, which rolls the whole request back (409).
 */
export function reserveStockStmt(
  db: any,
  r: { requestId: string; productId: string; quantity: number; branchId: string; buffer: number; productName: string | null },
) {
  return db.prepare(`
    WITH pick AS (
      SELECT id FROM inventory_stock
      WHERE owner_type = 'BRANCH' AND branch_id = ? AND product_id = ?
        AND quantity_on_hand - quantity_reserved - ? >= ?
      ORDER BY quantity_on_hand - quantity_reserved DESC
      LIMIT 1
      FOR UPDATE
    ), held AS (
      UPDATE inventory_stock s
      SET quantity_reserved = s.quantity_reserved + ?, updated_at = CURRENT_TIMESTAMP
      FROM pick
      WHERE s.id = pick.id AND s.quantity_on_hand - s.quantity_reserved - ? >= ?
      RETURNING s.id
    )
    INSERT INTO storefront_reservations (id, request_id, stock_id, product_id, quantity)
    SELECT gen_random_uuid()::text, ?, held.id, ?, ? FROM held
  `).bind(
    r.branchId, r.productId, r.buffer, r.quantity,
    r.quantity, r.buffer, r.quantity,
    r.requestId, r.productId, r.quantity,
  ).mustAffect(r.productName
    ? `Sorry, "${r.productName}" is not available in that quantity.`
    : 'Sorry, one of the items is not available in that quantity.');
}

/**
 * Releases a request's open reservations (by request, or by the sales order it
 * became). Safe to run more than once: released rows are skipped.
 */
export function releaseReservationsStmt(db: any, by: { requestId: string } | { orderId: string }, reason: string) {
  const match = 'requestId' in by
    ? 'request_id = ?'
    : 'request_id IN (SELECT id FROM storefront_requests WHERE converted_order_id = ?)';
  return db.prepare(`
    WITH released AS (
      UPDATE storefront_reservations SET released_at = CURRENT_TIMESTAMP, release_reason = ?
      WHERE released_at IS NULL AND ${match}
      RETURNING stock_id, quantity
    ), totals AS (
      SELECT stock_id, SUM(quantity) AS qty FROM released GROUP BY stock_id
    )
    UPDATE inventory_stock s
    SET quantity_reserved = GREATEST(0, s.quantity_reserved - totals.qty), updated_at = CURRENT_TIMESTAMP
    FROM totals WHERE s.id = totals.stock_id
  `).bind(reason, 'requestId' in by ? by.requestId : by.orderId);
}

export function availabilityOf(units: number, s: StorefrontSettings): Availability {
  const sellable = units - s.safetyBuffer;
  if (sellable <= 0) return 'OUT';
  return sellable <= s.lowStockThreshold ? 'LOW' : 'IN_STOCK';
}

export const sellableAfterBuffer = (units: number, s: StorefrontSettings) => Math.max(0, units - s.safetyBuffer);

export function slugify(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return base || 'product';
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function uniqueSlug(db: any, name: string, excludeProductId?: string): Promise<string> {
  const base = slugify(name);
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const row = await db.prepare('SELECT id FROM products WHERE slug = ? AND id <> ?').bind(candidate, excludeProductId ?? '').first();
    if (!row) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface PublicImage { url: string; alt: string | null }

export async function loadImages(db: any, productIds: string[]): Promise<Map<string, PublicImage[]>> {
  const map = new Map<string, PublicImage[]>();
  const cfg = getR2Config();
  if (!productIds.length || !cfg) return map;
  const ph = productIds.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT product_id, object_key, alt FROM product_images WHERE product_id IN (${ph}) ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
  ).bind(...productIds).all();
  for (const r of (results || []) as any[]) {
    const list = map.get(r.product_id) || [];
    list.push({ url: publicUrl(cfg, r.object_key), alt: r.alt ?? null });
    map.set(r.product_id, list);
  }
  return map;
}

/** How long a product counts as "new" after it is first published. */
export const NEW_FOR_DAYS = 30;

/** The only shape the public API ever returns for a product. */
export function toPublicProduct(row: any, images: PublicImage[], availability: Availability, unitsAvailable?: number) {
  const price = Number(row.selling_price);
  const compareAt = row.compare_at_price == null ? null : Number(row.compare_at_price);
  return {
    slug: row.slug as string,
    name: row.name as string,
    // Only the text written for the website: the ERP's own description can hold internal notes.
    description: (row.web_description || null) as string | null,
    price,
    // Only a real reduction is shown: a "was" price at or below today's price is ignored.
    compareAtPrice: compareAt != null && compareAt > price ? compareAt : null,
    // First published within the last NEW_FOR_DAYS days (the publish date itself stays private).
    isNew: row.published_at != null && Date.now() - new Date(row.published_at).getTime() < NEW_FOR_DAYS * 86_400_000,
    category: row.category_id ? { id: row.category_id as string, name: (row.category_name ?? null) as string | null } : null,
    images,
    availability,
    // Only when staff chose to show quantities (Online store settings).
    ...(unitsAvailable !== undefined ? { unitsAvailable } : {}),
  };
}

/**
 * Where a web order is, from the request through the sales order and its
 * delivery: NEW → ORDERED → INVOICED → PAID → DELIVERY_SCHEDULED →
 * OUT_FOR_DELIVERY → DELIVERED, or CANCELLED at any point.
 */
export function webOrderStage(r: { status: string; order_status?: string | null; delivery_status?: string | null }): string {
  if (r.status === 'CANCELLED' || r.order_status === 'CANCELLED') return 'CANCELLED';
  if (r.status !== 'CONVERTED') return 'NEW';
  if (r.order_status === 'DELIVERED' || r.delivery_status === 'DELIVERED') return 'DELIVERED';
  if (r.delivery_status === 'DISPATCHED') return 'OUT_FOR_DELIVERY';
  if (r.delivery_status === 'PENDING' || r.delivery_status === 'SCHEDULED') return 'DELIVERY_SCHEDULED';
  if (r.order_status === 'PAID') return 'PAID';
  if (r.order_status === 'INVOICED') return 'INVOICED';
  return 'ORDERED';
}

