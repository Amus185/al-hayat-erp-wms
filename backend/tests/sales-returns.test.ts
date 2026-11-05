import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

async function sale(productId: string, quantity: number) {
  const res = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId, quantity, unitPrice: 100 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

test('a draft sale can be edited; a confirmed one cannot', async () => {
  const p = await t.createProduct(); const p2 = await t.createProduct();
  await t.setStock(p, 10, { branchId: BRANCH_HQ }); await t.setStock(p2, 10, { branchId: BRANCH_HQ });
  const id = await sale(p, 2);
  const ed = await t.api('PATCH', `/sales/orders/${id}`, { lines: [{ productId: p2, quantity: 3, unitPrice: 50 }] });
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  const rows = await t.q('SELECT product_id, quantity, line_total FROM sales_order_lines WHERE sales_order_id = $1', [id]);
  assert.equal(rows.length, 1); assert.equal(rows[0].product_id, p2); assert.equal(Number(rows[0].line_total), 300, 'priced at the product price (100), not the typed 50');
  assert.equal((await t.api('PATCH', `/sales/orders/${id}`, { lines: [{ productId: p2, quantity: 0, unitPrice: 5 }] })).status, 400);
  assert.equal((await t.api('POST', `/sales/orders/${id}/confirm`)).status, 200);
  const late = await t.api('PATCH', `/sales/orders/${id}`, { lines: [{ productId: p, quantity: 1, unitPrice: 1 }] });
  assert.equal(late.status, 409); assert.match(late.body.message, /Only draft/);
});

test('cancelling needs a reason; collected money is given back in the books', async () => {
  const p = await t.createProduct(); await t.setStock(p, 5, { branchId: BRANCH_HQ });
  const cash0 = await t.accountBalance('1010'); const ar0 = await t.accountBalance('1020'); const rev0 = await t.accountBalance('4010');
  const id = await sale(p, 2);
  assert.equal((await t.api('POST', `/sales/orders/${id}/complete`)).status, 200);
  assert.equal((await t.api('POST', `/sales/orders/${id}/cancel`, {})).status, 400, 'reason required');
  const paid = Number((await t.q(`SELECT COALESCE(SUM(ip.amount),0) AS n FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE i.sales_order_id = $1`, [id]))[0].n);
  assert.ok(paid > 0 && (await t.accountBalance('1010')) !== cash0, 'the sale collected money');
  const cancel = await t.api('POST', `/sales/orders/${id}/cancel`, { reason: 'Customer changed their mind' });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 5);
  assert.ok(Math.abs((await t.accountBalance('1010')) - cash0) < 0.01, 'cash back to where it was');
  assert.ok(Math.abs((await t.accountBalance('1020')) - ar0) < 0.01, 'receivable back to where it was');
  assert.ok(Math.abs((await t.accountBalance('4010')) - rev0) < 0.01, 'revenue back to where it was');
});

test('a return restocks good items, not damaged ones, and fixes the invoice and books', async () => {
  const p = await t.createProduct(); await t.setStock(p, 10, { branchId: BRANCH_HQ });
  const id = await sale(p, 5);
  assert.equal((await t.api('POST', `/sales/orders/${id}/complete`)).status, 200);
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 5);
  const info = await t.api('GET', `/sales/orders/${id}/returns`);
  assert.equal(info.body.returnable[0].returnable, 5);
  assert.equal((await t.api('POST', `/sales/orders/${id}/returns`, { lines: [{ productId: p, quantity: 1 }] })).status, 400, 'reason required');
  assert.equal((await t.api('POST', `/sales/orders/${id}/returns`, { reason: 'Faulty', lines: [{ productId: p, quantity: 9 }] })).status, 400, 'more than sold');
  const rev0 = await t.accountBalance('4010');
  // completed sale is paid in full: the refund method is needed
  const noMethod = await t.api('POST', `/sales/orders/${id}/returns`, { reason: 'Faulty', lines: [{ productId: p, quantity: 2, condition: 'RESALEABLE' }] });
  assert.equal(noMethod.status, 400); assert.equal(noMethod.body.needs, 'refundMethod');
  const ok = await t.api('POST', `/sales/orders/${id}/returns`, { reason: 'Faulty', refundMethod: 'CASH', lines: [{ productId: p, quantity: 2, condition: 'RESALEABLE' }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.value, 200); assert.equal(ok.body.refund, 200);
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 7, 'good items back on the shelf');
  const dmg = await t.api('POST', `/sales/orders/${id}/returns`, { reason: 'Broken', refundMethod: 'CASH', lines: [{ productId: p, quantity: 1, condition: 'DAMAGED' }] });
  assert.equal(dmg.status, 201);
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 7, 'damaged items are not restocked');
  const left = await t.api('GET', `/sales/orders/${id}/returns`);
  assert.equal(left.body.returnable[0].returnable, 2);
  assert.equal(left.body.returns.length, 2);
  assert.equal((await t.api('POST', `/sales/orders/${id}/returns`, { reason: 'Too many', refundMethod: 'CASH', lines: [{ productId: p, quantity: 3 }] })).status, 400);
  assert.equal((await t.api('POST', `/sales/orders/${id}/cancel`, { reason: 'Whole sale' })).status, 409, 'returned sales are not cancelled');
  const inv = (await t.q('SELECT total_amount, returned_amount, refunded_amount FROM invoices WHERE sales_order_id = $1', [id]))[0];
  assert.equal(Number(inv.total_amount), 200); assert.equal(Number(inv.returned_amount), 300); assert.equal(Number(inv.refunded_amount), 300);
  // every journal entry still balances
  const bad = await t.q(`SELECT je.id FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id GROUP BY je.id HAVING ABS(SUM(l.debit_amount) - SUM(l.credit_amount)) > 0.001`);
  assert.equal(bad.length, 0);
});
