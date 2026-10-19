import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

async function draftOrder(productId: string, quantity: number, extra: Record<string, unknown> = {}) {
  const res = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId, quantity, unitPrice: 100 }], ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

test('cancelling a confirmed (never invoiced) order does not create stock', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 5, { branchId: BRANCH_HQ });
  const id = await draftOrder(p, 3);
  assert.equal((await t.api('POST', `/sales/orders/${id}/confirm`)).status, 200);
  assert.equal((await t.api('POST', `/sales/orders/${id}/cancel`, { reason: 'test' })).status, 200);
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 5);
});

test('cancelling a sale of a grouped product restores its components', async () => {
  const leg = await t.createProduct();
  const top = await t.createProduct();
  const table = await t.createProduct({ type: 'GROUPED' });
  await t.q(`INSERT INTO product_group_items (id, parent_product_id, component_product_id, quantity) VALUES ($1, $2, $3, 4), ($4, $2, $5, 1)`,
    [randomUUID(), table, leg, randomUUID(), top]);
  await t.setStock(leg, 8, { branchId: BRANCH_HQ });
  await t.setStock(top, 2, { branchId: BRANCH_HQ });
  const id = await draftOrder(table, 2);
  assert.equal((await t.api('POST', `/sales/orders/${id}/complete`)).status, 200);
  assert.equal(await t.stockOf(leg, { branchId: BRANCH_HQ }), 0);
  assert.equal((await t.api('POST', `/sales/orders/${id}/cancel`, { reason: 'test' })).status, 200);
  assert.equal(await t.stockOf(leg, { branchId: BRANCH_HQ }), 8);
  assert.equal(await t.stockOf(top, { branchId: BRANCH_HQ }), 2);
  assert.equal(await t.stockOf(table, { branchId: BRANCH_HQ }), 0, 'stock was invented for the bundle itself');
});

test('two simultaneous cancels restore stock once and reverse the sale once', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 4, { branchId: BRANCH_HQ });
  const id = await draftOrder(p, 4);
  assert.equal((await t.api('POST', `/sales/orders/${id}/complete`)).status, 200);
  const revenue0 = await t.accountBalance('4010');
  const results = await Promise.all([1, 2].map(() => t.api('POST', `/sales/orders/${id}/cancel`, { reason: 'x' })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 4);
  assert.equal(await t.accountBalance('4010') - revenue0, 400, 'revenue reversed more than once');
});

test('two simultaneous sales cannot oversell the last units', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 3, { branchId: BRANCH_HQ });
  const a = await draftOrder(p, 3);
  const b = await draftOrder(p, 3);
  const results = await Promise.all([a, b].map((id) => t.api('POST', `/sales/orders/${id}/complete`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 0);
});

test('a customer payment larger than the invoice balance is rejected', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const id = await draftOrder(p, 1, { customerId });
  const done = await t.api('POST', `/sales/orders/${id}/complete`, { amountPaid: 0 });
  const cash0 = await t.accountBalance('1010');
  const pay = await t.api('POST', '/sales/payments', { customerId, allocationType: 'INVOICE', invoiceId: done.body.invoiceId, amount: 150 });
  assert.equal(pay.status, 400, JSON.stringify(pay.body));
  assert.equal(await t.accountBalance('1010'), cash0);
});

test('a double-submitted customer payment is recorded once', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const id = await draftOrder(p, 1, { customerId });
  const done = await t.api('POST', `/sales/orders/${id}/complete`, { amountPaid: 0 });
  const body = { customerId, allocationType: 'INVOICE', invoiceId: done.body.invoiceId, amount: 100 };
  const results = await Promise.all([1, 2].map(() => t.api('POST', '/sales/payments', body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.body)));
  const paid = await t.q('SELECT COALESCE(SUM(amount), 0)::float AS s FROM invoice_payments WHERE invoice_id = $1', [done.body.invoiceId]);
  assert.equal(paid[0].s, 100);
});

test('an invoiced order cannot be hard-deleted', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const id = await draftOrder(p, 1);
  await t.api('POST', `/sales/orders/${id}/complete`);
  const del = await t.api('DELETE', `/sales/orders/${id}`);
  assert.equal(del.status, 400, JSON.stringify(del.body));
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM invoices WHERE sales_order_id = $1', [id]))[0].n, 1);
});

test('a credit sale posts its journal in the same transaction as the invoice', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const ar0 = await t.accountBalance('1020');
  const res = await t.api('POST', '/sales/orders', {
    branchId: BRANCH_HQ, customerId, isCreditSale: true, initialDeposit: 30, lines: [{ productId: p, quantity: 1, unitPrice: 100 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await t.accountBalance('1020') - ar0, 70);
});

test('a walk-in credit sale with a deposit records the deposit as an invoice payment', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 2, { branchId: BRANCH_HQ });
  const res = await t.api('POST', '/sales/orders', {
    branchId: BRANCH_HQ, isCreditSale: true, initialDeposit: 100, lines: [{ productId: p, quantity: 1, unitPrice: 100 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const paid = await t.q('SELECT COALESCE(SUM(amount), 0)::float AS s FROM invoice_payments WHERE invoice_id = $1', [res.body.invoice_id]);
  assert.equal(paid[0].s, 100);
});
