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

test('every paged list answers with filters, every sort key and CSV export (phase 2 lists)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const lists: Array<[string, string[], string]> = [
    ['/purchasing/orders', ['date', 'number', 'supplier', 'status', 'total', 'balance', 'payment', 'expected'], '&paymentStatus=UNPAID&receiving=pending&status=DRAFT'],
    ['/transfers', ['date', 'number', 'status', 'from', 'to', 'lines'], `&status=PENDING_APPROVAL&from=W:${WH_MAIN}`],
    ['/deliveries', ['date', 'number', 'customer', 'status', 'scheduled', 'driver', 'order', 'branch'], '&status=PENDING'],
    ['/manufacturing/work-orders', ['date', 'number', 'product', 'status', 'stage', 'warehouse', 'quantity', 'due'], '&status=PLANNED'],
    ['/expenses', ['date', 'amount', 'title', 'category', 'branch', 'method'], '&method=CASH'],
    ['/audit', ['date', 'action', 'type', 'who'], ''],
    ['/storefront-admin/requests', ['date', 'number', 'customer', 'total', 'status'], '&status=NEW'],
    ['/accounting/journal-entries', ['date', 'number', 'status', 'type', 'debit', 'created'], '&status=POSTED'],
    ['/accounting/general-ledger', ['date'], ''],
    ['/inventory/transactions', ['date', 'product', 'type', 'quantity', 'user'], ''],
  ];
  for (const [path, sorts, filters] of lists) {
    for (const sort of sorts) {
      for (const dir of ['asc', 'desc']) {
        const res = await t.api('GET', `${path}?page=1&pageSize=25&sort=${sort}&dir=${dir}&q=a&dateFrom=2020-01-01&dateTo=${today}${filters}`);
        assert.equal(res.status, 200, `${path} sort=${sort} ${dir}: ${JSON.stringify(res.body).slice(0, 300)}`);
        assert.ok(Array.isArray(res.body.items) && typeof res.body.total === 'number', `${path}: paged shape`);
      }
    }
    const legacy = await t.api('GET', path);
    assert.ok(Array.isArray(legacy.body), `${path}: without ?page the old array answer stays`);
    const csv = await t.app.request(`/api/v1${path}?format=csv`, { headers: { Authorization: `Bearer ${t.adminToken}` } });
    assert.equal(csv.status, 200, `${path} csv`);
  }
});

test('transfers and purchase orders: older records are reachable and counts cover everything', async () => {
  const before = (await t.api('GET', '/transfers?page=1')).body.counts?.ALL ?? 0;
  const pid = await t.createProduct({});
  await t.setStock(pid, 500, { warehouseId: WH_MAIN });
  for (let i = 0; i < 3; i++) {
    const r = await t.api('POST', '/transfers', { sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN, destinationOwnerType: 'BRANCH', destinationBranchId: HQ, lines: [{ productId: pid, quantityRequested: 1 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const after = await t.api('GET', `/transfers?page=1&productId=${pid}`);
  assert.equal(after.body.total, 3, 'filter by product');
  assert.equal((await t.api('GET', '/transfers?page=1')).body.counts.ALL, before + 3);
});

test('bulk: deactivate/activate and move to a category, audited; manage_inventory only', async () => {
  const a = await t.createProduct({}); const b = await t.createProduct({});
  const off = await t.api('POST', '/products/bulk-update', { ids: [a, b], action: 'deactivate' });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.updated, 2);
  assert.deepEqual((await t.q('SELECT is_active FROM products WHERE id IN ($1, $2)', [a, b])).map((r: any) => r.is_active), [0, 0]);
  assert.equal((await t.api('POST', '/products/bulk-update', { ids: [a, b], action: 'deactivate' })).body.unchanged, 2, 'nothing to change twice');
  await t.q(`INSERT INTO categories (id, name) VALUES ('cat-bulk', 'Bulk Cat') ON CONFLICT DO NOTHING`);
  assert.equal((await t.api('POST', '/products/bulk-update', { ids: [a, b], action: 'category', categoryId: 'cat-bulk' })).body.updated, 2);
  assert.equal((await t.api('POST', '/products/bulk-update', { ids: [a], action: 'category', categoryId: 'nope' })).status, 400);
  assert.equal((await t.api('POST', '/products/bulk-update', { ids: [], action: 'activate' })).status, 400);
  const audits = await t.q(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE entity_id IN ($1, $2)`, [a, b]);
  assert.ok(audits[0].n >= 4, 'each product change is audited');
  const rep = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.equal((await t.api('POST', '/products/bulk-update', { ids: [a], action: 'activate' }, rep.token)).status, 403);
});

test('bulk publish: qualifying products go on the shop, the rest are listed with the reason', async () => {
  const withPhoto = await t.createProduct({ price: 50 });
  const noPhoto = await t.createProduct({ price: 50 });
  await t.q(`INSERT INTO product_images (id, product_id, object_key, sort_order, is_primary) VALUES ($1, $2, 'products/x.jpg', 0, 1)`, [randomUUID(), withPhoto]);
  const res = await t.api('POST', '/storefront-admin/products/bulk-publish', { ids: [withPhoto, noPhoto], publish: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, 1);
  assert.deepEqual(res.body.skipped.map((x: any) => [x.id, x.reason]), [[noPhoto, 'no photo']]);
  const row = (await t.q('SELECT is_published, slug FROM products WHERE id = $1', [withPhoto]))[0];
  assert.equal(row.is_published, 1);
  assert.ok(row.slug, 'gets a web address');
  assert.equal((await t.api('POST', '/storefront-admin/products/bulk-publish', { ids: [withPhoto], publish: false })).body.changed, 1);
});

test('saved views: per person, same name replaces, never another person’s', async () => {
  const v = await t.api('POST', '/views', { list: 'sales-orders', name: 'Unpaid this month', query: '?paymentStatus=UNPAID&dateFrom=2026-11-01&page=3&open=x' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.query, 'paymentStatus=UNPAID&dateFrom=2026-11-01', 'page and open are not saved');
  assert.equal((await t.api('POST', '/views', { list: 'sales-orders', name: 'unpaid this month', query: 'paymentStatus=UNPAID' })).status, 200, 'same name: replaced');
  const mine = await t.api('GET', '/views?list=sales-orders');
  assert.deepEqual(mine.body.map((x: any) => [x.name, x.query]), [['unpaid this month', 'paymentStatus=UNPAID']]);
  const other = await t.createUser({ branchId: HQ, roleId: 'role-sales-rep', role: 'sales_rep' });
  assert.deepEqual((await t.api('GET', '/views?list=sales-orders', undefined, other.token)).body, []);
  await t.api('DELETE', `/views/${v.body.id}`, undefined, other.token);
  assert.equal((await t.api('GET', '/views?list=sales-orders')).body.length, 1, 'another person cannot delete it');
  assert.equal((await t.api('GET', '/views?list=../x')).status, 400);
  await t.api('DELETE', `/views/${v.body.id}`);
  assert.equal((await t.api('GET', '/views?list=sales-orders')).body.length, 0);
});
