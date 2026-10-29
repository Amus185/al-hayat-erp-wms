// Smoke test for the storefront: catalog, product page, cart API, order
// request, and (optionally) the staff side: convert the request to a sales
// order, complete the sale, and check that stock went down.
//
//   node scripts/smoke-test.mjs
//
// Settings (environment):
//   SHOP_URL      storefront address        (default http://localhost:3001)
//   ERP_API_URL   ERP /api/v1 address       (default http://localhost:3100/api/v1)
//   STAFF_EMAIL / STAFF_PASSWORD   a LOCAL test login; enables the staff steps.
// The staff steps create a sales order, so they refuse any ERP that is not on
// this computer. Never point this script at production with a login.

import http from 'node:http';
import https from 'node:https';

function nativeSignIn(url, credentials) {
  const body = JSON.stringify(credentials);
  const mod = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Client-Type': 'native' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, token: res.headers['set-auth-token'] || null }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const SHOP = (process.env.SHOP_URL || 'http://localhost:3001').replace(/\/$/, '');
const ERP = (process.env.ERP_API_URL || 'http://localhost:3100/api/v1').replace(/\/$/, '');
const { STAFF_EMAIL, STAFF_PASSWORD } = process.env;

let failed = 0;
const ok = (name, detail = '') => console.log(`  ok   ${name}${detail ? ` (${detail})` : ''}`);
const fail = (name, detail) => { failed++; console.log(`  FAIL ${name}: ${detail}`); };
async function check(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail);
  } catch (err) {
    fail(name, err?.message || String(err));
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const sameSite = { 'Content-Type': 'application/json', Origin: SHOP, 'Sec-Fetch-Site': 'same-origin' };

console.log(`Storefront ${SHOP}, ERP ${ERP}`);

let products = [];
await check('ERP storefront API answers', async () => {
  const res = await fetch(`${ERP}/storefront/products?pageSize=60`);
  assert(res.ok, `HTTP ${res.status}`);
  products = (await res.json()).items;
  assert(products.length > 0, 'no published products (publish one in the staff app, or run backend/scripts/dev-demo-catalog.mjs locally)');
  return `${products.length} published`;
});

await check('home page shows the catalog', async () => {
  const res = await fetch(SHOP + '/');
  const html = await res.text();
  assert(res.status === 200, `HTTP ${res.status}`);
  assert(!html.includes('temporarily unavailable'), 'shows "catalog temporarily unavailable"');
  assert(/href="\/product\/[a-z0-9-]+"/.test(html), 'no product links');
});

await check('shop page sorts by price', async () => {
  const res = await fetch(`${SHOP}/search?sort=price_asc`);
  const html = await res.text();
  assert(res.status === 200, `HTTP ${res.status}`);
  assert(!html.includes('temporarily unavailable'), 'shows "catalog temporarily unavailable"');
  const slugs = [...new Set([...html.matchAll(/href="\/product\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
  const prices = slugs.map((s) => products.find((p) => p.slug === s)?.price).filter((p) => p != null);
  assert(prices.length > 0, 'no products listed');
  assert(prices.every((p, i) => i === 0 || prices[i - 1] <= p), `not in price order: ${prices.join(', ')}`);
});

const buyable = products.find((p) => p.availability === 'IN_STOCK') ?? products.find((p) => p.availability === 'LOW');
await check('product page opens', async () => {
  assert(buyable, 'no product in stock');
  const res = await fetch(`${SHOP}/product/${buyable.slug}`);
  const html = await res.text();
  assert(res.status === 200, `HTTP ${res.status}`);
  assert(html.includes(buyable.name.replace(/&/g, '&amp;')), 'product name missing');
  return buyable.slug;
});

await check('unknown product is a 404', async () => {
  const res = await fetch(`${SHOP}/product/no-such-product-xyz`);
  assert(res.status === 404, `HTTP ${res.status}`);
});

await check('cart API returns fresh prices', async () => {
  const res = await fetch(`${SHOP}/api/cart`, { method: 'POST', headers: sameSite, body: JSON.stringify({ slugs: [buyable.slug, 'gone-product-xyz'] }) });
  const body = await res.json();
  assert(res.status === 200, `HTTP ${res.status}: ${JSON.stringify(body)}`);
  assert(body.products[0]?.price === buyable.price, 'wrong price');
  assert(body.missing.includes('gone-product-xyz'), 'missing product not reported');
});

await check('cart API refuses cross-site requests', async () => {
  const res = await fetch(`${SHOP}/api/cart`, { method: 'POST', headers: { ...sameSite, Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, body: '{"slugs":[]}' });
  assert(res.status === 403, `HTTP ${res.status}`);
});

let requestNumber = null;
await check('order request is accepted at the shop price', async () => {
  const res = await fetch(`${SHOP}/api/request`, {
    method: 'POST',
    headers: sameSite,
    body: JSON.stringify({
      name: 'Smoke Test',
      phone: `+2519${String(Date.now()).slice(-8)}`,
      notes: 'Automated smoke test, safe to cancel.',
      lines: [{ slug: buyable.slug, quantity: 1, price: 0.01 }], // a tampered price must be ignored
    }),
  });
  const body = await res.json();
  assert(res.status === 201 && body.requestNumber, `HTTP ${res.status}: ${body.message || JSON.stringify(body)}`);
  requestNumber = body.requestNumber;
  return requestNumber;
});

await check('checkout rejects a request without a phone', async () => {
  const res = await fetch(`${SHOP}/api/request`, { method: 'POST', headers: sameSite, body: JSON.stringify({ name: 'X', phone: '', lines: [{ slug: buyable.slug, quantity: 1 }] }) });
  assert(res.status === 400, `HTTP ${res.status}`);
});

if (STAFF_EMAIL && STAFF_PASSWORD && requestNumber) {
  const host = new URL(ERP).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    fail('staff steps', `refusing: ${host} is not a local ERP`);
  } else {
    let token = null;
    const api = async (method, path, body) => {
      const res = await fetch(ERP + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-csrf-protection': '1' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    };
    const stockOf = async () => {
      const { body } = await api('GET', '/inventory/stock');
      return (body || []).filter((r) => r.name === buyable.name && r.owner_type === 'BRANCH').reduce((n, r) => n + Number(r.quantity_on_hand), 0);
    };

    await check('staff sign-in', async () => {
      // Better Auth sign-in, as the mobile app does: the session token comes back in set-auth-token.
      // Plain node:http, because fetch adds Sec-Fetch-Mode, and Better Auth treats that as a browser.
      const res = await nativeSignIn(`${ERP.replace(/\/api\/v1$/, '/api/auth')}/sign-in/email`, { email: STAFF_EMAIL, password: STAFF_PASSWORD });
      token = res.token;
      assert(res.status === 200 && token, `HTTP ${res.status}`);
    });

    let request = null;
    await check('request reaches the staff inbox with the real price', async () => {
      const { body } = await api('GET', '/storefront-admin/requests');
      request = (body || []).find((r) => r.request_number === requestNumber);
      assert(request, 'not found');
      assert(Number(request.total_amount) === buyable.price, `total ${request.total_amount}, expected ${buyable.price}`);
    });

    const before = await stockOf();
    let orderId = null;
    await check('convert to a sales order (stock unchanged)', async () => {
      const { status, body } = await api('POST', `/storefront-admin/requests/${request.id}/convert`);
      assert(status === 201, `HTTP ${status}: ${body?.message}`);
      orderId = body.orderId;
      assert((await stockOf()) === before, 'stock moved before the sale was completed');
      return body.orderNumber;
    });

    await check('complete the sale: stock goes down by 1', async () => {
      const { status, body } = await api('POST', `/sales/orders/${orderId}/complete`);
      assert(status === 200 || status === 201, `HTTP ${status}: ${body?.message}`);
      const after = await stockOf();
      assert(after === before - 1, `stock ${before} -> ${after}`);
      return `${before} -> ${after}`;
    });
  }
} else if (!STAFF_EMAIL) {
  console.log('  skip staff steps (set STAFF_EMAIL and STAFF_PASSWORD for a LOCAL test login)');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
