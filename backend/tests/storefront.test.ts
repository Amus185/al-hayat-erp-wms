// Storefront: public catalog whitelist, availability, order requests,
// publishing, photos (R2 signing), and converting a request into a sales order.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, type TestCtx } from './helpers';
import { sigV4QueryString } from '../src/services/r2';

let t: TestCtx;
const KEY = 'k'.repeat(32);

before(async () => {
  Object.assign(process.env, {
    STOREFRONT_API_KEY: KEY,
    R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'secret-test-value',
    R2_BUCKET: 'photos', R2_PUBLIC_BASE_URL: 'https://img.example.com',
  });
  t = await setupTestApp();
  await t.api('PATCH', '/storefront-admin/settings', { locationId: HQ, safetyBuffer: 0, lowStockThreshold: 3 });
});
after(async () => { await t?.teardown(); });

async function pub(method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await t.app.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, text, headers: res.headers };
}

const setQty = async (productId: string, qty: number) => {
  await t.q('DELETE FROM inventory_stock WHERE product_id = $1', [productId]);
  await t.setStock(productId, qty, { branchId: HQ });
};
const addImage = (productId: string) =>
  t.q('INSERT INTO product_images (id, product_id, object_key, sort_order, is_primary) VALUES ($1, $2, $3, 0, 1)',
    [randomUUID(), productId, `products/${productId}/${randomUUID()}.jpg`]);

/** A product that is on sale on the website with `qty` units at HQ. */
async function publishedProduct(opts: { qty?: number; price?: number; cost?: number } = {}) {
  const id = await t.createProduct({ cost: opts.cost ?? 40, price: opts.price ?? 100 });
  await setQty(id, opts.qty ?? 10);
  await addImage(id);
  const res = await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { id, slug: res.body.slug as string };
}

let ipCounter = 0;
const request = (lines: unknown[], over: Record<string, unknown> = {}, ip = `10.0.0.${++ipCounter}`) =>
  pub('POST', '/storefront/requests', {
    headers: { 'x-storefront-key': KEY, 'x-client-ip': ip },
    body: { name: 'Sara Customer', phone: `+2519${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, lines, ...over },
  });

// ── signing ─────────────────────────────────────────────────────────────────

test('SigV4 signing matches the AWS documentation example', () => {
  const qs = sigV4QueryString({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z', expires: 86400,
  });
  assert.ok(qs.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'), qs);
});

test('R2_ENDPOINT points uploads at a local stand-in, but production only accepts https', async () => {
  const id = await t.createProduct({ price: 50 });
  const presignHost = async () => {
    const r = await t.api('POST', `/storefront-admin/products/${id}/images/presign`, { contentType: 'image/png', size: 100 });
    return new URL(r.body.uploadUrl).host;
  };
  const saved = { R2_ENDPOINT: process.env.R2_ENDPOINT, NODE_ENV: process.env.NODE_ENV };
  try {
    process.env.R2_ENDPOINT = 'http://127.0.0.1:9100';
    assert.equal(await presignHost(), '127.0.0.1:9100');
    // Checked on the config directly: in production mode the API itself refuses
    // to serve with the test's short signing secret.
    process.env.NODE_ENV = 'production';
    const { getR2Config } = await import('../src/services/r2');
    assert.equal(new URL(getR2Config()!.endpoint).host, 'acct123.r2.cloudflarestorage.com');
  } finally {
    if (saved.R2_ENDPOINT === undefined) delete process.env.R2_ENDPOINT; else process.env.R2_ENDPOINT = saved.R2_ENDPOINT;
    if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.NODE_ENV;
  }
  assert.equal(await presignHost(), 'acct123.r2.cloudflarestorage.com');
});

// ── settings ────────────────────────────────────────────────────────────────

test('settings: administrators only; the web location must be an existing branch; values validated', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', '/storefront-admin/settings', undefined, user.token)).status, 403);
  assert.equal((await t.api('PATCH', '/storefront-admin/settings', { safetyBuffer: 1 }, user.token)).status, 403);
  assert.equal((await t.api('PATCH', '/storefront-admin/settings', { locationId: 'wh-main-01' })).status, 400, 'a warehouse was accepted');
  assert.equal((await t.api('PATCH', '/storefront-admin/settings', { safetyBuffer: -1 })).status, 400);
  assert.equal((await t.api('PATCH', '/storefront-admin/settings', { lowStockThreshold: 1.5 })).status, 400);
  const ok = await t.api('PATCH', '/storefront-admin/settings', { locationId: HQ, safetyBuffer: 0, lowStockThreshold: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

// ── publishing and photos ───────────────────────────────────────────────────

test('publishing needs a photo, a price and an active product; slugs are unique; unpublish hides it', async () => {
  const id = await t.createProduct({ price: 100 });
  const noPhoto = await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true });
  assert.equal(noPhoto.status, 400);
  assert.match(noPhoto.body.message, /photo/i);
  await addImage(id);
  const free = await t.createProduct({ price: 0 });
  await addImage(free);
  assert.equal((await t.api('PATCH', `/storefront-admin/products/${free}`, { isPublished: true })).status, 400, 'free product published');

  const ok = await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true, slug: 'oak-table' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.slug, 'oak-table');
  const other = await t.createProduct({ price: 50 });
  await addImage(other);
  assert.equal((await t.api('PATCH', `/storefront-admin/products/${other}`, { isPublished: true, slug: 'oak-table' })).status, 409);
  assert.equal((await t.api('PATCH', `/storefront-admin/products/${other}`, { slug: 'Bad Slug!' })).status, 400);

  assert.equal((await pub('GET', '/storefront/products/oak-table')).status, 200);
  await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: false });
  assert.equal((await pub('GET', '/storefront/products/oak-table')).status, 404);

  await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true });
  await t.q('UPDATE products SET is_active = 0 WHERE id = $1', [id]);
  assert.equal((await pub('GET', '/storefront/products/oak-table')).status, 404, 'inactive product is still public');
});

test('photos: presign validates type, size and count; signature covers type and length; register checks storage', async () => {
  const id = await t.createProduct({ price: 80 });
  const presign = (body: unknown) => t.api('POST', `/storefront-admin/products/${id}/images/presign`, body);
  assert.equal((await presign({ contentType: 'image/svg+xml', size: 1000 })).status, 400);
  assert.equal((await presign({ contentType: 'text/html', size: 1000 })).status, 400);
  assert.equal((await presign({ contentType: 'image/png', size: 6 * 1024 * 1024 })).status, 400);
  assert.equal((await presign({ contentType: 'image/png', size: 0 })).status, 400);

  const ok = await presign({ contentType: 'image/png', size: 1000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const url = new URL(ok.body.uploadUrl);
  assert.equal(url.host, 'acct123.r2.cloudflarestorage.com');
  assert.ok(url.pathname.startsWith(`/photos/products/${id}/`) && url.pathname.endsWith('.png'));
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.ok(url.searchParams.get('X-Amz-Signature'));
  assert.ok(Number(url.searchParams.get('X-Amz-Expires')) <= 300);

  // register: stub the storage HEAD/DELETE the backend performs
  const real = globalThis.fetch;
  let head: { size: number; type: string } | null = { size: 1000, type: 'image/png' };
  const calls: string[] = [];
  globalThis.fetch = (async (u: any, init: any) => {
    calls.push(`${init?.method} ${new URL(String(u)).pathname}`);
    if (init?.method === 'HEAD') {
      return head ? { ok: true, status: 200, headers: new Headers({ 'content-length': String(head.size), 'content-type': head.type }) } : { ok: false, status: 404, headers: new Headers() };
    }
    return { ok: true, status: 204, headers: new Headers() };
  }) as any;
  try {
    const reg = (key: string) => t.api('POST', `/storefront-admin/products/${id}/images`, { key });
    assert.equal((await reg(`products/${randomUUID()}/x.png`)).status, 400, "another product's key accepted");
    assert.equal((await reg(`products/${id}/../../etc.png`)).status, 400);
    head = null;
    assert.equal((await reg(ok.body.key)).status, 400, 'registered a photo that was never uploaded');
    head = { size: 9 * 1024 * 1024, type: 'image/png' };
    assert.equal((await reg(ok.body.key)).status, 400);
    assert.ok(calls.some((c) => c.startsWith('DELETE')), 'oversized upload was not removed from storage');
    head = { size: 1000, type: 'text/html' };
    assert.equal((await reg(ok.body.key)).status, 400);
    head = { size: 1000, type: 'image/png' };
    const done = await reg(ok.body.key);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.images.length, 1);
    assert.equal(done.body.images[0].isPrimary, true);
    assert.equal(done.body.images[0].url, `https://img.example.com/${ok.body.key}`);

    // a published product cannot lose its last photo
    await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true });
    const del = await t.api('DELETE', `/storefront-admin/products/${id}/images/${done.body.images[0].id}`);
    assert.equal(del.status, 400);
  } finally {
    globalThis.fetch = real;
  }
});

test('staff product routes need manage_inventory', async () => {
  const id = await t.createProduct({ price: 10 });
  const noPerms = await t.tokenFor({ sub: (await t.createUser({ branchId: HQ, roleId: 'role-accountant', role: 'accountant' })).id });
  assert.equal((await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: false }, noPerms)).status, 403);
  assert.equal((await pub('PATCH', `/storefront-admin/products/${id}`, { body: { isPublished: true } })).status, 401);
});

// ── public catalog ──────────────────────────────────────────────────────────

test('public catalog: only published, active products, and only whitelisted fields', async () => {
  const shown = await publishedProduct({ cost: 123.45, price: 250, qty: 7 });
  const hidden = await t.createProduct({ price: 99 });
  await setQty(hidden, 5);

  const list = await pub('GET', '/storefront/products');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'public, max-age=60');
  const slugs = list.body.items.map((i: any) => i.slug);
  assert.ok(slugs.includes(shown.slug));
  assert.equal(list.body.items.length, list.body.total);

  const item = list.body.items.find((i: any) => i.slug === shown.slug);
  assert.deepEqual(Object.keys(item).sort(), ['availability', 'category', 'compareAtPrice', 'description', 'images', 'isNew', 'name', 'price', 'slug']);
  assert.equal(item.price, 250);
  assert.equal(item.images.length, 1);
  assert.ok(item.images[0].url.startsWith('https://img.example.com/products/'));

  // nothing private in either endpoint
  const one = await pub('GET', `/storefront/products/${shown.slug}`);
  for (const text of [list.text, one.text]) {
    for (const secret of ['123.45', 'cost', 'sku', 'SKU-', HQ, CL, 'quantity', 'reserved', 'tier', 'password', 'supplier']) {
      assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `public response leaks "${secret}"`);
    }
  }
  assert.equal((await pub('GET', `/storefront/products/${hidden}`)).status, 404);
});

test('catalog filters: category, search, pagination; categories list counts only published products', async () => {
  const catId = `cat-${randomUUID().slice(0, 6)}`;
  await t.q(`INSERT INTO categories (id, code, name) VALUES ($1, $1, 'Sofas')`, [catId]);
  const a = await publishedProduct();
  const b = await publishedProduct();
  await t.q('UPDATE products SET category_id = $1, name = $2 WHERE id = $3', [catId, 'Velvet Corner Sofa', a.id]);
  await t.q('UPDATE products SET category_id = $1, name = $2 WHERE id = $3', [catId, 'Leather Sofa', b.id]);
  const draft = await t.createProduct({ price: 5 });
  await t.q('UPDATE products SET category_id = $1 WHERE id = $2', [catId, draft]);

  const byCat = await pub('GET', `/storefront/products?category=${catId}`);
  assert.equal(byCat.body.total, 2);
  const search = await pub('GET', `/storefront/products?category=${catId}&q=velvet`);
  assert.deepEqual(search.body.items.map((i: any) => i.name), ['Velvet Corner Sofa']);
  const paged = await pub('GET', `/storefront/products?category=${catId}&pageSize=1&page=2`);
  assert.equal(paged.body.items.length, 1);
  assert.equal(paged.body.total, 2);
  assert.equal((await pub('GET', `/storefront/products?q=${encodeURIComponent("%'; DROP TABLE products;--")}`)).status, 200);

  const cats = await pub('GET', '/storefront/categories');
  assert.equal(cats.body.find((c: any) => c.id === catId).productCount, 2);
});

test('availability: safety buffer, low-stock threshold, bundles, and an unconfigured store', async () => {
  const p = await publishedProduct({ qty: 10 });
  const status = async (slug = p.slug) => (await pub('GET', `/storefront/products/${slug}`)).body.availability;
  await t.api('PATCH', '/storefront-admin/settings', { safetyBuffer: 2, lowStockThreshold: 3 });
  assert.equal(await status(), 'IN_STOCK');         // 10 - 2 = 8
  await setQty(p.id, 4);
  assert.equal(await status(), 'LOW');              // 4 - 2 = 2 <= 3
  await setQty(p.id, 2);
  assert.equal(await status(), 'OUT');              // 2 - 2 = 0

  // other branches' stock does not count
  await t.setStock(p.id, 50, { branchId: CL });
  assert.equal(await status(), 'OUT');

  // a bundle is as available as its scarcest component
  const a = await t.createProduct(), b = await t.createProduct();
  await setQty(a, 10); await setQty(b, 3);
  const bundle = await t.createProduct({ type: 'GROUPED', price: 500 });
  await t.q('INSERT INTO product_group_items (id, parent_product_id, component_product_id, quantity) VALUES ($1,$2,$3,2), ($4,$2,$5,1)',
    [randomUUID(), bundle, a, randomUUID(), b]);
  await addImage(bundle);
  const published = await t.api('PATCH', `/storefront-admin/products/${bundle}`, { isPublished: true });
  await t.api('PATCH', '/storefront-admin/settings', { safetyBuffer: 0, lowStockThreshold: 3 });
  assert.equal(await status(published.body.slug), 'LOW'); // min(10/2, 3/1) = 3 <= 3
  await setQty(b, 9);
  assert.equal(await status(published.body.slug), 'IN_STOCK'); // min(5, 9) = 5

  // no web branch configured: nothing is sellable
  await t.q(`DELETE FROM storefront_settings WHERE key = 'location_id'`);
  assert.equal(await status(), 'OUT');
  const noStore = await request([{ slug: p.slug, quantity: 1 }]);
  assert.equal(noStore.status, 503);
  await t.api('PATCH', '/storefront-admin/settings', { locationId: HQ });
});

// ── order requests ──────────────────────────────────────────────────────────

test('requests: need the server API key; fail closed when it is not configured', async () => {
  const p = await publishedProduct();
  const body = { name: 'A', phone: '0911223344', lines: [{ slug: p.slug, quantity: 1 }] };
  assert.equal((await pub('POST', '/storefront/requests', { body })).status, 401);
  assert.equal((await pub('POST', '/storefront/requests', { headers: { 'x-storefront-key': 'wrong'.repeat(8) }, body })).status, 401);
  const saved = process.env.STOREFRONT_API_KEY;
  delete process.env.STOREFRONT_API_KEY;
  try {
    assert.equal((await pub('POST', '/storefront/requests', { headers: { 'x-storefront-key': KEY }, body })).status, 503);
  } finally {
    process.env.STOREFRONT_API_KEY = saved;
  }
});

test('requests: validation, honeypot, server-side prices, availability and de-duplication', async () => {
  const p = await publishedProduct({ price: 120, qty: 5 });
  const line = { slug: p.slug, quantity: 2 };
  assert.equal((await request([line], { name: '' })).status, 400);
  assert.equal((await request([line], { phone: '12' })).status, 400);
  assert.equal((await request([line], { email: 'not-an-email' })).status, 400);
  assert.equal((await request([])).status, 400);
  assert.equal((await request([{ slug: p.slug, quantity: 0 }])).status, 400);
  assert.equal((await request([{ slug: p.slug, quantity: 1.5 }])).status, 400);
  assert.equal((await request([{ slug: p.slug, quantity: 21 }])).status, 400);
  assert.equal((await request(Array.from({ length: 21 }, () => line))).status, 400);
  assert.equal((await request([{ slug: 'no-such-product', quantity: 1 }])).status, 409);
  assert.equal((await request([{ slug: p.slug, quantity: 6 }])).status, 409, 'more than the web branch has');

  const before = Number((await t.q('SELECT COUNT(*) AS n FROM storefront_requests'))[0].n);
  const bot = await request([line], { website: 'http://spam.example' });
  assert.equal(bot.status, 201);
  assert.equal(Number((await t.q('SELECT COUNT(*) AS n FROM storefront_requests'))[0].n), before, 'honeypot request was stored');

  // client-supplied prices are ignored; repeated slugs are merged
  const ok = await request([{ slug: p.slug, quantity: 1, unitPrice: 1, price: 1 }, { slug: p.slug, quantity: 1 }], { total: 1 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const row = (await t.q('SELECT * FROM storefront_requests WHERE request_number = $1', [ok.body.requestNumber]))[0];
  assert.equal(Number(row.total_amount), 240);
  const lines = await t.q('SELECT quantity, unit_price FROM storefront_request_lines WHERE request_id = $1', [row.id]);
  assert.deepEqual(lines.map((l: any) => [Number(l.quantity), Number(l.unit_price)]), [[2, 120]]);
  assert.equal(row.status, 'NEW');
  assert.equal(Number((await t.q('SELECT quantity_on_hand AS q FROM inventory_stock WHERE product_id = $1', [p.id]))[0].q), 5, 'a request must not touch stock');
});

test('requests: throttled per IP and per phone', async () => {
  const p = await publishedProduct({ qty: 50 });
  const line = [{ slug: p.slug, quantity: 1 }];
  const ip = '203.0.113.7';
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await request(line, {}, ip)).status);
  assert.deepEqual(results, [201, 201, 201, 201, 201, 429]);
  const phone = '0922334455';
  const byPhone = [];
  for (let i = 0; i < 4; i++) byPhone.push((await request(line, { phone }, `198.51.100.${i + 1}`)).status);
  assert.deepEqual(byPhone, [201, 201, 201, 429]);
});

// ── inbox and conversion ────────────────────────────────────────────────────

test('inbox: only the web branch and all-branch staff; branch users elsewhere are refused', async () => {
  const p = await publishedProduct();
  const made = await request([{ slug: p.slug, quantity: 1 }]);
  const id = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [made.body.requestNumber]))[0].id;
  const other = await t.createUser({ branchId: CL, roleId: 'role-branch-user', role: 'branch_user' });
  const web = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  for (const [m, path] of [['GET', '/storefront-admin/requests'], ['GET', `/storefront-admin/requests/${id}`], ['POST', `/storefront-admin/requests/${id}/convert`], ['POST', `/storefront-admin/requests/${id}/cancel`]]) {
    assert.equal((await t.api(m, path, undefined, other.token)).status, 403, `${m} ${path} open to another branch`);
  }
  assert.equal((await pub('GET', '/storefront-admin/requests')).status, 401);
  const list = await t.api('GET', '/storefront-admin/requests', undefined, web.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((r: any) => r.id === id));
  const detail = await t.api('GET', `/storefront-admin/requests/${id}`, undefined, web.token);
  assert.equal(detail.body.lines.length, 1);
});

test('convert: creates a normal sales order at the request price; nothing moves until the sale is completed', async () => {
  const p = await publishedProduct({ price: 150, qty: 6 });
  const phone = '0933445566';
  const made = await request([{ slug: p.slug, quantity: 2 }], { phone, name: 'Hana Buyer' });
  const id = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [made.body.requestNumber]))[0].id;

  // the product price changes after the request: the customer keeps the quoted price
  await t.q('UPDATE products SET selling_price = 999 WHERE id = $1', [p.id]);
  const journals = await t.journalCount();
  const conv = await t.api('POST', `/storefront-admin/requests/${id}/convert`);
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.equal(await t.journalCount(), journals, 'converting posted accounting entries');
  assert.equal(await t.stockOf(p.id, { branchId: HQ }), 6, 'converting deducted stock');

  const order = (await t.q('SELECT branch_id, customer_id, status FROM sales_orders WHERE id = $1', [conv.body.orderId]))[0];
  assert.equal(order.branch_id, HQ);
  const lines = await t.q('SELECT quantity, unit_price FROM sales_order_lines WHERE sales_order_id = $1', [conv.body.orderId]);
  assert.deepEqual(lines.map((l: any) => [Number(l.quantity), Number(l.unit_price)]), [[2, 150]]);
  const customer = (await t.q('SELECT name, phone FROM customers WHERE id = $1', [order.customer_id]))[0];
  assert.equal(customer.name, 'Hana Buyer');

  const after = (await t.q('SELECT status, converted_order_id FROM storefront_requests WHERE id = $1', [id]))[0];
  assert.deepEqual([after.status, after.converted_order_id], ['CONVERTED', conv.body.orderId]);
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id}/convert`)).status, 409, 'converted twice');
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id}/cancel`)).status, 409);

  // staff finish the sale the normal way: stock and books move then
  const done = await t.api('POST', `/sales/orders/${conv.body.orderId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await t.stockOf(p.id, { branchId: HQ }), 4);

  // the same phone finds the same customer next time
  const again = await request([{ slug: p.slug, quantity: 1 }], { phone, name: 'Hana B.' });
  const id2 = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [again.body.requestNumber]))[0].id;
  const conv2 = await t.api('POST', `/storefront-admin/requests/${id2}/convert`);
  assert.equal(conv2.status, 201, JSON.stringify(conv2.body));
  assert.equal((await t.q('SELECT customer_id FROM sales_orders WHERE id = $1', [conv2.body.orderId]))[0].customer_id, order.customer_id);
});

test('convert: concurrent clicks create exactly one order; a failed conversion leaves the request open', async () => {
  const p = await publishedProduct({ qty: 9 });
  const made = await request([{ slug: p.slug, quantity: 1 }]);
  const id = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [made.body.requestNumber]))[0].id;
  const results = await Promise.all([1, 2, 3].map(() => t.api('POST', `/storefront-admin/requests/${id}/convert`)));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409], JSON.stringify(results.map((r) => r.body)));
  assert.equal(Number((await t.q('SELECT COUNT(*) AS n FROM sales_orders WHERE id = $1', [results.find((r) => r.status === 201)!.body.orderId]))[0].n), 1);

  // the product was deactivated after the request: the sales route refuses, the request stays NEW
  const q = await publishedProduct({ qty: 9 });
  const made2 = await request([{ slug: q.slug, quantity: 1 }]);
  const id2 = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [made2.body.requestNumber]))[0].id;
  await t.q('UPDATE products SET is_active = 0 WHERE id = $1', [q.id]);
  const fail = await t.api('POST', `/storefront-admin/requests/${id2}/convert`);
  assert.equal(fail.status, 400, JSON.stringify(fail.body));
  assert.equal((await t.q('SELECT status FROM storefront_requests WHERE id = $1', [id2]))[0].status, 'NEW');
  await t.q('UPDATE products SET is_active = 1 WHERE id = $1', [q.id]);
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id2}/convert`)).status, 201);
});

test('a cancelled request cannot be converted', async () => {
  const p = await publishedProduct();
  const made = await request([{ slug: p.slug, quantity: 1 }]);
  const id = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [made.body.requestNumber]))[0].id;
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id}/cancel`)).status, 200);
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id}/convert`)).status, 409);
});

// ── sale prices, featured, new arrivals, categories ─────────────────────────

test('the ERP\'s internal description is never public; only the website description is', async () => {
  const p = await publishedProduct();
  await t.q(`UPDATE products SET description = 'Internal: supplier ABC, margin 40%', web_description = NULL WHERE id = $1`, [p.id]);
  const one = await pub('GET', `/storefront/products/${p.slug}`);
  assert.equal(one.body.description, null);
  assert.ok(!one.text.includes('supplier ABC'));
  await t.api('PATCH', `/storefront-admin/products/${p.id}`, { webDescription: 'Solid oak, seats six.' });
  assert.equal((await pub('GET', `/storefront/products/${p.slug}`)).body.description, 'Solid oak, seats six.');
});

test('sale prices: the "was" price must be a real reduction, is display-only, and never changes what is charged', async () => {
  const p = await publishedProduct({ price: 100, qty: 9 });
  const patch = (body: unknown) => t.api('PATCH', `/storefront-admin/products/${p.id}`, body);
  assert.equal((await patch({ compareAtPrice: 100 })).status, 400, 'equal "was" price accepted');
  assert.equal((await patch({ compareAtPrice: 80 })).status, 400, 'lower "was" price accepted');
  assert.equal((await patch({ compareAtPrice: 'abc' })).status, 400);
  const ok = await patch({ compareAtPrice: 125 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.compareAtPrice, 125);

  const shown = (await pub('GET', `/storefront/products/${p.slug}`)).body;
  assert.deepEqual([shown.price, shown.compareAtPrice], [100, 125]);
  const onSale = (await pub('GET', '/storefront/products?sale=1&pageSize=60')).body.items.map((i: any) => i.slug);
  assert.ok(onSale.includes(p.slug));

  // the customer is still charged the selling price
  const made = await request([{ slug: p.slug, quantity: 1 }]);
  assert.equal(Number((await t.q('SELECT total_amount FROM storefront_requests WHERE request_number = $1', [made.body.requestNumber]))[0].total_amount), 100);

  // if the selling price later rises above the "was" price, the badge disappears by itself
  await t.q('UPDATE products SET selling_price = 130 WHERE id = $1', [p.id]);
  assert.equal((await pub('GET', `/storefront/products/${p.slug}`)).body.compareAtPrice, null);
  assert.ok(!(await pub('GET', '/storefront/products?sale=1&pageSize=60')).body.items.some((i: any) => i.slug === p.slug));

  await t.q('UPDATE products SET selling_price = 100 WHERE id = $1', [p.id]);
  assert.equal((await patch({ compareAtPrice: null })).body.compareAtPrice, null);
});

test('featured and new arrivals: staff flag featured; "new" follows the first publish date', async () => {
  const older = await publishedProduct();
  await t.q(`UPDATE products SET published_at = CURRENT_TIMESTAMP - INTERVAL '10 days' WHERE id = $1`, [older.id]);
  const newer = await publishedProduct();
  const firstPublished = (await t.q('SELECT published_at FROM products WHERE id = $1', [newer.id]))[0].published_at;
  assert.ok(firstPublished, 'publishing did not record a date');

  const newest = (await pub('GET', '/storefront/products?sort=new&pageSize=60')).body.items.map((i: any) => i.slug);
  assert.ok(newest.indexOf(newer.slug) < newest.indexOf(older.slug), 'newer product is not listed first');

  // unpublish + republish keeps the original date (it is not "new" again)
  await t.api('PATCH', `/storefront-admin/products/${newer.id}`, { isPublished: false });
  await t.api('PATCH', `/storefront-admin/products/${newer.id}`, { isPublished: true });
  const again = (await t.q('SELECT published_at FROM products WHERE id = $1', [newer.id]))[0].published_at;
  assert.equal(new Date(again).getTime(), new Date(firstPublished).getTime());

  // "isNew" for 30 days after the first publish; the date itself is never public
  const shownNewer = await pub('GET', `/storefront/products/${newer.slug}`);
  assert.equal(shownNewer.body.isNew, true);
  assert.ok(!/published_?at/i.test(shownNewer.text), 'publish date leaked');
  await t.q(`UPDATE products SET published_at = CURRENT_TIMESTAMP - INTERVAL '31 days' WHERE id = $1`, [older.id]);
  assert.equal((await pub('GET', `/storefront/products/${older.slug}`)).body.isNew, false);

  assert.equal((await t.api('PATCH', `/storefront-admin/products/${older.id}`, { isFeatured: true })).body.isFeatured, true);
  const featured = (await pub('GET', '/storefront/products?featured=1&pageSize=60')).body.items.map((i: any) => i.slug);
  assert.ok(featured.includes(older.slug));
  assert.ok(!featured.includes(newer.slug));
});

test('price sort and price range; unknown sort values fall back to name order', async () => {
  const catId = `cat-${randomUUID().slice(0, 6)}`;
  await t.q(`INSERT INTO categories (id, code, name) VALUES ($1, $1, 'Price test')`, [catId]);
  const made = [];
  for (const price of [300, 100, 200]) {
    const p = await publishedProduct({ price });
    await t.q('UPDATE products SET category_id = $1 WHERE id = $2', [catId, p.id]);
    made.push(p);
  }
  const list = async (qs: string) => {
    const res = await pub('GET', `/storefront/products?category=${catId}&${qs}`);
    assert.equal(res.status, 200, res.text);
    return res.body.items.map((i: any) => i.price);
  };
  assert.deepEqual(await list('sort=price_asc'), [100, 200, 300]);
  assert.deepEqual(await list('sort=price_desc'), [300, 200, 100]);
  assert.deepEqual(await list('sort=price_asc&minPrice=150'), [200, 300]);
  assert.deepEqual(await list('sort=price_asc&maxPrice=200'), [100, 200]);
  assert.deepEqual(await list('sort=price_asc&minPrice=150&maxPrice=250'), [200]);
  // bad bounds are ignored, and sort values are looked up, never placed in the SQL
  assert.equal((await list('minPrice=abc&maxPrice=-5')).length, 3);
  for (const sort of ['constructor', '__proto__', 'toString', 'p.cost_price', '1;DROP TABLE products']) {
    assert.equal((await list(`sort=${encodeURIComponent(sort)}`)).length, 3, sort);
  }
});

test('category pictures: staff photo first, otherwise a product photo; uploads are verified like product photos', async () => {
  const catId = `cat-${randomUUID().slice(0, 6)}`;
  await t.q(`INSERT INTO categories (id, code, name) VALUES ($1, $1, 'Beds')`, [catId]);
  const p = await publishedProduct();
  await t.q('UPDATE products SET category_id = $1 WHERE id = $2', [catId, p.id]);

  const catOf = async () => (await pub('GET', '/storefront/categories')).body.find((c: any) => c.id === catId);
  const fallback = await catOf();
  assert.ok(fallback.image?.url.startsWith(`https://img.example.com/products/${p.id}/`), JSON.stringify(fallback));

  const presign = await t.api('POST', `/storefront-admin/categories/${catId}/image/presign`, { contentType: 'image/webp', size: 2000 });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  assert.ok(presign.body.key.startsWith(`categories/${catId}/`));
  assert.equal((await t.api('POST', `/storefront-admin/categories/${catId}/image/presign`, { contentType: 'image/gif', size: 2000 })).status, 400);

  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => (init?.method === 'HEAD'
    ? { ok: true, status: 200, headers: new Headers({ 'content-length': '2000', 'content-type': 'image/webp' }) }
    : { ok: true, status: 204, headers: new Headers() })) as any;
  try {
    // a product photo key cannot be attached to a category
    assert.equal((await t.api('POST', `/storefront-admin/categories/${catId}/image`, { key: `products/${p.id}/x.webp` })).status, 400);
    const set = await t.api('POST', `/storefront-admin/categories/${catId}/image`, { key: presign.body.key });
    assert.equal(set.status, 201, JSON.stringify(set.body));
    assert.equal((await catOf()).image.url, `https://img.example.com/${presign.body.key}`);
    const list = await t.api('GET', '/storefront-admin/categories');
    assert.equal(list.body.find((c: any) => c.id === catId).imageUrl, `https://img.example.com/${presign.body.key}`);
    assert.equal((await t.api('DELETE', `/storefront-admin/categories/${catId}/image`)).status, 200);
    assert.ok((await catOf()).image.url.includes(`/products/${p.id}/`), 'did not fall back to a product photo');
  } finally {
    globalThis.fetch = real;
  }

  const noPerms = await t.tokenFor({ sub: (await t.createUser({ branchId: HQ, roleId: 'role-accountant', role: 'accountant' })).id });
  assert.equal((await t.api('GET', '/storefront-admin/categories', undefined, noPerms)).status, 403);
  assert.equal((await t.api('POST', `/storefront-admin/categories/${catId}/image/presign`, { contentType: 'image/png', size: 10 }, noPerms)).status, 403);
});
