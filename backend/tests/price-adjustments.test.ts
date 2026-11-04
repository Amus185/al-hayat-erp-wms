import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('a seller can sell above or below the product price: both are recorded, the product is untouched, Owner is told', async () => {
  const p = await t.createProduct({ price: 100 });
  await t.setStock(p, 20, { branchId: BRANCH_HQ });
  const seller = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  const sell = (price: number, reason?: string) => t.api('POST', '/sales/orders', { lines: [{ productId: p, quantity: 2, unitPrice: price, priceReason: reason }] }, seller.token);

  const low = await sell(80, 'Customer deal');
  const high = await sell(120, 'Market price today');
  const same = await sell(100);
  for (const r of [low, high, same]) assert.equal(r.status, 201, JSON.stringify(r.body));

  const rows = await t.q('SELECT sales_order_id, unit_price, list_price, adjustment_reason FROM sales_order_lines WHERE sales_order_id = ANY($1)', [[low.body.id, high.body.id, same.body.id]]);
  const by = (id: string) => rows.find((r: any) => r.sales_order_id === id);
  assert.equal(Number(by(low.body.id).list_price), 100);
  assert.equal(by(low.body.id).adjustment_reason, 'Customer deal');
  assert.equal(Number(by(high.body.id).unit_price), 120);
  assert.equal(by(same.body.id).adjustment_reason, null, 'no reason stored when the price is unchanged');
  assert.equal(Number((await t.q('SELECT selling_price FROM products WHERE id = $1', [p]))[0].selling_price), 100, 'the product price never changes');

  // the Owner (admin) is notified for the two changed orders, not for the unchanged one
  const notes = await t.q(`SELECT n.title, n.message FROM notifications n JOIN users u ON u.id = n.user_id JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
                           WHERE n.type = 'PRICE' AND r.code = 'admin'`);
  const text = JSON.stringify(notes);
  assert.ok(text.includes(low.body.order_number) && text.includes(high.body.order_number), 'both changed sales announced');
  assert.ok(!text.includes(same.body.order_number), 'an unchanged price is not announced');
  assert.match(text, /100\.00 → 80\.00/); assert.match(text, /Customer deal/);

  // the report lists who changed what, with totals; it is not for sellers
  assert.equal((await t.api('GET', '/sales/price-adjustments', undefined, seller.token)).status, 403);
  const rep = await t.api('GET', '/sales/price-adjustments');
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  assert.ok(rep.body.rows.some((r: any) => r.order_id === low.body.id && Number(r.adjustment) === -20));
  assert.ok(rep.body.below <= -40 && rep.body.above >= 40);
});
