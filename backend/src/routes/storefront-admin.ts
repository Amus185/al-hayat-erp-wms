// Staff-side storefront management (all routes require a login):
// settings, publishing, product photos, and the website order-request inbox.
import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware, requireAdmin, requirePermissions } from '../middleware/auth';
import { hasAllBranchAccess } from '../services/branch-scope';
import { logAudit } from '../services/audit';
import {
  ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, deleteObject, getR2Config, headObject, presignPut, publicUrl,
} from '../services/r2';
import {
  SLUG_PATTERN, availabilityOf, getSettings, releaseReservationsStmt, returnWebQuantityStmt, sellableAfterBuffer, sellableUnits, uniqueSlug, webOrderStage, webUnits,
} from '../services/storefront';

export { webOrderStage };
import sales from './sales';

const admin = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();
admin.use('/*', authMiddleware);

const MAX_IMAGES_PER_PRODUCT = 10;

// Path params are always present on the routes below; this keeps them typed as strings.
const param = (c: any, name: string): string => c.req.param(name) as string;

// ── Settings (administrators) ───────────────────────────────────────────────

admin.get('/settings', requireAdmin, async (c) => {
  const s = await getSettings(c.env.DB);
  const { results: branches } = await c.env.DB.prepare('SELECT id, name FROM branches ORDER BY name').all();
  return c.json({ ...s, locationType: 'BRANCH', branches: branches || [], imagesConfigured: Boolean(getR2Config()), requestsConfigured: Boolean(process.env.STOREFRONT_API_KEY) });
});

admin.patch('/settings', requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const writes: Array<[string, string]> = [];
  if (body.locationId !== undefined) {
    // Sales orders issue stock from a branch, so the website sells from a branch.
    const branch = await c.env.DB.prepare('SELECT id FROM branches WHERE id = ?').bind(String(body.locationId)).first();
    if (!branch) return c.json({ message: 'Choose an existing branch. (Warehouse stock must be transferred to a branch first.)' }, 400);
    writes.push(['location_id', String(body.locationId)]);
  }
  for (const [field, key] of [['safetyBuffer', 'safety_buffer'], ['lowStockThreshold', 'low_stock_threshold']] as const) {
    if (body[field] !== undefined) {
      const n = Number(body[field]);
      if (!Number.isInteger(n) || n < 0 || n > 1000) return c.json({ message: `${field} must be a whole number from 0 to 1000.` }, 400);
      writes.push([key, String(n)]);
    }
  }
  if (body.showQuantities !== undefined) writes.push(['show_quantities', body.showQuantities ? '1' : '0']);
  if (!writes.length) return c.json({ message: 'Nothing to update.' }, 400);
  const db = c.env.DB;
  await db.batch(writes.map(([k, v]) => db.prepare(`
    INSERT INTO storefront_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).bind(k, v)));
  await logAudit(c, 'STOREFRONT_SETTINGS_UPDATE', 'storefront_settings', null, null, Object.fromEntries(writes));
  return c.json(await getSettings(db));
});

// ── Online store overview and products (the ERP's Online store section) ────

/** Today's and open web orders, what is on the shop, and what is running low there. */
admin.get('/overview', async (c) => {
  const p = c.get('jwtPayload');
  if (!p.permissions.includes('manage_sales') && !p.permissions.includes('manage_inventory')) return c.json({ message: 'Forbidden' }, 403);
  const db = c.env.DB;
  const settings = await getSettings(db);
  const orders = await db.prepare(`
    SELECT COUNT(*) FILTER (WHERE status = 'NEW')::int AS awaiting,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP))::int AS today,
           COALESCE(SUM(total_amount) FILTER (WHERE created_at >= date_trunc('day', CURRENT_TIMESTAMP) AND status <> 'CANCELLED'), 0) AS today_value,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP))::int AS month,
           COALESCE(SUM(total_amount) FILTER (WHERE created_at >= date_trunc('month', CURRENT_TIMESTAMP) AND status <> 'CANCELLED'), 0) AS month_value
    FROM storefront_requests
  `).first() as any;
  const { results: published } = await db.prepare(
    `SELECT id, name FROM products WHERE is_published = 1 AND COALESCE(is_active, 1) = 1 AND slug IS NOT NULL ORDER BY name`,
  ).all();
  const list = (published || []) as any[];
  const units = await webUnits(db, list.map((r) => r.id), settings);
  const low = list
    .map((r) => ({ id: r.id, name: r.name, raw: units.get(r.id) ?? 0 }))
    .filter((r) => availabilityOf(r.raw, settings) !== 'IN_STOCK')
    .map((r) => ({ id: r.id, name: r.name, units: sellableAfterBuffer(r.raw, settings) }))
    .sort((a, b) => a.units - b.units)
    .slice(0, 20);
  const branch = settings.locationId ? await db.prepare('SELECT name FROM branches WHERE id = ?').bind(settings.locationId).first() as any : null;
  return c.json({
    orders: {
      awaiting: Number(orders?.awaiting || 0), today: Number(orders?.today || 0), todayValue: Number(orders?.today_value || 0),
      month: Number(orders?.month || 0), monthValue: Number(orders?.month_value || 0),
    },
    publishedProducts: list.length,
    lowOrOut: low,
    sellsFrom: branch?.name ?? null,
    imagesConfigured: Boolean(getR2Config()),
    requestsConfigured: Boolean(process.env.STOREFRONT_API_KEY),
  });
});

/** Every active product with its shop state: published, photos, price, sellable units at the web branch. */
admin.get('/products', requirePermissions(['manage_inventory']), async (c) => {
  const db = c.env.DB;
  const q = (c.req.query('search') || '').trim().slice(0, 80);
  const { results } = await db.prepare(`
    SELECT p.id, p.name, p.sku, p.selling_price, p.compare_at_price, p.is_published, p.is_featured, p.slug, p.web_quantity,
           COALESCE(cat.name, '') AS category,
           (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.id)::int AS photo_count,
           (SELECT pi.object_key FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order ASC LIMIT 1) AS photo_key
    FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
    WHERE COALESCE(p.is_active, 1) = 1 AND (? = '' OR p.name ILIKE ? OR p.sku ILIKE ?)
    ORDER BY p.is_published DESC, p.name LIMIT 500
  `).bind(q, `%${q}%`, `%${q}%`).all();
  const rows = (results || []) as any[];
  const settings = await getSettings(db);
  const units = await webUnits(db, rows.map((r) => r.id), settings);
  const cfg = getR2Config();
  return c.json(rows.map((r) => {
    const sellable = sellableAfterBuffer(units.get(r.id) ?? 0, settings);
    return {
      id: r.id, name: r.name, sku: r.sku, category: r.category || null,
      price: Number(r.selling_price), compareAtPrice: r.compare_at_price == null ? null : Number(r.compare_at_price),
      isPublished: Number(r.is_published) === 1, isFeatured: Number(r.is_featured) === 1, slug: r.slug ?? null,
      photoCount: Number(r.photo_count), photoUrl: cfg && r.photo_key ? publicUrl(cfg, r.photo_key) : null,
      webUnits: sellable, availability: availabilityOf(units.get(r.id) ?? 0, settings),
      webQuantity: r.web_quantity == null ? null : Number(r.web_quantity),
    };
  }));
});

// ── Product web fields and photos (manage_inventory) ────────────────────────

async function loadProduct(c: any, id: string) {
  return c.env.DB.prepare('SELECT id, name, selling_price, compare_at_price, is_featured, COALESCE(is_active, 1) AS is_active, is_published, slug, web_description, web_quantity FROM products WHERE id = ?').bind(id).first();
}

async function imagesOf(c: any, productId: string) {
  const cfg = getR2Config();
  const { results } = await c.env.DB.prepare(
    'SELECT id, object_key, alt, sort_order, is_primary FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, created_at ASC',
  ).bind(productId).all();
  return (results || []).map((r: any) => ({
    id: r.id, key: r.object_key, alt: r.alt ?? null, sortOrder: Number(r.sort_order), isPrimary: Number(r.is_primary) === 1,
    url: cfg ? publicUrl(cfg, r.object_key) : null,
  }));
}

/** Validate an upload request and return a presigned URL for a new object under `prefix`. */
function presignUpload(c: any, prefix: string, body: any) {
  const cfg = getR2Config();
  if (!cfg) return c.json({ message: 'Photo storage is not configured yet.' }, 503);
  const ext = ALLOWED_IMAGE_TYPES[String(body.contentType)];
  const size = Number(body.size);
  if (!ext) return c.json({ message: 'Only JPEG, PNG or WebP photos are allowed.' }, 400);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) return c.json({ message: 'Photos must be 5 MB or smaller.' }, 400);
  const key = `${prefix}${uuidv4()}.${ext}`;
  return c.json({ key, uploadUrl: presignPut(cfg, key, String(body.contentType), size), expiresInSeconds: 300 });
}

/**
 * Check what actually landed in storage before trusting an upload: it must
 * exist under the expected prefix, be an accepted image type, and be within
 * the size limit. Bad uploads are deleted. Returns an error response or null.
 */
async function verifyUpload(c: any, prefix: string, key: string): Promise<Response | null> {
  const cfg = getR2Config();
  if (!cfg) return c.json({ message: 'Photo storage is not configured yet.' }, 503);
  if (!key.startsWith(prefix) || key.includes('..') || key.length > 200) return c.json({ message: 'Invalid photo.' }, 400);
  const head = await headObject(cfg, key).catch(() => null);
  if (!head) return c.json({ message: 'The photo was not uploaded.' }, 400);
  if (head.size > MAX_IMAGE_BYTES || !ALLOWED_IMAGE_TYPES[head.contentType.split(';')[0]]) {
    await deleteObject(cfg, key).catch(() => {});
    return c.json({ message: 'The uploaded file is not an accepted photo.' }, 400);
  }
  return null;
}

const productWebView = async (c: any, p: any) => ({
  id: p.id, name: p.name, isPublished: Number(p.is_published) === 1, slug: p.slug ?? null,
  webDescription: p.web_description ?? null,
  sellingPrice: Number(p.selling_price),
  compareAtPrice: p.compare_at_price == null ? null : Number(p.compare_at_price),
  isFeatured: Number(p.is_featured) === 1,
  webQuantity: p.web_quantity == null ? null : Number(p.web_quantity),
  ...(await webStockOf(c, p.id)),
  images: await imagesOf(c, p.id),
});

/** Where the shop sells from and how much of this product is there (after the safety buffer). */
async function webStockOf(c: any, productId: string) {
  const settings = await getSettings(c.env.DB);
  const units = await sellableUnits(c.env.DB, [productId], settings.locationId);
  const branch = settings.locationId
    ? await c.env.DB.prepare('SELECT name FROM branches WHERE id = ?').bind(settings.locationId).first() as any
    : null;
  return { sellsFrom: branch?.name ?? null, stockAtWebBranch: sellableAfterBuffer(units.get(productId) ?? 0, settings) };
}

admin.get('/products/:id', requirePermissions(['manage_inventory']), async (c) => {
  const p = await loadProduct(c, param(c, 'id')) as any;
  if (!p) return c.json({ message: 'Product not found.' }, 404);
  return c.json(await productWebView(c, p));
});

admin.patch('/products/:id', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const p = await loadProduct(c, id) as any;
  if (!p) return c.json({ message: 'Product not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));

  let slug: string | null = p.slug ?? null;
  if (body.slug !== undefined) {
    const wanted = String(body.slug).trim().toLowerCase();
    if (!SLUG_PATTERN.test(wanted) || wanted.length > 80) return c.json({ message: 'The web address may only use lowercase letters, numbers and dashes.' }, 400);
    const clash = await c.env.DB.prepare('SELECT id FROM products WHERE slug = ? AND id <> ?').bind(wanted, id).first();
    if (clash) return c.json({ message: 'Another product already uses that web address.' }, 409);
    slug = wanted;
  }
  const publish = body.isPublished === undefined ? Number(p.is_published) === 1 : Boolean(body.isPublished);
  if (publish) {
    if (Number(p.is_active) !== 1) return c.json({ message: 'An inactive product cannot be published.' }, 400);
    if (!(Number(p.selling_price) > 0)) return c.json({ message: 'Set a selling price before publishing.' }, 400);
    const imageCount = Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').bind(id).first()) as any)?.n ?? 0);
    if (imageCount === 0) return c.json({ message: 'Add at least one photo before publishing.' }, 400);
    if (!slug) slug = await uniqueSlug(c.env.DB, p.name, id);
  }
  const description = body.webDescription === undefined ? p.web_description : (String(body.webDescription).trim().slice(0, 4000) || null);

  // "Was" price: display only. It must be a real reduction from today's price.
  let compareAt: number | null = p.compare_at_price == null ? null : Number(p.compare_at_price);
  if (body.compareAtPrice !== undefined) {
    if (body.compareAtPrice === null || body.compareAtPrice === '') {
      compareAt = null;
    } else {
      const n = Number(body.compareAtPrice);
      if (!Number.isFinite(n) || n <= Number(p.selling_price) || n > 10_000_000) {
        return c.json({ message: 'The "was" price must be higher than the current selling price.' }, 400);
      }
      compareAt = Math.round(n * 100) / 100;
    }
  }
  const featured = body.isFeatured === undefined ? Number(p.is_featured) === 1 : Boolean(body.isFeatured);

  // Units for sale online: empty = all stock at the web branch; a number = at most that many.
  let webQuantity: number | null = p.web_quantity == null ? null : Number(p.web_quantity);
  if (body.webQuantity !== undefined) {
    if (body.webQuantity === null || body.webQuantity === '') {
      webQuantity = null;
    } else {
      const n = Number(body.webQuantity);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return c.json({ message: 'Units for sale online must be a whole number, 0 or more.' }, 400);
      webQuantity = n;
    }
  }

  await c.env.DB.prepare(`
    UPDATE products SET is_published = ?, slug = ?, web_description = ?, compare_at_price = ?, is_featured = ?, web_quantity = ?,
           published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END,
           updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(publish ? 1 : 0, slug, description, compareAt, featured ? 1 : 0, webQuantity, publish ? 1 : 0, id).run();
  await logAudit(c, publish ? 'PRODUCT_PUBLISH' : 'PRODUCT_UNPUBLISH', 'products', id,
    { isPublished: Number(p.is_published) === 1, compareAtPrice: p.compare_at_price ?? null, isFeatured: Number(p.is_featured) === 1, webQuantity: p.web_quantity ?? null },
    { isPublished: publish, slug, compareAtPrice: compareAt, isFeatured: featured, webQuantity });
  return c.json(await productWebView(c, await loadProduct(c, id)));
});

admin.post('/products/:id/images/presign', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  if (!(await loadProduct(c, id))) return c.json({ message: 'Product not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const count = Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').bind(id).first()) as any)?.n ?? 0);
  if (count >= MAX_IMAGES_PER_PRODUCT) return c.json({ message: `A product can have at most ${MAX_IMAGES_PER_PRODUCT} photos.` }, 400);
  return presignUpload(c, `products/${id}/`, body);
});

admin.post('/products/:id/images', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  if (!(await loadProduct(c, id))) return c.json({ message: 'Product not found.' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || '');
  const rejected = await verifyUpload(c, `products/${id}/`, key);
  if (rejected) return rejected;
  const existing = await c.env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), -1) AS max_order FROM product_images WHERE product_id = ?').bind(id).first() as any;
  const imageId = uuidv4();
  await c.env.DB.prepare(
    'INSERT INTO product_images (id, product_id, object_key, alt, sort_order, is_primary) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(imageId, id, key, String(body.alt || '').trim().slice(0, 200) || null, Number(existing.max_order) + 1, Number(existing.n) === 0 ? 1 : 0).run();
  return c.json({ images: await imagesOf(c, id) }, 201);
});

admin.patch('/products/:id/images/order', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const body = await c.req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.imageIds) ? body.imageIds.map(String) : [];
  const current = (await imagesOf(c, id)).map((img: { id: string }) => img.id);
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((x) => current.includes(x))) {
    return c.json({ message: 'List every photo of this product exactly once.' }, 400);
  }
  const db = c.env.DB;
  await db.batch(ids.map((imageId: string, i: number) => db.prepare(
    'UPDATE product_images SET sort_order = ?, is_primary = ? WHERE id = ? AND product_id = ?',
  ).bind(i, i === 0 ? 1 : 0, imageId, id)));
  return c.json({ images: await imagesOf(c, id) });
});

admin.delete('/products/:id/images/:imageId', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const imageId = param(c, 'imageId');
  const img = await c.env.DB.prepare('SELECT id, object_key, is_primary FROM product_images WHERE id = ? AND product_id = ?').bind(imageId, id).first() as any;
  if (!img) return c.json({ message: 'Photo not found.' }, 404);
  const product = await loadProduct(c, id) as any;
  const remaining = Number(((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM product_images WHERE product_id = ?').bind(id).first()) as any)?.n ?? 0);
  if (Number(product.is_published) === 1 && remaining <= 1) {
    return c.json({ message: 'A published product needs at least one photo. Unpublish it first.' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(imageId).run();
  if (Number(img.is_primary) === 1) {
    await c.env.DB.prepare(`
      UPDATE product_images SET is_primary = 1
      WHERE id = (SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1)
    `).bind(id).run();
  }
  const cfg = getR2Config();
  if (cfg) await deleteObject(cfg, img.object_key).catch((e) => console.error('R2 delete failed:', e?.message));
  return c.json({ images: await imagesOf(c, id) });
});

// ── Category photos for the website (manage_inventory) ─────────────────────

admin.get('/categories', requirePermissions(['manage_inventory']), async (c) => {
  const cfg = getR2Config();
  const { results } = await c.env.DB.prepare(`
    SELECT cat.id, cat.name, cat.image_key,
           (SELECT COUNT(*) FROM products p WHERE p.category_id = cat.id AND p.is_published = 1 AND COALESCE(p.is_active, 1) = 1) AS published_count
    FROM categories cat ORDER BY cat.name
  `).all();
  return c.json((results || []).map((r: any) => ({
    id: r.id, name: r.name, publishedCount: Number(r.published_count),
    imageUrl: cfg && r.image_key ? publicUrl(cfg, r.image_key) : null,
  })));
});

admin.post('/categories/:id/image/presign', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(id).first();
  if (!cat) return c.json({ message: 'Category not found.' }, 404);
  return presignUpload(c, `categories/${id}/`, await c.req.json().catch(() => ({})));
});

admin.post('/categories/:id/image', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const cat = await c.env.DB.prepare('SELECT id, image_key FROM categories WHERE id = ?').bind(id).first() as any;
  if (!cat) return c.json({ message: 'Category not found.' }, 404);
  const key = String((await c.req.json().catch(() => ({}))).key || '');
  const rejected = await verifyUpload(c, `categories/${id}/`, key);
  if (rejected) return rejected;
  await c.env.DB.prepare('UPDATE categories SET image_key = ? WHERE id = ?').bind(key, id).run();
  const cfg = getR2Config();
  if (cfg && cat.image_key && cat.image_key !== key) await deleteObject(cfg, cat.image_key).catch(() => {});
  return c.json({ id, imageUrl: cfg ? publicUrl(cfg, key) : null }, 201);
});

admin.delete('/categories/:id/image', requirePermissions(['manage_inventory']), async (c) => {
  const id = param(c, 'id');
  const cat = await c.env.DB.prepare('SELECT id, image_key FROM categories WHERE id = ?').bind(id).first() as any;
  if (!cat) return c.json({ message: 'Category not found.' }, 404);
  await c.env.DB.prepare('UPDATE categories SET image_key = NULL WHERE id = ?').bind(id).run();
  const cfg = getR2Config();
  if (cfg && cat.image_key) await deleteObject(cfg, cat.image_key).catch(() => {});
  return c.json({ id, imageUrl: null });
});

// ── Website order requests (manage_sales; web branch or all-branch users) ──

async function assertRequestsAccess(c: any): Promise<Response | null> {
  const payload = c.get('jwtPayload');
  if (hasAllBranchAccess(payload)) return null;
  const s = await getSettings(c.env.DB);
  if (s.locationId && payload.branch_id === s.locationId) return null;
  return c.json({ message: 'Website requests are handled by the web branch and administrators.' }, 403);
}

admin.get('/requests', requirePermissions(['manage_sales']), async (c) => {
  const denied = await assertRequestsAccess(c);
  if (denied) return denied;
  const status = (c.req.query('status') || '').toUpperCase();
  const { results } = await c.env.DB.prepare(`
    SELECT r.id, r.request_number, r.customer_name, r.phone, r.status, r.total_amount, r.created_at, r.converted_order_id,
           (SELECT COUNT(*) FROM storefront_request_lines l WHERE l.request_id = r.id) AS line_count,
           so.order_number, so.status AS order_status,
           (SELECT d.status FROM deliveries d WHERE d.sales_order_id = so.id AND d.status <> 'CANCELLED'
             ORDER BY d.created_at DESC LIMIT 1) AS delivery_status,
           (SELECT COALESCE(SUM(sr.quantity), 0) FROM storefront_reservations sr
             WHERE sr.request_id = r.id AND sr.released_at IS NULL)::int AS reserved_units
    FROM storefront_requests r
    LEFT JOIN sales_orders so ON so.id = r.converted_order_id
    WHERE (? = '' OR r.status = ?)
    ORDER BY r.created_at DESC LIMIT 200
  `).bind(status, status).all();
  return c.json((results || []).map((r: any) => ({ ...r, stage: webOrderStage(r) })));
});

admin.get('/requests/:id', requirePermissions(['manage_sales']), async (c) => {
  const denied = await assertRequestsAccess(c);
  if (denied) return denied;
  const r = await c.env.DB.prepare('SELECT * FROM storefront_requests WHERE id = ?').bind(param(c, 'id')).first();
  if (!r) return c.json({ message: 'Request not found.' }, 404);
  const { results: lines } = await c.env.DB.prepare(
    'SELECT product_id, product_name, quantity, unit_price FROM storefront_request_lines WHERE request_id = ?',
  ).bind(param(c, 'id')).all();
  return c.json({ ...(r as any), lines: lines || [] });
});

admin.post('/requests/:id/cancel', requirePermissions(['manage_sales']), async (c) => {
  const denied = await assertRequestsAccess(c);
  if (denied) return denied;
  const userId = c.get('jwtPayload').sub;
  const db = c.env.DB;
  // Cancelling and freeing the held stock happen together, or not at all.
  await db.batch([
    db.prepare(`
      UPDATE storefront_requests SET status = 'CANCELLED', handled_by = ?, handled_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'NEW'
    `).bind(userId, param(c, 'id')).mustAffect('Only new requests can be cancelled.'),
    releaseReservationsStmt(db, { requestId: param(c, 'id') }, 'Request cancelled'),
    returnWebQuantityStmt(db, { requestId: param(c, 'id') }),
  ]);
  await logAudit(c, 'STOREFRONT_REQUEST_CANCEL', 'storefront_requests', param(c, 'id'));
  return c.json({ success: true });
});

/**
 * Turn a request into a normal sales order. The order is created through the
 * sales route itself (internal call with the caller's token), so branch
 * scope, validation and permissions are exactly those of POST /sales/orders.
 * Nothing is paid or deducted yet: staff complete the sale in the usual way.
 */
admin.post('/requests/:id/convert', requirePermissions(['manage_sales']), async (c) => {
  const denied = await assertRequestsAccess(c);
  if (denied) return denied;
  const id = param(c, 'id');
  const db = c.env.DB;
  const settings = await getSettings(db);
  if (!settings.locationId) return c.json({ message: 'Choose the web branch in the storefront settings first.' }, 400);

  const claim = await db.prepare(`UPDATE storefront_requests SET status = 'PROCESSING' WHERE id = ? AND status = 'NEW' RETURNING *`).bind(id).all();
  const req = claim.results?.[0] as any;
  if (!req) return c.json({ message: 'This request was already handled, or does not exist.' }, 409);

  const revert = () => db.prepare(`UPDATE storefront_requests SET status = 'NEW' WHERE id = ? AND status = 'PROCESSING'`).bind(id).run();
  try {
    const { results: lines } = await db.prepare(
      'SELECT product_id, quantity, unit_price FROM storefront_request_lines WHERE request_id = ?',
    ).bind(id).all();

    const normalized = String(req.phone).replace(/[^\d+]/g, '');
    let customer = await db.prepare(`SELECT id FROM customers WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = ? LIMIT 1`).bind(normalized).first() as any;
    if (!customer) {
      const customerId = uuidv4();
      await db.prepare('INSERT INTO customers (id, name, phone, email, address) VALUES (?, ?, ?, ?, ?)')
        .bind(customerId, req.customer_name, req.phone, req.email || null, [req.address, req.city].filter(Boolean).join(', ') || null).run();
      customer = { id: customerId };
    }

    const res = await sales.fetch(new Request('http://internal/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: c.req.header('Authorization') || '' },
      body: JSON.stringify({
        branchId: settings.locationId,
        customerId: customer.id,
        fulfillmentType: 'DELIVERY',
        lines: (lines || []).map((l: any) => ({ productId: l.product_id, quantity: Number(l.quantity), unitPrice: Number(l.unit_price) })),
      }),
    }), c.env as any);
    const order: any = await res.json().catch(() => ({}));
    if (res.status !== 201 || !order?.id) {
      await revert();
      return c.json({ message: order?.message || 'The sales order could not be created.' }, (res.status >= 400 && res.status < 600 ? res.status : 400) as any);
    }
    await db.prepare(`
      UPDATE storefront_requests SET status = 'CONVERTED', converted_order_id = ?, handled_by = ?, handled_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(order.id, c.get('jwtPayload').sub, id).run();
    await logAudit(c, 'STOREFRONT_REQUEST_CONVERT', 'storefront_requests', id, null, { orderId: order.id });
    return c.json({ orderId: order.id, orderNumber: order.order_number ?? null }, 201);
  } catch (err) {
    await revert().catch(() => {});
    throw err;
  }
});

export default admin;
