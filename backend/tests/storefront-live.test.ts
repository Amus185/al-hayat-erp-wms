// Online store, phase 1: live catalog (no caching), optional quantities,
// staff alerts for new orders, customer order tracking, and the ERP's
// Online store overview and product list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, ADMIN_ID, BRANCH_HQ as HQ, type TestCtx } from './helpers';

let t: TestCtx;
const KEY = 'k'.repeat(32);

before(async () => {
  Object.assign(process.env, {
    STOREFRONT_API_KEY: KEY,
    R2_ACCOUNT_ID: 'acct123', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'secret-test-value',
    R2_BUCKET: 'photos', R2_PUBLIC_BASE_URL: 'https://img.example.com',
  });
  t = await setupTestApp();
  await t.api('PATCH', '/storefront-admin/settings', { locationId: HQ, safetyBuffer: 0, lowStockThreshold: 3, showQuantities: false });
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
  return { status: res.status, body, headers: res.headers };
}

const setQty = async (productId: string, qty: number) => {
  await t.q('DELETE FROM inventory_stock WHERE product_id = $1', [productId]);
  await t.setStock(productId, qty, { branchId: HQ });
};

async function publishedProduct(qty = 10, price = 100) {
  const id = await t.createProduct({ cost: 40, price });
  await setQty(id, qty);
  await t.q('INSERT INTO product_images (id, product_id, object_key, sort_order, is_primary) VALUES ($1, $2, $3, 0, 1)',
    [randomUUID(), id, `products/${id}/${randomUUID()}.jpg`]);
  const res = await t.api('PATCH', `/storefront-admin/products/${id}`, { isPublished: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { id, slug: res.body.slug as string };
}

let ip = 0;
const order = (slug: string, quantity: number, phone = '+252 63 444 1234') => pub('POST', '/storefront/requests', {
  headers: { 'x-storefront-key': KEY, 'x-client-ip': `10.1.0.${++ip}` },
  body: { name: 'Amina Shop', phone, lines: [{ slug, quantity }] },
});
const track = (requestNumber: string, phone: string, clientIp = '10.9.9.9') => pub('POST', '/storefront/track', {
  headers: { 'x-storefront-key': KEY, 'x-client-ip': clientIp }, body: { requestNumber, phone },
});

test('live: the shop is never served cached data; ERP price and stock changes show on the next request', async () => {
  const p = await publishedProduct(10, 100);
  const first = await pub('GET', `/storefront/products/${p.slug}`);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(first.body.price, 100);
  await t.q('UPDATE products SET selling_price = 135 WHERE id = $1', [p.id]);
  await setQty(p.id, 0);
  const after = await pub('GET', `/storefront/products/${p.slug}`);
  assert.equal(after.body.price, 135);
  assert.equal(after.body.availability, 'OUT');
  assert.equal((await pub('GET', '/storefront/products')).headers.get('cache-control'), 'no-store');
});

test('quantities: hidden by default; when switched on, customers see sellable units (after the buffer)', async () => {
  const p = await publishedProduct(9);
  assert.equal((await pub('GET', `/storefront/products/${p.slug}`)).body.unitsAvailable, undefined);
  try {
    assert.equal((await t.api('PATCH', '/storefront-admin/settings', { showQuantities: true, safetyBuffer: 2 })).status, 200);
    assert.equal((await pub('GET', `/storefront/products/${p.slug}`)).body.unitsAvailable, 7);
    const listed = (await pub('GET', '/storefront/products?pageSize=60')).body.items.find((i: any) => i.slug === p.slug);
    assert.equal(listed.unitsAvailable, 7);
    assert.equal((await t.api('GET', '/storefront-admin/settings')).body.showQuantities, true);
  } finally {
    await t.api('PATCH', '/storefront-admin/settings', { showQuantities: false, safetyBuffer: 0 });
  }
});

test('alerts: a new online order notifies sales staff (not users without sales access)', async () => {
  const p = await publishedProduct(5, 250);
  const placed = await order(p.slug, 2);
  assert.equal(placed.status, 201, JSON.stringify(placed.body));
  const n = placed.body.requestNumber;
  const forAdmin = await t.q(`SELECT title, message, type FROM notifications WHERE user_id = $1 AND title LIKE $2`, [ADMIN_ID, `%${n}%`]);
  assert.equal(forAdmin.length, 1);
  assert.equal(forAdmin[0].type, 'WEB_ORDER');
  assert.match(forAdmin[0].message, /\$500\.00/);
  const warehouse = await t.createUser({ branchId: HQ, roleId: 'role-warehouse-manager', role: 'warehouse_manager' });
  const noSales = await t.q(`SELECT 1 FROM notifications WHERE user_id = $1 AND title LIKE $2`, [warehouse.id, `%${n}%`]);
  assert.equal(noSales.length, 0);
  // and the admin sees it through the normal notifications route
  const listed = await t.api('GET', '/notifications');
  assert.ok(JSON.stringify(listed.body).includes(n));
});

test('tracking: order number + the phone it was placed with; any phone format; nothing for a wrong phone', async () => {
  const p = await publishedProduct(5, 80);
  const placed = await order(p.slug, 1, '+252 63 444 5566');
  const n = placed.body.requestNumber;
  const found = await track(n.toLowerCase(), '063 4445566');
  assert.equal(found.status, 200, JSON.stringify(found.body));
  assert.equal(found.body.stage, 'NEW');
  assert.equal(found.body.total, 80);
  assert.deepEqual(found.body.items.map((i: any) => i.quantity), [1]);
  assert.equal(found.body.phone, undefined, 'the phone is not echoed back');
  const wrongPhone = await track(n, '+252 63 999 9999');
  const unknown = await track('WR-00000000-XXXXXX', '+252 63 444 5566');
  assert.equal(wrongPhone.status, 404);
  assert.deepEqual(wrongPhone.body, unknown.body, 'a wrong phone must look exactly like an unknown order');
  assert.equal((await pub('POST', '/storefront/track', { body: { requestNumber: n, phone: '0634445566' } })).status, 401, 'no server key');

  // staff cancel it: the customer sees CANCELLED
  const id = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [n]))[0].id;
  assert.equal((await t.api('POST', `/storefront-admin/requests/${id}/cancel`)).status, 200);
  assert.equal((await track(n, '0634445566')).body.stage, 'CANCELLED');
});

test('tracking is throttled per IP', async () => {
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await track('WR-NOPE', '0630000000', '10.77.0.1')).status;
  assert.equal(last, 429);
});

test('overview: orders awaiting and today, products on the shop, and what is low or out there', async () => {
  const low = await publishedProduct(2);
  const before = (await t.api('GET', '/storefront-admin/overview')).body;
  const p = await publishedProduct(20, 60);
  await order(p.slug, 1);
  const res = await t.api('GET', '/storefront-admin/overview');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.orders.awaiting, before.orders.awaiting + 1);
  assert.equal(res.body.orders.today, before.orders.today + 1);
  assert.equal(Math.round((res.body.orders.todayValue - before.orders.todayValue) * 100) / 100, 60);
  assert.equal(res.body.publishedProducts, before.publishedProducts + 1);
  assert.ok(res.body.lowOrOut.some((r: any) => r.id === low.id && r.units === 2));
  assert.equal(res.body.sellsFrom, 'Al Hayat HQ Showroom');
  assert.equal(res.body.imagesConfigured, true);
  const nobody = await t.createUser({ branchId: HQ, roleId: 'role-accountant', role: 'accountant' });
  await t.q(`DELETE FROM role_permissions WHERE role_id = 'role-accountant'`);
  assert.equal((await t.api('GET', '/storefront-admin/overview', undefined, nobody.token)).status, 403);
});

test('products: every active product with its shop state, photos and web stock', async () => {
  const on = await publishedProduct(6, 120);
  const off = await t.createProduct({ price: 70 });
  await setQty(off, 4);
  const res = await t.api('GET', '/storefront-admin/products');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const a = res.body.find((r: any) => r.id === on.id);
  const b = res.body.find((r: any) => r.id === off);
  assert.deepEqual([a.isPublished, a.photoCount, a.webUnits, a.price, a.availability], [true, 1, 6, 120, 'IN_STOCK']);
  assert.match(a.photoUrl, /^https:\/\/img\.example\.com\//);
  assert.deepEqual([b.isPublished, b.photoCount, b.webUnits], [false, 0, 4]);
  assert.ok(!('cost_price' in a) && !('costPrice' in a));
  const searched = await t.api('GET', `/storefront-admin/products?search=${encodeURIComponent(a.name)}`);
  assert.ok(searched.body.every((r: any) => r.name.includes(a.name) || r.sku?.includes(a.name)));
  const warehouse = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.equal((await t.api('GET', '/storefront-admin/products', undefined, warehouse.token)).status, 403);
});

test('online quantity: sell only N online; orders lower it, a cancel gives it back, 0 shows sold out', async () => {
  const p = await publishedProduct(10, 300);
  const row = async () => (await t.api('GET', '/storefront-admin/products')).body.find((r: any) => r.id === p.id);
  const set = (webQuantity: unknown) => t.api('PATCH', `/storefront-admin/products/${p.id}`, { webQuantity });

  assert.equal((await set(-1)).status, 400);
  assert.equal((await set(2.5)).status, 400);
  const saved = await set(5);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual([saved.body.webQuantity, saved.body.stockAtWebBranch, typeof saved.body.sellsFrom], [5, 10, 'string']);
  assert.deepEqual([(await row()).webUnits, (await row()).webQuantity], [5, 5], '10 in stock, 5 for sale online');

  const first = await order(p.slug, 3, '+252 63 555 0001');
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await row()).webQuantity, 2);
  assert.equal((await order(p.slug, 3, '+252 63 555 0002')).status, 409, 'only 2 left online although 7 are in stock');
  assert.equal((await order(p.slug, 2, '+252 63 555 0003')).status, 201);
  const out = await row();
  assert.deepEqual([out.webQuantity, out.webUnits, out.availability], [0, 0, 'OUT']);
  assert.equal((await pub('GET', `/storefront/products/${p.slug}`)).body.availability, 'OUT', 'the shop shows sold out');

  // Cancelling the first order gives its 3 back, once.
  const reqId = (await t.q('SELECT id FROM storefront_requests WHERE request_number = $1', [first.body.requestNumber]))[0].id;
  assert.equal((await t.api('POST', `/storefront-admin/requests/${reqId}/cancel`)).status, 200);
  assert.equal((await row()).webQuantity, 3);
  assert.notEqual((await t.api('POST', `/storefront-admin/requests/${reqId}/cancel`)).status, 200);
  assert.equal((await row()).webQuantity, 3);

  // Clearing the limit sells all free stock again: 10 on hand - 2 still reserved.
  assert.equal((await set(null)).status, 200);
  assert.deepEqual([(await row()).webQuantity, (await row()).webUnits], [null, 8]);
});

test('a refused order lists each item the shop cannot fill, with a fix the customer can act on', async () => {
  const few = await publishedProduct(2, 100);
  const gone = await publishedProduct(0, 100);
  const res = await pub('POST', '/storefront/requests', {
    headers: { 'x-storefront-key': KEY, 'x-client-ip': '10.7.7.7' },
    body: { name: 'Mubarik Arab', phone: '+252 63 400 8221', lines: [{ slug: few.slug, quantity: 3 }, { slug: gone.slug, quantity: 1 }] },
  });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /not available in the quantities/);
  const by = Object.fromEntries(res.body.problems.map((p: any) => [p.slug, p]));
  assert.deepEqual([by[few.slug].requested, by[few.slug].available], [3, null], 'exact stock stays private when quantities are hidden');
  assert.deepEqual([by[gone.slug].requested, by[gone.slug].available], [1, 0], 'sold out is always said');

  await t.api('PATCH', '/storefront-admin/settings', { showQuantities: true });
  try {
    const shown = await pub('POST', '/storefront/requests', {
      headers: { 'x-storefront-key': KEY, 'x-client-ip': '10.7.7.8' },
      body: { name: 'Mubarik Arab', phone: '+252 63 400 8222', lines: [{ slug: few.slug, quantity: 3 }] },
    });
    assert.equal(shown.status, 409);
    assert.match(shown.body.message, /not available in that quantity/);
    assert.equal(shown.body.problems[0].available, 2, 'with quantities shown, the customer is told how many are left');
  } finally {
    await t.api('PATCH', '/storefront-admin/settings', { showQuantities: false });
  }
});
