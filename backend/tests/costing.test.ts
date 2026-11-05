import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg ?? ''} expected ${b}, got ${a}`);
const cost = async (p: string) => Number((await t.q('SELECT cost_price FROM products WHERE id = $1', [p]))[0].cost_price);

async function buy(productId: string, quantity: number, unitCost: number, extra: Record<string, unknown> = {}, token?: string) {
  const sup = await t.api('POST', '/purchasing/suppliers', { name: `Sup ${Date.now()}${Math.random()}` });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId, quantity, unitCost }] });
  assert.equal(po.status, 201, JSON.stringify(po.body));
  return t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, lines: [{ productId, quantityReceived: quantity, ...extra }] }, token);
}
async function toBranch(productId: string, qty: number) {
  const tr = await t.api('POST', '/transfers', { sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN, destinationOwnerType: 'BRANCH', destinationBranchId: BRANCH_HQ, lines: [{ productId, quantityRequested: qty }] });
  assert.equal((await t.api('POST', `/transfers/${tr.body.id}/accept`)).status, 200);
}
async function sell(productId: string, qty: number, price: number) {
  const o = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId, quantity: qty, unitPrice: price }] });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal((await t.api('POST', `/sales/orders/${o.body.id}/complete`)).status, 200);
  return o.body.id as string;
}
const lineCost = async (orderId: string) => Number((await t.q('SELECT unit_cost FROM sales_order_lines WHERE sales_order_id = $1', [orderId]))[0].unit_cost);

test('bought at 129, then at 149: average cost, each sale keeps its own cost, returns and the books agree', async () => {
  const p = await t.createProduct({ cost: 0, price: 300 });
  const inv0 = await t.accountBalance('1030'); const cogs0 = await t.accountBalance('5010');

  assert.equal((await buy(p, 10, 129)).status, 201);
  near(await cost(p), 129, 'first purchase sets the cost');
  await toBranch(p, 10);
  const s1 = await sell(p, 5, 300);
  near(await lineCost(s1), 129, 'sale before the price rise keeps 129');

  // the war: new stock costs 149. 5 left at 129 + 10 new at 149 → 142.33
  assert.equal((await buy(p, 10, 149)).status, 201);
  near(await cost(p), (5 * 129 + 10 * 149) / 15, 'running average');
  await toBranch(p, 10);
  const s2 = await sell(p, 3, 300);
  near(await lineCost(s2), (5 * 129 + 10 * 149) / 15, 'new sale at the new average');
  near(await lineCost(s1), 129, 'the old sale did not change');

  // a unit of the first sale comes back: it returns at the cost it was sold at (129)
  const avgBefore = await cost(p);
  const ret = await t.api('POST', `/sales/orders/${s1}/returns`, { reason: 'Wrong colour', refundMethod: 'CASH', lines: [{ productId: p, quantity: 1, condition: 'RESALEABLE' }] });
  assert.equal(ret.status, 201, JSON.stringify(ret.body));
  near(await cost(p), (12 * avgBefore + 129) / 13, 'returned unit joins the average at its sold cost');

  // books: stock value in the ledger == units on hand × average cost; cost of sales == what was sold, at its cost
  const onHand = Number((await t.q('SELECT COALESCE(SUM(quantity_on_hand),0) AS n FROM inventory_stock WHERE product_id = $1', [p]))[0].n);
  assert.equal(onHand, 13);
  near((await t.accountBalance('1030')) - inv0, onHand * (await cost(p)), 'inventory account = stock × average cost');
  near((await t.accountBalance('5010')) - cogs0, 5 * 129 + 3 * avgBefore - 129, 'cost of sales');
  const history = await t.q("SELECT kind, source FROM product_price_history WHERE product_id = $1 AND kind = 'COST' ORDER BY created_at", [p]);
  assert.deepEqual(history.map((h: any) => h.source), ['PURCHASE_RECEIPT', 'PURCHASE_RECEIPT', 'SALES_RETURN']);
});

test('only the Owner changes the selling price; cost cannot be typed while in stock; Owner is alerted when cost rises', async () => {
  const p = await t.createProduct({ cost: 0, price: 300 });
  assert.equal((await buy(p, 4, 100)).status, 201);
  const mgr = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['manage_inventory'] });
  const acct = await t.createUser({ branchId: null, roleId: 'role-accountant', role: 'accountant', grants: ['manage_inventory'] });
  for (const u of [mgr, acct]) {
    const r = await t.api('PATCH', `/products/${p}`, { sellingPrice: 350 }, u.token);
    assert.ok([403, 404].includes(r.status), `non-owner refused (${r.status})`);
  }
  assert.equal((await t.api('PATCH', `/products/${p}`, { costPrice: 90 })).status, 409, 'cost of a product in stock cannot be typed');
  assert.equal((await t.api('PATCH', `/products/${p}`, { sellingPrice: 300, name: 'Renamed desk' })).status, 200, 'saving the same price is fine');
  assert.equal((await t.api('PATCH', `/products/${p}`, { sellingPrice: 320 })).status, 200, 'the Owner can');

  // cost rises 100 → 120 (4 at 100 + 4 at 140); the Owner sets the new price while receiving
  const rec = await buy(p, 4, 140, { newSellingPrice: 380 });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  near(await cost(p), 120);
  assert.equal(Number((await t.q('SELECT selling_price FROM products WHERE id = $1', [p]))[0].selling_price), 380);
  const alert = await t.q("SELECT message FROM notifications WHERE type = 'PRICE' AND title LIKE 'Cost went up:%' AND message LIKE '%100.00 → 120.00%'");
  assert.ok(alert.length > 0, 'Owner told about the cost rise');
  const hist = await t.api('GET', `/products/${p}/price-history`);
  assert.deepEqual(hist.body.filter((h: any) => h.kind === 'SELLING').map((h: any) => [h.old_value, h.new_value, h.source]),
    [[320, 380, 'SET_WHEN_RECEIVING'], [300, 320, 'SET_BY_OWNER'], [null, 300, 'CREATED']].filter((x) => x[2] !== 'CREATED'));
});

test('one-time recalculation: today\'s cost comes from the newest purchases that make up the stock', async () => {
  const p = await t.createProduct({ cost: 50, price: 300 });
  assert.equal((await buy(p, 10, 129)).status, 201);
  assert.equal((await buy(p, 10, 149)).status, 201);
  // simulate the old system: 12 left in stock, cost typed by hand as 50
  await t.q("UPDATE inventory_stock SET quantity_on_hand = 12 WHERE product_id = $1", [p]);
  await t.q('UPDATE products SET cost_price = 50 WHERE id = $1', [p]);
  await t.q("DELETE FROM app_migrations WHERE name = 'costing_recalc_v1'");
  const { ensureCosting } = await import('../src/init-postgres');
  await ensureCosting(t.pool);
  // newest 10 at 149 + 2 of the older at 129 → (1490 + 258) / 12 = 145.67
  near(await cost(p), (10 * 149 + 2 * 129) / 12);
  const h = await t.q("SELECT old_value, source FROM product_price_history WHERE product_id = $1 AND source = 'RECALCULATED_FROM_PURCHASES'", [p]);
  assert.equal(h.length, 1); assert.equal(Number(h[0].old_value), 50, 'the old value is kept');
  await ensureCosting(t.pool);
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM product_price_history WHERE product_id = $1 AND source = 'RECALCULATED_FROM_PURCHASES'", [p]))[0].n, 1, 'runs only once');
});
