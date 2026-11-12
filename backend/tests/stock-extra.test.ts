// Roadmap wave 3: variants, serial numbers / batches with traceability, profit by location.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, BRANCH_CL, WH_MAIN, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const today = new Date().toISOString().slice(0, 10);

test('variants: each variant is its own product with its own SKU, price and stock', async () => {
  const parent = await t.createProduct({ cost: 50, price: 120 });
  const a = await t.api('POST', `/products/${parent}/variants`, { label: 'Red / Large', sellingPrice: 130 });
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.match(a.body.sku, /-RED-LARGE$/);
  assert.equal((await t.api('POST', `/products/${parent}/variants`, { label: 'red / large' })).status, 409);
  const b = await t.api('POST', `/products/${parent}/variants`, { label: 'Blue' });
  assert.equal(b.body.selling_price, 120, 'the main product price by default');
  assert.equal((await t.api('POST', `/products/${a.body.id}/variants`, { label: 'X' })).status, 400, 'no variant of a variant');
  await t.setStock(a.body.id, 3, { branchId: BRANCH_HQ });
  const list = await t.api('GET', `/products/${b.body.id}/variants`);
  assert.equal(list.body.parent_id, parent); assert.equal(list.body.variants.length, 2);
  assert.equal(list.body.variants.find((v: any) => v.id === a.body.id).on_hand, 3);
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('POST', `/products/${parent}/variants`, { label: 'Green' }, seller.token)).status, 403);
  const sale = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId: a.body.id, quantity: 1 }] });
  assert.equal(sale.status, 201, 'a variant sells like any product');
});

test('serial numbers: numbered on receipt, sold oldest first, given back on cancel, traceable to the customer', async () => {
  const p = await t.createProduct({ cost: 100, price: 300 });
  assert.equal((await t.api('PUT', `/products/${p}/tracking`, { tracking: 'SERIAL' })).status, 200);
  const sup = await t.api('POST', '/purchasing/suppliers', { name: 'Serial supplier', phone: '0635550101' });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantity: 5, unitCost: 100 }] });
  const bad = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantityReceived: 2, serials: ['SN-1'] }] });
  assert.equal(bad.status, 400, 'one serial per unit');
  const gr = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantityReceived: 2, serials: ['SN-A1', 'SN-A2'] }] });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  const dup = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantityReceived: 1, serials: ['sn-a1'] }] });
  assert.equal(dup.status, 400); assert.match(dup.body.message, /already in the system/);
  const auto = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantityReceived: 3 }] });
  assert.equal(auto.status, 201);
  let lots = (await t.api('GET', `/inventory/lots?productId=${p}`)).body.lots;
  assert.equal(lots.length, 5); assert.ok(lots.every((l: any) => l.quantity_left === 1 && l.kind === 'SERIAL'));
  // goods go to the branch and are sold: the oldest serials leave first
  await t.setStock(p, 5, { branchId: BRANCH_HQ });
  const cust = await t.createCustomer();
  const sale = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, customerId: cust, isCreditSale: true, lines: [{ productId: p, quantity: 2 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  lots = (await t.api('GET', `/inventory/lots?productId=${p}`)).body.lots;
  assert.deepEqual(lots.map((l: any) => l.code).filter((c: string) => c.startsWith('SN-A')), [], 'SN-A1 and SN-A2 were sold');
  const trace = await t.api('GET', '/inventory/lots/trace?code=SN-A2');
  assert.equal(trace.body.lots.length, 1);
  const out = trace.body.lots[0].moves.find((m: any) => m.quantity === -1);
  assert.ok(out.order_number && out.customer_name, 'sold to a known customer');
  assert.equal(trace.body.lots[0].supplier_name, 'Serial supplier');
  // cancelling gives them back
  assert.equal((await t.api('POST', `/sales/orders/${sale.body.id}/cancel`, { reason: 'test' })).status, 200);
  lots = (await t.api('GET', `/inventory/lots?productId=${p}`)).body.lots;
  assert.equal(lots.length, 5);
  // tracking cannot change while serials are in stock
  assert.equal((await t.api('PUT', `/products/${p}/tracking`, { tracking: 'BATCH' })).status, 400);
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
});

test('batches: stock already on hand can be given a batch; a sale takes from the oldest batch; untracked products are not touched', async () => {
  const p = await t.createProduct({ cost: 5, price: 12 });
  await t.setStock(p, 10, { branchId: BRANCH_HQ });
  assert.equal((await t.api('POST', '/inventory/lots', { productId: p, code: 'B1', quantity: 4 })).status, 400, 'tracking is off');
  await t.api('PUT', `/products/${p}/tracking`, { tracking: 'BATCH' });
  assert.equal((await t.api('POST', '/inventory/lots', { productId: p, code: 'B-OLD', quantity: 4 })).status, 201);
  assert.equal((await t.api('POST', '/inventory/lots', { productId: p, code: 'B-NEW', quantity: 7 })).status, 400, 'only 6 units have no batch');
  assert.equal((await t.api('POST', '/inventory/lots', { productId: p, code: 'B-NEW', quantity: 6 })).status, 201);
  const sale = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, isCreditSale: true, lines: [{ productId: p, quantity: 5 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const lots = (await t.api('GET', `/inventory/lots?productId=${p}&open=0`)).body.lots;
  assert.equal(lots.find((l: any) => l.code === 'B-OLD').quantity_left, 0);
  assert.equal(lots.find((l: any) => l.code === 'B-NEW').quantity_left, 5);
  const plain = await t.createProduct();
  await t.setStock(plain, 3, { branchId: BRANCH_HQ });
  assert.equal((await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, isCreditSale: true, lines: [{ productId: plain, quantity: 1 }] })).status, 201);
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM stock_lots WHERE product_id = $1', [plain]))[0].n, 0);
});

test('profit by location: revenue, cost of goods and expenses per branch from the books', async () => {
  const p = await t.createProduct({ cost: 40, price: 100 });
  await t.setStock(p, 10, { branchId: BRANCH_CL });
  const s = await t.api('POST', '/sales/orders', { branchId: BRANCH_CL, isCreditSale: true, initialDeposit: 200, lines: [{ productId: p, quantity: 2 }] });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  await t.api('POST', '/expenses', { title: 'CL rent', amount: 30, category: 'Rent', expense_date: today, branch_id: BRANCH_CL });
  const r = await t.api('GET', `/reports/profit-by-location?from=${today}&to=${today}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cl = r.body.rows.find((x: any) => x.branch_id === BRANCH_CL);
  assert.equal(cl.revenue, 200); assert.equal(cl.cogs, 80); assert.equal(cl.gross_profit, 120); assert.equal(cl.expenses, 30); assert.equal(cl.net, 90);
  assert.ok(r.body.stock.some((x: any) => x.branch_id === BRANCH_CL && x.units >= 8));
  const hq = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const mine = await t.api('GET', `/reports/profit-by-location?from=${today}&to=${today}`, undefined, hq.token);
  assert.ok(!mine.body.rows?.some((x: any) => x.branch_id === BRANCH_CL), 'a branch sees only itself');
});
