import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const near = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg ?? ''} expected ${b}, got ${a}`);
const prod = async (p: string) => (await t.q('SELECT cost_price, selling_price FROM products WHERE id = $1', [p]))[0];
const levels = async (p: string) => (await t.api('GET', `/products/${p}/price-levels`)).body as any[];
async function sell(p: string, qty: number) {
  const o = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId: p, quantity: qty }] });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const line = (await t.q('SELECT unit_price, line_total, price_breakdown FROM sales_order_lines WHERE sales_order_id = $1', [o.body.id]))[0];
  assert.equal((await t.api('POST', `/sales/orders/${o.body.id}/complete`)).status, 200);
  const cost = Number((await t.q('SELECT unit_cost FROM sales_order_lines WHERE sales_order_id = $1', [o.body.id]))[0].unit_cost);
  return { id: o.body.id as string, line, cost };
}

test('price levels: old stock sells at the old price first, then the new price switches on; books and profit follow', async () => {
  const p = await t.createProduct({ cost: 129, price: 200 });
  await t.setStock(p, 5, { branchId: BRANCH_HQ });
  const inv0 = await t.accountBalance('1030'); const cash0 = await t.accountBalance('1010'); const cogs0 = await t.accountBalance('5010');

  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['manage_inventory'] });
  assert.equal((await t.api('POST', `/products/${p}/price-levels`, { costPrice: 149, sellingPrice: 230, quantity: 10, ownerType: 'BRANCH', branchId: BRANCH_HQ }, seller.token)).status, 403, 'only the Owner');
  const add = await t.api('POST', `/products/${p}/price-levels`, { costPrice: 149, sellingPrice: 230, quantity: 10, ownerType: 'BRANCH', branchId: BRANCH_HQ, payment: 'PAID' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  let lv = await levels(p);
  assert.deepEqual(lv.map((l) => [l.level_no, Number(l.cost_price), Number(l.selling_price), l.quantity_left, l.status]),
    [[1, 129, 200, 5, 'SELLING'], [2, 149, 230, 10, 'WAITING']], 'today\'s stock became level 1');
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 15, 'the new goods were added');
  assert.equal(Number((await prod(p)).selling_price), 200, 'still the old price');
  near(Number((await prod(p)).cost_price), (5 * 129 + 10 * 149) / 15, 'stock value = 5×129 + 10×149');
  near((await t.accountBalance('1030')) - inv0, 1490); near(cash0 - (await t.accountBalance('1010')), 1490, 'paid in cash');
  assert.equal((await t.api('PATCH', `/products/${p}`, { sellingPrice: 999 })).status, 409, 'prices change through levels');

  const s1 = await sell(p, 3);
  assert.equal(Number(s1.line.unit_price), 200); near(s1.cost, 129, 'cost of the old units');
  // 2 left at 200 + 2 at 230
  const s2 = await sell(p, 4);
  near(Number(s2.line.line_total), 2 * 200 + 2 * 230); assert.equal(s2.line.price_breakdown, '2 × 200.00 + 2 × 230.00');
  near(s2.cost, (2 * 129 + 2 * 149) / 4);
  lv = await levels(p);
  assert.deepEqual(lv.map((l) => [l.quantity_left, l.status]), [[0, 'SOLD_OUT'], [8, 'SELLING']]);
  assert.equal(Number((await prod(p)).selling_price), 230, 'level 1 sold out: the new price is on');
  near(Number((await prod(p)).cost_price), 149);
  const s3 = await sell(p, 1);
  assert.equal(Number(s3.line.unit_price), 230); near(s3.cost, 149);

  // a returned unit of the crossing sale goes back to the level it came from (the newest of that sale: 149)
  const ret = await t.api('POST', `/sales/orders/${s2.id}/returns`, { reason: 'Wrong size', refundMethod: 'CASH', lines: [{ productId: p, quantity: 1, condition: 'RESALEABLE' }] });
  assert.equal(ret.status, 201, JSON.stringify(ret.body));
  assert.equal((await levels(p))[1].quantity_left, 8);

  // cancelling the first sale puts its 3 units back into level 1, which sells first again
  assert.equal((await t.api('POST', `/sales/orders/${s1.id}/cancel`, { reason: 'Customer changed mind' })).status, 200);
  lv = await levels(p);
  assert.deepEqual(lv.map((l) => [l.quantity_left, l.status]), [[3, 'SELLING'], [8, 'WAITING']]);
  assert.equal(Number((await prod(p)).selling_price), 200);

  // a purchase receipt of this product becomes level 3 at its cost and the newest price
  const sup = await t.api('POST', '/purchasing/suppliers', { name: `Sup L ${Date.now()}` });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: p, quantity: 6, unitCost: 160 }] });
  assert.equal((await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, lines: [{ productId: p, quantityReceived: 6 }] })).status, 201);
  lv = await levels(p);
  assert.deepEqual(lv.map((l) => [Number(l.cost_price), Number(l.selling_price), l.quantity_left]), [[129, 200, 3], [149, 230, 8], [160, 230, 6]]);
  // the Owner sets the price of the waiting level
  assert.equal((await t.api('PATCH', `/products/${p}/price-levels/${lv[2].id}`, { sellingPrice: 250 })).status, 200);

  // books: stock value for this product = units left × their level cost (5×129 was set without an entry)
  const value = 3 * 129 + 8 * 149 + 6 * 160;
  near((await t.accountBalance('1030')) - inv0, value - 5 * 129, 'inventory = sum of levels');
  near(Number((await prod(p)).cost_price) * (await t.q('SELECT SUM(quantity_on_hand)::int AS n FROM inventory_stock WHERE product_id = $1', [p]))[0].n, value, 'valuation = sum of levels');
  near((await t.accountBalance('5010')) - cogs0, 2 * 129 + 2 * 149 + 149 - 149, 'cost of sales (s1 cancelled, 1 unit of s2 returned)');
  const bad = await t.q(`SELECT je.id FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id GROUP BY je.id HAVING ABS(SUM(l.debit_amount) - SUM(l.credit_amount)) > 0.001`);
  assert.equal(bad.length, 0, 'every entry balances');
});
