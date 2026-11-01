// Server-side lists: paging, search, filters, sorting, totals and CSV export,
// so no record is hidden behind a "latest 200" cap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('customers: every customer is reachable (no 200 cap); search by name or phone digits; paging and totals', async () => {
  await t.q(`
    INSERT INTO customers (id, name, phone, created_at)
    SELECT 'bulk-' || g, 'Bulk Customer ' || g, '063' || lpad(g::text, 7, '0'), CURRENT_TIMESTAMP - (g || ' hours')::interval
    FROM generate_series(1, 230) g`);
  const oldest = await t.api('GET', '/sales/customers?page=1&q=Bulk%20Customer%20230');
  assert.equal(oldest.status, 200, JSON.stringify(oldest.body));
  assert.equal(oldest.body.total, 1, 'the oldest of 230 customers is found');
  const byPhone = await t.api('GET', `/sales/customers?page=1&q=${encodeURIComponent('063 000 0229')}`);
  assert.deepEqual(byPhone.body.items.map((c: any) => c.name), ['Bulk Customer 229'], 'spaces in a typed phone number do not matter');

  const p1 = await t.api('GET', '/sales/customers?page=1&pageSize=50&q=Bulk');
  assert.equal(p1.body.total, 230);
  assert.equal(p1.body.items.length, 50);
  const p5 = await t.api('GET', '/sales/customers?page=5&pageSize=50&q=Bulk');
  assert.equal(p5.body.items.length, 30, 'the last page has the rest');
  const sorted = await t.api('GET', '/sales/customers?page=1&pageSize=25&q=Bulk&sort=name&dir=asc');
  assert.equal(sorted.body.items[0].name, 'Bulk Customer 1');
  assert.equal((await t.api('GET', '/sales/customers?page=1&pageSize=7')).body.pageSize, 25, 'only 25/50/100');
  assert.ok(Array.isArray((await t.api('GET', '/sales/customers')).body), 'without ?page the old array answer stays (assistant, older clients)');
  assert.equal((await t.api('GET', '/sales/customers?page=1&sort=password;drop')).status, 200, 'unknown sort keys fall back safely');
});

test('sales orders: server-side status and payment filters, status counts, totals, date range', async () => {
  const pid = await t.createProduct({ price: 100 });
  await t.setStock(pid, 50, { branchId: HQ });
  const cust = await t.createCustomer();
  const mk = async (qty: number) => (await t.api('POST', '/sales/orders', { branchId: HQ, customerId: cust, lines: [{ productId: pid, quantity: qty, unitPrice: 100 }] })).body.id as string;
  const a = await mk(1);
  await mk(2);
  const list = await t.api('GET', `/sales/orders?page=1&customerId=${cust}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 2);
  assert.equal(list.body.counts.ALL, 2);
  assert.equal(list.body.counts.DRAFT, 2);
  assert.equal(list.body.totals.value, 300, 'draft orders count at their line value');
  const drafts = await t.api('GET', `/sales/orders?page=1&customerId=${cust}&status=DRAFT&sort=total&dir=asc`);
  assert.deepEqual(drafts.body.items.map((o: any) => Number(o.lines_total)), [100, 200]);
  assert.equal((await t.api('GET', `/sales/orders?page=1&customerId=${cust}&paymentStatus=PAID`)).body.total, 0);
  assert.equal((await t.api('GET', `/sales/orders?page=1&customerId=${cust}&paymentStatus=NOT_INVOICED`)).body.total, 2);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await t.api('GET', `/sales/orders?page=1&customerId=${cust}&dateFrom=${today}&dateTo=${today}`)).body.total, 2);
  assert.equal((await t.api('GET', `/sales/orders?page=1&customerId=${cust}&dateTo=2000-01-01`)).body.total, 0);
  const num = (await t.q('SELECT order_number FROM sales_orders WHERE id = $1', [a]))[0].order_number;
  assert.equal((await t.api('GET', `/sales/orders?page=1&q=${num}`)).body.items[0].id, a);
});

test('products and stock: search, filters, sort, totals; cost only for administrators', async () => {
  const tag = randomUUID().slice(0, 6);
  for (let i = 0; i < 30; i++) {
    const id = randomUUID();
    await t.q(`INSERT INTO products (id, sku, name, cost_price, selling_price, reorder_level) VALUES ($1, $2, $3, 10, $4, 5)`,
      [id, `ZZ-${tag}-${i}`, `Zebra ${tag} ${String(i).padStart(2, '0')}`, 20 + i]);
    if (i < 10) await t.setStock(id, i, { warehouseId: WH_MAIN });
  }
  const page = await t.api('GET', `/products?page=1&q=${tag}&sort=price&dir=desc`);
  assert.equal(page.body.total, 30);
  assert.equal(Number(page.body.items[0].selling_price), 49);
  assert.equal((await t.api('GET', `/products?page=1&q=${tag}&stock=out`)).body.total, 21, 'no stock: 20 never stocked + the one with 0');
  assert.equal((await t.api('GET', `/products?page=1&q=${tag}&stock=low`)).body.total, 26, 'at or below the reorder level (5)');

  const stock = await t.api('GET', `/inventory/stock?page=1&q=${tag}&location=W:${WH_MAIN}&sort=onHand&dir=desc`);
  assert.equal(stock.status, 200, JSON.stringify(stock.body));
  assert.equal(stock.body.total, 9, 'rows with nothing on hand or reserved are not stock');
  assert.equal(stock.body.items[0].quantity_on_hand, 9);
  assert.equal(stock.body.totals.units, 45);
  assert.ok('cost_price' in stock.body.items[0], 'admins see cost');

  const shelf = (await t.q(`SELECT id FROM products WHERE sku = $1`, [`ZZ-${tag}-29`]))[0].id;
  await t.setStock(shelf, 3, { branchId: HQ });
  const clerk = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const asClerk = await t.api('GET', `/inventory/stock?page=1&q=${tag}`, undefined, clerk.token);
  assert.equal(asClerk.status, 200, JSON.stringify(asClerk.body));
  assert.equal(asClerk.body.total, 1, 'branch staff see their branch only');
  assert.ok(!('cost_price' in asClerk.body.items[0]), 'only administrators get cost');
  assert.equal(asClerk.body.totals.value, undefined);
});

test('CSV export: whole filtered list, safe against spreadsheet formulas, limited to report access', async () => {
  await t.q(`INSERT INTO customers (id, name, phone) VALUES ('csv-evil', '=HYPERLINK("http://evil")', '-123')`);
  const res = await t.app.request('/api/v1/sales/customers?format=csv&q=HYPERLINK', { headers: { Authorization: `Bearer ${t.adminToken}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /text\/csv/);
  assert.match(res.headers.get('content-disposition') || '', /attachment; filename="customers-/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'BOM so Excel reads UTF-8');
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /'=HYPERLINK/, 'a formula is neutralised');
  assert.match(text, /,-123,/, 'negative numbers stay numbers');

  const clerk = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager' });
  const denied = await t.app.request('/api/v1/sales/customers?format=csv', { headers: { Authorization: `Bearer ${clerk.token}` } });
  assert.equal(denied.status, 403);
});

test('customer search: a name with a number is not drowned by phone-digit matches', async () => {
  await t.q(`INSERT INTO customers (id, name, phone) SELECT 'nm-' || g, 'Namecheck ' || g, '0633' || lpad(g::text, 6, '0') FROM generate_series(1, 40) g`);
  const res = await t.api('GET', '/sales/customers?page=1&q=Namecheck%2030');
  assert.deepEqual(res.body.items.map((c: any) => c.name), ['Namecheck 30']);
  const phone = await t.api('GET', `/sales/customers?page=1&q=${encodeURIComponent('0633 000 030')}`);
  assert.deepEqual(phone.body.items.map((c: any) => c.name), ['Namecheck 30']);
});

test('quick search: finds orders, customers and products by number, name or phone, within permissions', async () => {
  const pid = await t.createProduct({ price: 70 });
  await t.q(`UPDATE products SET name = 'Quicksearch Lamp', sku = 'QS-LAMP-1' WHERE id = $1`, [pid]);
  await t.setStock(pid, 4, { branchId: HQ });
  await t.q(`INSERT INTO customers (id, name, phone) VALUES ('qs-c', 'Quicksearch Hodan', '0634 555 111')`);
  const order = (await t.api('POST', '/sales/orders', { branchId: HQ, customerId: 'qs-c', lines: [{ productId: pid, quantity: 1, unitPrice: 70 }] })).body;
  const num = (await t.q('SELECT order_number FROM sales_orders WHERE id = $1', [order.id]))[0].order_number;

  const byName = await t.api('GET', '/search?q=Quicksearch');
  assert.equal(byName.status, 200, JSON.stringify(byName.body));
  const kinds = byName.body.results.map((r: any) => `${r.kind}:${r.title}`);
  assert.ok(kinds.includes('customer:Quicksearch Hodan'), kinds.join(', '));
  assert.ok(kinds.includes('product:Quicksearch Lamp'));
  assert.ok(kinds.includes(`order:${num}`), 'orders are found by customer name');
  assert.equal(byName.body.results.find((r: any) => r.kind === 'order').url, `/sales?open=${order.id}`);
  assert.ok((await t.api('GET', `/search?q=${num}`)).body.results.some((r: any) => r.kind === 'order' && r.id === order.id));
  assert.ok((await t.api('GET', `/search?q=${encodeURIComponent('0634555111')}`)).body.results.some((r: any) => r.title === 'Quicksearch Hodan'), 'phone without spaces');
  assert.deepEqual((await t.api('GET', '/search?q=Q')).body.results, [], 'needs 2 characters');

  const wh = await t.createUser({ branchId: null, roleId: 'role-warehouse-manager', role: 'warehouse_manager' });
  const asWh = await t.api('GET', '/search?q=Quicksearch', undefined, wh.token);
  assert.ok(!asWh.body.results.some((r: any) => r.kind === 'customer' || r.kind === 'order'), 'no sales data without sales access');
});
