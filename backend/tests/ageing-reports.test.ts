// Payables ageing (suppliers) and stock ageing (warehouse), from real invoice and receipt dates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, WH_MAIN, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

test('payables ageing: unpaid supplier invoices fall into the right overdue bucket, net of payments', async () => {
  const product = await t.createProduct({ cost: 10, price: 30 });
  const mk = async (name: string, qty: number, daysAgo: number) => {
    const sup = await t.api('POST', '/purchasing/suppliers', { name, phone: `063${Math.floor(Math.random() * 1e7)}` });
    const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantity: qty, unitCost: 10 }] });
    await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantityReceived: qty }] });
    await t.q(`UPDATE purchase_invoices SET issued_at = CURRENT_TIMESTAMP - make_interval(days => $2) WHERE purchase_order_id = $1`, [po.body.id, daysAgo]);
    return { supplier: sup.body.id, po: po.body.id };
  };
  const fresh = await mk('Ageing Fresh', 10, 5);     // 100, terms 30 -> not due
  const late = await mk('Ageing Late', 20, 75);      // 200, 45 days overdue
  const old = await mk('Ageing Old', 30, 200);       // 300, 170 days overdue
  await t.api('POST', `/purchasing/invoices/pi-${late.po}/payments`, { amount: 50, moneyAccountId: 'money-main-cash' });
  const r = await t.api('GET', '/purchasing/payables-ageing');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const of = (id: string) => r.body.suppliers.find((s: any) => s.supplier_id === id);
  assert.equal(of(fresh.supplier).current, 100);
  assert.equal(of(late.supplier).d31_60, 150, 'net of the payment');
  assert.equal(of(old.supplier).d90_plus, 300);
  assert.equal(r.body.totals.total, r.body.suppliers.reduce((a: number, s: any) => a + s.total, 0));
  const one = await t.api('GET', `/purchasing/payables-ageing?supplierId=${old.supplier}`);
  assert.equal(one.body.suppliers.length, 1);
  // a branch manager (no cost access) cannot open it
  const mgr = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', '/purchasing/payables-ageing', undefined, mgr.token)).status, 403);
});

test('stock ageing: units on hand are aged from the newest receipts; sold units are the oldest', async () => {
  const product = await t.createProduct({ cost: 10, price: 30 });
  const sup = await t.api('POST', '/purchasing/suppliers', { name: 'Ageing Stock', phone: '0635550001' });
  const receive = async (qty: number, daysAgo: number) => {
    const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantity: qty, unitCost: 10 }] });
    const gr = await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantityReceived: qty }] });
    await t.q(`UPDATE inventory_transactions SET created_at = CURRENT_TIMESTAMP - make_interval(days => $2) WHERE reference_id = $1`, [gr.body.receipt.id, daysAgo]);
  };
  await receive(10, 100); await receive(5, 10);
  const row = async () => (await t.api('GET', `/reports/stock-ageing?warehouseId=${WH_MAIN}`)).body.rows.find((x: any) => x.product_id === product);
  let x = await row();
  assert.equal(x.quantity, 15); assert.equal(x.d0_30, 5); assert.equal(x.d91_180, 10); assert.equal(x.days_in_stock, 100);
  // 12 leave (oldest first): the 3 left are from the newest receipt
  await t.q(`UPDATE inventory_stock SET quantity_on_hand = 3 WHERE product_id = $1 AND warehouse_id = $2`, [product, WH_MAIN]);
  x = await row();
  assert.equal(x.d0_30, 3); assert.equal(x.d91_180, 0); assert.equal(x.category, '0–30 days');
});
