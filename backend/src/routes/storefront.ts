// PUBLIC storefront API (no login). Read-only catalog plus order *requests*.
// Everything returned goes through toPublicProduct (an explicit whitelist).
// Request submission is server-to-server: the storefront's server calls it
// with STOREFRONT_API_KEY, so browsers never hold the key and strangers
// cannot post directly.
import { Hono } from 'hono';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Env, uuidv4 } from '../db';
import { getR2Config, publicUrl } from '../services/r2';
import {
  availabilityOf, getSettings, loadImages, reserveStockStmt, sellableAfterBuffer, sellableUnits, stockRequirements, toPublicProduct,
} from '../services/storefront';

const storefront = new Hono<{ Bindings: Env }>();

const PRODUCT_COLUMNS = `p.id, p.slug, p.name, p.web_description, p.selling_price, p.compare_at_price, p.published_at, p.category_id, c.name AS category_name`;
const PUBLISHED = `p.is_published = 1 AND COALESCE(p.is_active, 1) = 1 AND p.slug IS NOT NULL`;

const MAX_LINES = 20;
const MAX_QTY = 20;
const MAX_PER_IP_PER_HOUR = 5;
const MAX_PER_PHONE_PER_HOUR = 3;

function cacheable(c: any) {
  c.header('Cache-Control', 'public, max-age=60');
}

// Categories that have something on sale. Each gets a picture: the photo staff
// uploaded for the category, or else the main photo of one of its products.
storefront.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT cat.id, cat.name, cat.parent_id, cat.image_key, COUNT(p.id) AS product_count,
           (SELECT pi.object_key FROM product_images pi
              JOIN products p2 ON p2.id = pi.product_id
             WHERE p2.category_id = cat.id AND p2.is_published = 1 AND COALESCE(p2.is_active, 1) = 1 AND p2.slug IS NOT NULL
             ORDER BY p2.is_featured DESC, pi.is_primary DESC, p2.published_at DESC NULLS LAST, pi.sort_order ASC
             LIMIT 1) AS fallback_key
    FROM categories cat
    JOIN products p ON p.category_id = cat.id AND ${PUBLISHED}
    GROUP BY cat.id, cat.name, cat.parent_id, cat.image_key
    ORDER BY cat.name ASC
  `).all();
  const cfg = getR2Config();
  cacheable(c);
  return c.json((results || []).map((r: any) => {
    const key = r.image_key || r.fallback_key;
    return {
      id: r.id, name: r.name, parentId: r.parent_id ?? null, productCount: Number(r.product_count),
      image: cfg && key ? { url: publicUrl(cfg, key), alt: r.name } : null,
    };
  }));
});

// Fixed ORDER BY clauses, picked by the "sort" query value (never built from it).
const SORTS: Record<string, string> = {
  name: 'p.name ASC',
  new: 'p.published_at DESC NULLS LAST, p.name ASC',
  price_asc: 'p.selling_price ASC, p.name ASC',
  price_desc: 'p.selling_price DESC, p.name ASC',
};

storefront.get('/products', async (c) => {
  const page = Math.max(1, Math.floor(Number(c.req.query('page'))) || 1);
  const pageSize = Math.min(60, Math.max(1, Math.floor(Number(c.req.query('pageSize'))) || 24));
  const category = (c.req.query('category') || '').slice(0, 64);
  const q = (c.req.query('q') || '').trim().slice(0, 80);
  // sort=new: most recently published first; price_asc / price_desc by price. Anything else: by name.
  // featured=1 / sale=1 / minPrice / maxPrice narrow the list.
  const sortKey = c.req.query('sort') || '';
  const orderBy = Object.hasOwn(SORTS, sortKey) ? SORTS[sortKey] : SORTS.name;
  const featured = c.req.query('featured') === '1';
  const sale = c.req.query('sale') === '1';
  const priceBound = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const minPrice = priceBound(c.req.query('minPrice'));
  const maxPrice = priceBound(c.req.query('maxPrice'));

  let where = `WHERE ${PUBLISHED}`;
  const params: any[] = [];
  if (category) {
    where += ' AND (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))';
    params.push(category, category);
  }
  if (featured) where += ' AND p.is_featured = 1';
  if (sale) where += ' AND p.compare_at_price > p.selling_price';
  if (minPrice != null) { where += ' AND p.selling_price >= ?'; params.push(minPrice); }
  if (maxPrice != null) { where += ' AND p.selling_price <= ?'; params.push(maxPrice); }
  if (q) {
    where += ' AND p.name ILIKE ?';
    params.push(`%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
  }

  const base = `FROM products p LEFT JOIN categories c ON c.id = p.category_id ${where}`;
  const total = Number(((await c.env.DB.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...params).first()) as any)?.n ?? 0);
  const { results } = await c.env.DB.prepare(
    `SELECT ${PRODUCT_COLUMNS} ${base} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  ).bind(...params, pageSize, (page - 1) * pageSize).all();

  const rows = (results || []) as any[];
  const ids = rows.map((r) => r.id as string);
  const settings = await getSettings(c.env.DB);
  const [units, images] = await Promise.all([sellableUnits(c.env.DB, ids, settings.locationId), loadImages(c.env.DB, ids)]);

  cacheable(c);
  return c.json({
    items: rows.map((r) => toPublicProduct(r, images.get(r.id) || [], availabilityOf(units.get(r.id) ?? 0, settings))),
    page, pageSize, total,
  });
});

storefront.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug').slice(0, 100);
  const row = await c.env.DB.prepare(
    `SELECT ${PRODUCT_COLUMNS} FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${PUBLISHED} AND p.slug = ?`,
  ).bind(slug).first() as any;
  if (!row) return c.json({ message: 'Product not found' }, 404);
  const settings = await getSettings(c.env.DB);
  const [units, images] = await Promise.all([sellableUnits(c.env.DB, [row.id], settings.locationId), loadImages(c.env.DB, [row.id])]);
  cacheable(c);
  return c.json(toPublicProduct(row, images.get(row.id) || [], availabilityOf(units.get(row.id) ?? 0, settings)));
});

// ── Order requests ──────────────────────────────────────────────────────────

const keyHash = (v: string) => createHash('sha256').update(v).digest();
function keyMatches(presented: string | undefined): boolean {
  const expected = process.env.STOREFRONT_API_KEY;
  if (!expected || expected.length < 24 || !presented) return false;
  return timingSafeEqual(keyHash(presented), keyHash(expected));
}

const digitsOf = (s: string) => s.replace(/[^\d+]/g, '');
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

storefront.post('/requests', async (c) => {
  if (!process.env.STOREFRONT_API_KEY || process.env.STOREFRONT_API_KEY.length < 24) {
    return c.json({ message: 'Online requests are not available yet.' }, 503);
  }
  if (!keyMatches(c.req.header('x-storefront-key'))) return c.json({ message: 'Unauthorized' }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ message: 'Invalid request.' }, 400);

  // Honeypot: real visitors never see this field. Pretend success, store nothing.
  if (clean(body.website, 50)) return c.json({ requestNumber: 'WR-0', message: 'Request received.' }, 201);

  const name = clean(body.name, 100);
  const phone = digitsOf(clean(body.phone, 30));
  const email = clean(body.email, 120);
  if (!name) return c.json({ message: 'Please enter your name.' }, 400);
  if (phone.replace(/\D/g, '').length < 7) return c.json({ message: 'Please enter a valid phone number.' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ message: 'Please enter a valid email address.' }, 400);

  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > MAX_LINES) {
    return c.json({ message: `Add between 1 and ${MAX_LINES} items.` }, 400);
  }
  const wanted = new Map<string, number>();
  for (const line of body.lines) {
    const slug = clean(line?.slug, 100);
    const qty = Number(line?.quantity);
    if (!slug || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return c.json({ message: `Each item needs a product and a quantity from 1 to ${MAX_QTY}.` }, 400);
    }
    wanted.set(slug, Math.min(MAX_QTY, (wanted.get(slug) || 0) + qty));
  }

  // Throttle (counted before heavier work). The IP comes from the storefront's server.
  const ip = clean(c.req.header('x-client-ip'), 64) || 'unknown';
  const db = c.env.DB;
  await db.prepare(`DELETE FROM storefront_request_log WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '2 days'`).run();
  const counts = await db.prepare(`
    SELECT COUNT(*) FILTER (WHERE ip = ?)::int AS by_ip, COUNT(*) FILTER (WHERE phone = ?)::int AS by_phone
    FROM storefront_request_log WHERE created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
  `).bind(ip, phone).first() as any;
  if (Number(counts?.by_ip) >= MAX_PER_IP_PER_HOUR || Number(counts?.by_phone) >= MAX_PER_PHONE_PER_HOUR) {
    return c.json({ message: 'Too many requests. Please try again later or call us.' }, 429);
  }
  await db.prepare('INSERT INTO storefront_request_log (id, ip, phone) VALUES (?, ?, ?)').bind(uuidv4(), ip, phone).run();

  const settings = await getSettings(db);
  if (!settings.locationId) return c.json({ message: 'Online requests are not available yet.' }, 503);

  // Prices and products come from the database, never from the client.
  const slugs = Array.from(wanted.keys());
  const ph = slugs.map(() => '?').join(', ');
  const { results } = await db.prepare(
    `SELECT p.id, p.slug, p.name, p.selling_price FROM products p WHERE ${PUBLISHED} AND p.slug IN (${ph})`,
  ).bind(...slugs).all();
  const products = new Map<string, any>((results || []).map((r: any) => [r.slug, r]));
  for (const slug of slugs) {
    if (!products.has(slug)) return c.json({ message: 'One of the items is no longer available. Please refresh and try again.' }, 409);
  }
  const units = await sellableUnits(db, Array.from(products.values()).map((p) => p.id), settings.locationId);
  for (const [slug, qty] of wanted) {
    const p = products.get(slug);
    if (qty > sellableAfterBuffer(units.get(p.id) ?? 0, settings)) {
      return c.json({ message: `Sorry, "${p.name}" is not available in that quantity.` }, 409);
    }
  }

  const requestId = uuidv4();
  const requestNumber = `WR-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
  let total = 0;
  const lineStmts = [];
  for (const [slug, qty] of wanted) {
    const p = products.get(slug);
    total += Number(p.selling_price) * qty;
    lineStmts.push(db.prepare(
      'INSERT INTO storefront_request_lines (id, request_id, product_id, product_name, quantity, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(uuidv4(), requestId, p.id, p.name, qty, Number(p.selling_price)));
  }
  // Hold the stock in the same transaction: if another request took the last
  // units a moment ago, a reservation affects no row and nothing is saved.
  const needs = await stockRequirements(db, Array.from(wanted, ([slug, quantity]) => ({ productId: products.get(slug).id, quantity })));
  const names = new Map<string, string>(Array.from(products.values()).map((p) => [p.id, p.name]));
  const reserveStmts = needs.map((n) => reserveStockStmt(db, {
    requestId, productId: n.productId, quantity: n.quantity, branchId: settings.locationId as string,
    buffer: settings.safetyBuffer, productName: names.get(n.productId) ?? null, // a bundle's component has no name of its own here
  }));
  await db.batch([
    db.prepare(`
      INSERT INTO storefront_requests (id, request_number, customer_name, phone, email, address, city, notes, total_amount, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(requestId, requestNumber, name, phone, email || null, clean(body.address, 300) || null, clean(body.city, 100) || null,
      clean(body.notes, 500) || null, Math.round(total * 100) / 100, ip),
    ...lineStmts,
    ...reserveStmts,
  ]);
  return c.json({ requestNumber, message: 'Request received. We will contact you shortly to confirm.' }, 201);
});

export default storefront;
