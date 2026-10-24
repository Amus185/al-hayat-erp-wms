// LOCAL DEVELOPMENT ONLY: fill a local database with a sample furniture
// catalog (Unsplash photos, or drawn illustrations when offline) so the website
// and the admin panel can be tried without real data. Needs the backend to have run
// once against the database (it creates the tables) and the local photo store
// running (backend/scripts/dev-photo-store.mjs). Refuses non-local databases.
//
//   DATABASE_URL=postgresql://postgres:...@localhost:5432/alhayat_local node backend/scripts/dev-demo-catalog.mjs
import pg from 'pg';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const raw = process.env.DATABASE_URL;
if (!raw) { console.error('Set DATABASE_URL to your LOCAL database first.'); process.exit(1); }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(raw).hostname)) {
  console.error('Refusing: this is not a local database. This script is for local testing only.');
  process.exit(1);
}
const PHOTO_STORE = (process.env.DEV_PHOTO_STORE_URL || 'http://127.0.0.1:9100').replace(/\/$/, '');
const BUCKET = process.env.R2_BUCKET || 'photos';

const db = new pg.Client(raw);
await db.connect();
for (let i = 0; i < 60; i++) {
  const r = await db.query("SELECT to_regclass('storefront_settings') s, to_regclass('product_images') p");
  const c = await db.query("SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='compare_at_price'");
  if (r.rows[0].s && r.rows[0].p && c.rowCount) break;
  await new Promise((res) => setTimeout(res, 1000));
}

// ── tiny rasteriser ─────────────────────────────────────────────────────────
const W = 800, H = 800;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function canvas(bg) { const px = Buffer.alloc(W * H * 3); const [r, g, b] = hex(bg); for (let i = 0; i < W * H; i++) { px[i * 3] = r; px[i * 3 + 1] = g; px[i * 3 + 2] = b; } return px; }
function blend(px, x, y, rgb, a = 1) { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + rgb[k] * a); }
function rect(px, x0, y0, x1, y1, color, rad = 0, a = 1) {
  const rgb = hex(color);
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++) {
    let inside = true;
    if (rad) {
      const cx = x < x0 + rad ? x0 + rad : x > x1 - rad ? x1 - rad : x;
      const cy = y < y0 + rad ? y0 + rad : y > y1 - rad ? y1 - rad : y;
      inside = (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
    }
    if (inside) blend(px, x, y, rgb, a);
  }
}
function ellipse(px, cx, cy, rx, ry, color, a = 1) {
  const rgb = hex(color);
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) blend(px, x, y, rgb, a * Math.min(1, (1 - d) * 3));
  }
}
const shade = (h, f) => '#' + hex(h).map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0')).join('');
function scene(bg) { const px = canvas(bg); rect(px, 0, 600, W, H, shade(bg, 0.94)); return px; }

const draw = {
  sofa(c) { const px = scene('#f3efe8'); ellipse(px, 400, 600, 330, 26, '#000000', 0.12);
    rect(px, 140, 250, 660, 440, shade(c, 0.85), 40); rect(px, 110, 400, 690, 520, c, 34);
    rect(px, 90, 330, 175, 540, shade(c, 0.92), 36); rect(px, 625, 330, 710, 540, shade(c, 0.92), 36);
    rect(px, 200, 300, 330, 420, shade(c, 1.12), 26); rect(px, 470, 300, 600, 420, shade(c, 1.12), 26);
    for (const x of [140, 640]) rect(px, x, 535, x + 18, 590, '#6b4a2b', 4); return px; },
  armchair(c) { const px = scene('#eef1ea'); ellipse(px, 400, 600, 220, 22, '#000000', 0.12);
    rect(px, 250, 230, 550, 450, shade(c, 0.85), 50); rect(px, 230, 410, 570, 520, c, 34);
    rect(px, 200, 320, 280, 540, shade(c, 0.93), 36); rect(px, 520, 320, 600, 540, shade(c, 0.93), 36);
    for (const x of [235, 550]) rect(px, x, 535, x + 16, 590, '#b8893a', 4); return px; },
  table(c) { const px = scene('#f4efe6'); ellipse(px, 400, 600, 300, 20, '#000000', 0.12);
    rect(px, 110, 330, 690, 365, c, 10); rect(px, 130, 362, 670, 380, shade(c, 0.8), 4);
    for (const x of [150, 630]) rect(px, x, 375, x + 24, 590, shade(c, 0.85), 6);
    ellipse(px, 400, 315, 60, 14, '#d9d4c7'); rect(px, 385, 250, 415, 318, '#8fae8b', 8); return px; },
  chair(c) { const px = scene('#f2efe9'); ellipse(px, 400, 600, 150, 16, '#000000', 0.12);
    rect(px, 300, 180, 500, 380, c, 30); rect(px, 280, 380, 520, 440, shade(c, 0.9), 18);
    for (const x of [295, 488]) rect(px, x, 435, x + 16, 590, '#7a5533', 5); return px; },
  bed(c) { const px = scene('#efece6'); ellipse(px, 400, 600, 340, 22, '#000000', 0.12);
    rect(px, 120, 170, 680, 400, shade(c, 0.85), 24); rect(px, 90, 360, 710, 470, '#f7f4ee', 20);
    rect(px, 90, 410, 710, 540, c, 20); rect(px, 160, 300, 380, 380, '#ffffff', 22); rect(px, 420, 300, 640, 380, '#ffffff', 22);
    for (const x of [110, 672]) rect(px, x, 535, x + 18, 590, '#6b4a2b', 4); return px; },
  bookcase(c) { const px = scene('#f1eee8'); ellipse(px, 400, 600, 210, 18, '#000000', 0.12);
    rect(px, 220, 120, 580, 590, c, 8); rect(px, 240, 140, 560, 575, shade(c, 1.35), 4);
    const books = ['#2f6b4f', '#c9a227', '#8c3b3b', '#3d5a80', '#d17a22', '#5b8c5a'];
    for (let s = 0; s < 4; s++) { const y = 150 + s * 108; rect(px, 240, y + 96, 560, y + 106, c, 0);
      let x = 255; for (let b = 0; b < 8; b++) { const w = 22 + (b * 7) % 18; rect(px, x, y + 20 + (b % 3) * 8, x + w, y + 96, books[(b + s) % books.length], 3); x += w + 6; } }
    return px; },
  coffee(c) { const px = scene('#f4f0ea'); ellipse(px, 400, 590, 250, 22, '#000000', 0.12);
    ellipse(px, 400, 400, 240, 60, shade(c, 0.85)); ellipse(px, 400, 390, 240, 60, c);
    rect(px, 300, 420, 320, 580, '#2b2b2b', 6); rect(px, 480, 420, 500, 580, '#2b2b2b', 6); rect(px, 390, 430, 410, 590, '#2b2b2b', 6);
    rect(px, 360, 330, 440, 370, '#9fc29a', 10); return px; },
  nightstand(c) { const px = scene('#f0ede7'); ellipse(px, 400, 600, 150, 16, '#000000', 0.12);
    rect(px, 280, 300, 520, 560, c, 12); rect(px, 300, 330, 500, 430, shade(c, 1.12), 8); rect(px, 300, 450, 500, 540, shade(c, 1.12), 8);
    rect(px, 380, 375, 420, 385, '#c9a227', 3); rect(px, 380, 490, 420, 500, '#c9a227', 3);
    rect(px, 370, 200, 430, 300, '#e9e2cf', 12); rect(px, 395, 160, 405, 205, '#3a3a3a', 2); return px; },
};

const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(px) {
  const rows = []; for (let y = 0; y < H; y++) { rows.push(Buffer.from([0])); rows.push(px.subarray(y * W * 3, (y + 1) * W * 3)); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
async function put(key, body, type) {
  const res = await fetch(`${PHOTO_STORE}/${BUCKET}/` + key, { method: 'PUT', headers: { 'Content-Type': type }, body });
  if (!res.ok) throw new Error('photo store refused ' + res.status + ' (is backend/scripts/dev-photo-store.mjs running?)');
}

// Real furniture photos from Unsplash (Unsplash License: free to use, no
// permission needed; photographers credited below). Downloaded here and
// uploaded to the local photo store, the same way a staff upload ends up in R2.
// Without internet the drawn illustrations are used instead.
let online = true;
async function photo(id) {
  if (!online) return null;
  try {
    const res = await fetch(`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&h=1200&q=80&fm=jpg`, { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) throw new Error(String(res.status));
    return { body: Buffer.from(await res.arrayBuffer()), type: type.split(';')[0] };
  } catch (err) {
    online = false;
    console.warn(`Could not download photos (${err.message}); using drawn pictures instead.`);
    return null;
  }
}

// ── catalog ─────────────────────────────────────────────────────────────────
const HQ = 'branch-hq-main';
const cats = [['cat-living', 'Living Room'], ['cat-bedroom', 'Bedroom'], ['cat-dining', 'Dining Room'], ['cat-office', 'Office']];
for (const [id, name] of cats) await db.query('INSERT INTO categories (id, code, name) VALUES ($1, $1, $2) ON CONFLICT (id) DO NOTHING', [id, name]);
await db.query(`INSERT INTO storefront_settings (key, value) VALUES ('location_id', $1), ('safety_buffer', '0'), ('low_stock_threshold', '3')
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [HQ]);

// photos: [Unsplash photo id, photographer]
const items = [
  { name: 'Oslo Corner Sofa', cat: 'cat-living', kind: 'sofa', color: '#4f7a46', price: 650, was: 799, stock: 8, featured: 1, days: 1,
    desc: 'Deep-seated three-seat sofa in olive fabric with solid oak legs.\n280 × 95 cm · Removable, washable covers.',
    photos: [['photo-1555041469-a586c61ea9bc', 'Phillip Goldsberry'], ['photo-1493663284031-b7e3aefcae8e', 'Nathan Fertig']] },
  { name: 'Velvet Accent Armchair', cat: 'cat-living', kind: 'armchair', color: '#6d7d3a', price: 279, was: null, stock: 2, featured: 0, days: 3,
    desc: 'Curved accent armchair with a padded seat on a solid wood frame.',
    photos: [['photo-1586023492125-27b2c045efd7', 'Kam Idris'], ['photo-1580480055273-228ff5388ef8', 'SCOPIC LTD']] },
  { name: 'Nordic Dining Table', cat: 'cat-dining', kind: 'table', color: '#b0814f', price: 599, was: 669, stock: 5, featured: 1, days: 6,
    desc: 'Solid wood table that seats six. 180 × 90 cm.',
    photos: [['photo-1505409628601-edc9af17fda6', 'yann maignan'], ['photo-1602872030490-4a484a7b3ba6', 'Jonathan Borba']] },
  { name: 'Linen Dining Chair', cat: 'cat-dining', kind: 'chair', color: '#cdbb9a', price: 89, was: 110, stock: 24, featured: 0, days: 9,
    desc: 'Upholstered dining chair with wooden legs.',
    photos: [['photo-1598300042247-d088f8ab3a91', 'Sam Moghadam'], ['photo-1592078615290-033ee584e267', 'Suchit Poojari']] },
  { name: 'Haven Storage Bed', cat: 'cat-bedroom', kind: 'bed', color: '#8a9a7b', price: 749, was: 849, stock: 4, featured: 1, days: 2,
    desc: 'Queen bed with lift-up storage and a padded headboard.',
    photos: [['photo-1595526114035-0d45ed16cfbf', 'Lotus Design N Print'], ['photo-1562438668-bcf0ca6578f0', '刘 强']] },
  { name: 'Walnut Bookcase', cat: 'cat-office', kind: 'bookcase', color: '#6b4a2b', price: 229, was: null, stock: 7, featured: 0, days: 12,
    desc: 'Five-shelf bookcase in walnut veneer.',
    photos: [['photo-1593430980369-68efc5a5eb34', 'Pickawood'], ['photo-1603058817990-2b9a9abbce86', 'Eilis Garvey']] },
  { name: 'Round Coffee Table', cat: 'cat-living', kind: 'coffee', color: '#a0703f', price: 199, was: null, stock: 10, featured: 0, days: 4,
    desc: 'Oak top on a black steel base. Ø 90 cm.',
    photos: [['photo-1581428982868-e410dd047a90', 'Lui Peng'], ['photo-1758565811033-84d1365000c6', 'Caroline Badran']] },
  { name: 'Cloud Three-Seater', cat: 'cat-living', kind: 'sofa', color: '#9aa3a8', price: 820, was: null, stock: 0, featured: 0, days: 15,
    desc: 'Soft three-seat sofa in grey fabric. Back in stock soon.',
    photos: [['photo-1634497885778-152eb6fd543d', 'Hadi Yazdi Aznaveh'], ['photo-1698936061086-2bf99c7b9fc5', 'Ambo Ampeng']] },
  { name: 'Oak Bedside Table', cat: 'cat-bedroom', kind: 'nightstand', color: '#c49a63', price: 129, was: 149, stock: 12, featured: 0, days: 5,
    desc: 'Bedside table with drawers and brass handles.',
    photos: [['photo-1522771739844-6a9f6d5f14af', 'Christopher Jolly'], ['photo-1771287490579-afd6e8d3c09a', 'Franco Debartolo']] },
];

let real = 0;
for (const it of items) {
  const slug = it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // Safe to run again (e.g. after restarting the photo store): products are reused by slug.
  const existing = await db.query('SELECT id FROM products WHERE slug = $1', [slug]);
  const id = existing.rows[0]?.id ?? crypto.randomUUID();
  if (existing.rowCount) {
    await db.query(`UPDATE products SET web_description = $2, category_id = $3, selling_price = $4, compare_at_price = $5, is_published = 1, is_featured = $6 WHERE id = $1`,
      [id, it.desc, it.cat, it.price, it.was, it.featured]);
    await db.query('DELETE FROM product_images WHERE product_id = $1', [id]);
    await db.query("UPDATE inventory_stock SET quantity_on_hand = $2 WHERE product_id = $1 AND owner_type = 'BRANCH' AND branch_id = $3", [id, it.stock, HQ]);
  } else {
    await db.query(`INSERT INTO products (id, sku, name, description, web_description, category_id, cost_price, selling_price, compare_at_price,
                      is_published, is_featured, slug, published_at)
                    VALUES ($1, $2, $3, 'Internal note: do not show', $4, $5, $6, $7, $8, 1, $9, $10, CURRENT_TIMESTAMP - make_interval(days => $11))`,
      [id, 'SKU-' + id.slice(0, 6), it.name, it.desc, it.cat, Math.round(it.price * 0.5), it.price, it.was, it.featured, slug, it.days]);
    await db.query("INSERT INTO inventory_stock (id, product_id, owner_type, branch_id, quantity_on_hand) VALUES ($1, $2, 'BRANCH', $3, $4)", [crypto.randomUUID(), id, HQ, it.stock]);
  }

  for (const [n, [photoId]] of it.photos.entries()) {
    const got = await photo(photoId);
    if (!got && n > 0) break; // offline: one drawing is enough
    const ext = got ? (got.type === 'image/png' ? 'png' : got.type === 'image/webp' ? 'webp' : 'jpg') : 'png';
    const key = `products/${id}/${crypto.randomUUID()}.${ext}`;
    if (got) { await put(key, got.body, got.type); real++; } else await put(key, png(draw[it.kind](it.color)), 'image/png');
    await db.query('INSERT INTO product_images (id, product_id, object_key, alt, sort_order, is_primary) VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), id, key, n === 0 ? it.name : `${it.name}, another view`, n, n === 0 ? 1 : 0]);
  }
}
// One category with its own staff-uploaded picture (the others fall back to a product photo)
const office = await photo('photo-1606223226350-4cf4cd93a221'); // Arthur Lambillotte
const ck = `categories/cat-office/${crypto.randomUUID()}.${office ? 'jpg' : 'png'}`;
if (office) await put(ck, office.body, office.type); else await put(ck, png(draw.bookcase('#3f5f48')), 'image/png');
await db.query("UPDATE categories SET image_key = $1 WHERE id = 'cat-office'", [ck]);
console.log(`seeded ${items.length} products in ${cats.length} categories (${real} real photos${online ? '' : ', drawings for the rest'})`);
await db.end();
