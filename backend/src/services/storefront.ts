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

/** The only shape the public API ever returns for a product. */
export function toPublicProduct(row: any, images: PublicImage[], availability: Availability) {
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
    category: row.category_id ? { id: row.category_id as string, name: (row.category_name ?? null) as string | null } : null,
    images,
    availability,
  };
}
