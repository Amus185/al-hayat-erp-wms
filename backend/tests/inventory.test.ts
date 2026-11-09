import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

async function transfer(productId: string, qty: number) {
  const res = await t.api('POST', '/transfers', {
    sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN,
    destinationOwnerType: 'BRANCH', destinationBranchId: BRANCH_HQ,
    lines: [{ productId, quantityRequested: qty }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

test('a double-submitted transfer dispatch deducts the source once', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 10, { warehouseId: WH_MAIN });
  const id = await transfer(p, 4);
  const results = await Promise.all([1, 2].map(() => t.api('POST', `/transfers/${id}/dispatch`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.stockOf(p, { warehouseId: WH_MAIN }), 6);
});

test('a double-submitted transfer receipt adds to the destination once', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 10, { warehouseId: WH_MAIN });
  const id = await transfer(p, 4);
  assert.equal((await t.api('POST', `/transfers/${id}/dispatch`)).status, 200);
  const results = await Promise.all([1, 2].map(() => t.api('POST', `/transfers/${id}/receive`)));
  assert.equal(results.filter((r) => r.status === 200).length, 1, JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.stockOf(p, { branchId: BRANCH_HQ }), 4);
});

test('transfer stock movements reconcile with balances', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 10, { warehouseId: WH_MAIN });
  const id = await transfer(p, 7);
  await t.api('POST', `/transfers/${id}/dispatch`);
  await t.api('POST', `/transfers/${id}/receive`);
  const moves = await t.q(`SELECT transaction_type, SUM(quantity)::int AS q FROM inventory_transactions WHERE reference_id = $1 GROUP BY 1`, [id]);
  const by = Object.fromEntries(moves.map((m: any) => [m.transaction_type, m.q]));
  assert.deepEqual(by, { TRANSFER_OUT: -7, TRANSFER_IN: 7 });
  assert.equal(await t.stockOf(p, { warehouseId: WH_MAIN }) + await t.stockOf(p, { branchId: BRANCH_HQ }), 10);
});

async function purchaseOrder(productId: string, quantity: number, unitCost: number) {
  const supplier = await t.api('POST', '/purchasing/suppliers', { name: `Supplier ${Date.now()}` });
  const po = await t.api('POST', '/purchasing/orders', {
    supplierId: supplier.body.id, warehouseId: WH_MAIN, lines: [{ productId, quantity, unitCost }],
  });
  assert.equal(po.status, 201, JSON.stringify(po.body));
  return po.body.id as string;
}

test('purchase receipt increases stock and payables; partial payments settle the payable', async () => {
  const p = await t.createProduct();
  const poId = await purchaseOrder(p, 10, 20);
  const ap0 = await t.accountBalance('2010');
  const rec = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: poId, lines: [{ productId: p, quantityReceived: 10 }] });
  assert.equal(rec.status, 201, JSON.stringify(rec.body));
  assert.equal(await t.stockOf(p, { warehouseId: WH_MAIN }), 10);
  assert.equal(await t.accountBalance('2010') - ap0, -200);

  const invoiceId = `pi-${poId}`;
  assert.equal((await t.api('POST', `/purchasing/invoices/${invoiceId}/payments`, { amount: 120, moneyAccountId: 'money-main-cash' })).status, 201);
  assert.equal((await t.api('POST', `/purchasing/invoices/${invoiceId}/payments`, { amount: 80, moneyAccountId: 'money-main-cash' })).status, 201);
  assert.equal(await t.accountBalance('2010') - ap0, 0, 'second partial payment missing from the ledger');
  const over = await t.api('POST', `/purchasing/invoices/${invoiceId}/payments`, { amount: 1, moneyAccountId: 'money-main-cash' });
  assert.equal(over.status, 400);
});

test('a double-submitted supplier payment is recorded once', async () => {
  const p = await t.createProduct();
  const poId = await purchaseOrder(p, 5, 20);
  const results = await Promise.all([1, 2].map(() => t.api('POST', `/purchasing/invoices/pi-${poId}/payments`, { amount: 100, moneyAccountId: 'money-main-cash' })));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.body)));
  const paid = await t.q('SELECT COALESCE(SUM(amount), 0)::float AS s FROM purchase_invoice_payments WHERE purchase_invoice_id = $1', [`pi-${poId}`]);
  assert.equal(paid[0].s, 100);
});

test('a double-submitted goods receipt cannot over-receive the purchase order', async () => {
  const p = await t.createProduct();
  const poId = await purchaseOrder(p, 5, 20);
  const body = { purchaseOrderId: poId, lines: [{ productId: p, quantityReceived: 5 }] };
  const results = await Promise.all([1, 2].map(() => t.api('POST', '/purchasing/receipts', body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.body)));
  assert.equal(await t.stockOf(p, { warehouseId: WH_MAIN }), 5);
});

test('bulk import reports existing SKUs as skipped instead of failing or counting them as created', async () => {
  const existing = await t.q('SELECT sku FROM products LIMIT 1');
  const res = await t.api('POST', '/products/bulk', [
    { sku: existing[0].sku, name: 'Duplicate', initialStock: 5 },
    { sku: `NEW-${Date.now()}`, name: 'New product', initialStock: 2 },
    { name: 'Missing SKU' },
  ]);
  assert.equal(res.status, 207, JSON.stringify(res.body));
  assert.equal(res.body.created, 1);
  assert.equal(res.body.skipped.length, 2);
});

test('a product with stock or movement history cannot be hard-deleted', async () => {
  const p = await t.createProduct();
  await t.setStock(p, 3, { warehouseId: WH_MAIN });
  const adj = await t.api('POST', '/inventory/adjust', { productId: p, warehouseId: WH_MAIN, quantity: 1, direction: 'DECREASE' });
  assert.equal(adj.status, 201, JSON.stringify(adj.body));
  const del = await t.api('DELETE', `/products/${p}`);
  assert.equal(del.status, 400, JSON.stringify(del.body));
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE product_id = $1', [p]))[0].n, 1);
});

test('stock adjustment of a zero-cost product does not invent a value in the ledger', async () => {
  const p = await t.createProduct({ cost: 0 });
  await t.setStock(p, 3, { warehouseId: WH_MAIN });
  const inv0 = await t.accountBalance('1030');
  const adj = await t.api('POST', '/inventory/adjust', { productId: p, warehouseId: WH_MAIN, quantity: 2, direction: 'INCREASE' });
  assert.equal(adj.status, 201, JSON.stringify(adj.body));
  assert.equal(await t.accountBalance('1030'), inv0);
});
