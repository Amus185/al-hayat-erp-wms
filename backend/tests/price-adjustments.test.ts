import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('a sale always uses the product price: nobody can type another one (seller or Owner)', async () => {
  const p = await t.createProduct({ price: 100 });
  await t.setStock(p, 20, { branchId: BRANCH_HQ });
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const bySeller = await t.api('POST', '/sales/orders', { lines: [{ productId: p, quantity: 2, unitPrice: 80 }] }, seller.token);
  const byOwner = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId: p, quantity: 1, unitPrice: 1 }] });
  for (const r of [bySeller, byOwner]) assert.equal(r.status, 201, JSON.stringify(r.body));
  const rows = await t.q('SELECT unit_price, line_total FROM sales_order_lines WHERE sales_order_id = ANY($1) ORDER BY line_total', [[bySeller.body.id, byOwner.body.id]]);
  assert.deepEqual(rows.map((r: any) => Number(r.unit_price)), [100, 100], 'the typed prices were ignored');
  assert.deepEqual(rows.map((r: any) => Number(r.line_total)), [100, 200]);

  // the Owner changes the price in Products: the next sale uses it
  assert.equal((await t.api('PATCH', `/products/${p}`, { sellingPrice: 120 })).status, 200);
  const next = await t.api('POST', '/sales/orders', { lines: [{ productId: p, quantity: 1 }] }, seller.token);
  assert.equal(Number((await t.q('SELECT unit_price FROM sales_order_lines WHERE sales_order_id = $1', [next.body.id]))[0].unit_price), 120);
  // ...and the earlier sales keep theirs
  assert.equal(Number((await t.q('SELECT unit_price FROM sales_order_lines WHERE sales_order_id = $1', [bySeller.body.id]))[0].unit_price), 100);
  // editing a draft cannot change the price either
  assert.equal((await t.api('PATCH', `/sales/orders/${next.body.id}`, { lines: [{ productId: p, quantity: 2, unitPrice: 5 }] }, seller.token)).status, 200);
  assert.equal(Number((await t.q('SELECT unit_price FROM sales_order_lines WHERE sales_order_id = $1', [next.body.id]))[0].unit_price), 120);
});
