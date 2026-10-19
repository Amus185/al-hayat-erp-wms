import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

/** Sells `qty` units on credit (nothing paid) via the one-click complete flow. */
async function creditSale(qty = 1, price = 100) {
  const productId = await t.createProduct({ cost: 40, price });
  await t.setStock(productId, 10, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const order = await t.api('POST', '/sales/orders', {
    branchId: BRANCH_HQ, customerId, lines: [{ productId, quantity: qty, unitPrice: price }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const done = await t.api('POST', `/sales/orders/${order.body.id}/complete`, { amountPaid: 0 });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { orderId: order.body.id as string, invoiceId: done.body.invoiceId as string, customerId, productId };
}

test('viewing the accounting dashboard never writes journal entries', async () => {
  const { invoiceId, customerId } = await creditSale(1, 100);
  const pay = await t.api('POST', '/sales/payments', { customerId, allocationType: 'INVOICE', invoiceId, amount: 100 });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));

  const before = await t.journalCount();
  const cashBefore = await t.accountBalance('1010');
  assert.equal(cashBefore, 100);

  const dash = await t.api('GET', '/accounting/dashboard');
  assert.equal(dash.status, 200);
  assert.equal(await t.journalCount(), before, 'GET /accounting/dashboard created journal entries');
  assert.equal(await t.accountBalance('1010'), 100, 'cash was double counted');
});

test('reconcile-journals does not duplicate payments already posted under their payment id', async () => {
  const { invoiceId, customerId } = await creditSale(1, 50);
  await t.api('POST', '/sales/payments', { customerId, allocationType: 'INVOICE', invoiceId, amount: 50 });
  const cash = await t.accountBalance('1010');
  const res = await t.api('POST', '/accounting/reconcile-journals');
  assert.equal(res.status, 200);
  assert.equal(await t.accountBalance('1010'), cash);
});

test('a reversed manual journal entry nets to zero in the trial balance and the general ledger', async () => {
  const coa = await t.q("SELECT id, code FROM chart_of_accounts WHERE code IN ('6010', '1010')");
  const id = (code: string) => coa.find((r: any) => r.code === code).id;
  const created = await t.api('POST', '/accounting/journal-entries', {
    entry_date: new Date().toISOString().slice(0, 10), description: 'Test rent',
    lines: [
      { account_id: id('6010'), debit_amount: 300, credit_amount: 0 },
      { account_id: id('1010'), debit_amount: 0, credit_amount: 300 },
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const rent0 = await t.accountBalance('6010');

  assert.equal((await t.api('POST', `/accounting/journal-entries/${created.body.id}/post`)).status, 200);
  const rev = await t.api('POST', `/accounting/journal-entries/${created.body.id}/reverse`);
  assert.equal(rev.status, 201, JSON.stringify(rev.body));

  const tb = await t.api('GET', '/accounting/trial-balance');
  const rent = tb.body.accounts.find((a: any) => a.code === '6010');
  assert.equal(Number(rent?.net_balance ?? 0), rent0, 'trial balance shows the reversal without the original');

  const gl = await t.q(
    `SELECT COALESCE(SUM(debit_amount - credit_amount), 0)::float AS bal FROM general_ledger WHERE journal_entry_id IN ($1, $2)`,
    [created.body.id, rev.body.id],
  );
  assert.equal(gl[0].bal, 0, 'general ledger is missing the reversal rows');
});

test('income statement reports cost of goods sold in the COGS section', async () => {
  await creditSale(2, 100);
  const is = await t.api('GET', '/accounting/income-statement');
  assert.equal(is.status, 200);
  assert.ok(is.body.summary.total_cogs > 0, `total_cogs was ${is.body.summary.total_cogs}`);
  assert.equal(is.body.summary.gross_profit, is.body.summary.total_revenue - is.body.summary.total_cogs);
});

test('invoicing a confirmed order posts receivable including the installation fee, atomically', async () => {
  const productId = await t.createProduct({ cost: 10, price: 200 });
  await t.setStock(productId, 5, { branchId: BRANCH_HQ });
  const customerId = await t.createCustomer();
  const order = await t.api('POST', '/sales/orders', {
    branchId: BRANCH_HQ, customerId, installationFee: 25, lines: [{ productId, quantity: 1, unitPrice: 200 }],
  });
  const ar0 = await t.accountBalance('1020');
  assert.equal((await t.api('POST', `/sales/orders/${order.body.id}/confirm`)).status, 200);
  const inv = await t.api('POST', `/sales/orders/${order.body.id}/invoice`);
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  assert.equal(await t.accountBalance('1020') - ar0, 225);
});

test('completing an already-invoiced order records the payment in the ledger', async () => {
  const productId = await t.createProduct({ cost: 10, price: 80 });
  await t.setStock(productId, 5, { branchId: BRANCH_HQ });
  const order = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, lines: [{ productId, quantity: 1, unitPrice: 80 }] });
  await t.api('POST', `/sales/orders/${order.body.id}/confirm`);
  await t.api('POST', `/sales/orders/${order.body.id}/invoice`);
  const cash0 = await t.accountBalance('1010');
  const done = await t.api('POST', `/sales/orders/${order.body.id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await t.accountBalance('1010') - cash0, 80);
});

test('deleting an expense reverses its journal entry; editing the amount re-posts it', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const base = await t.accountBalance('6010');
  const e = await t.api('POST', '/expenses', { title: 'Rent', amount: 500, category: 'Rent', expense_date: today });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(await t.accountBalance('6010') - base, 500);

  assert.equal((await t.api('PATCH', `/expenses/${e.body.id}`, { amount: 450 })).status, 200);
  assert.equal(await t.accountBalance('6010') - base, 450, 'ledger not updated after editing the amount');

  assert.equal((await t.api('DELETE', `/expenses/${e.body.id}`)).status, 200);
  assert.equal(await t.accountBalance('6010') - base, 0, 'ledger still holds the deleted expense');
});

test('postings dated inside a closed fiscal period are rejected instead of moved to another period', async () => {
  await t.q(`INSERT INTO fiscal_periods (id, name, period_name, period_type, start_date, end_date, status)
             VALUES ('fp-closed-2020', 'FY 2020', 'FY 2020', 'ANNUAL', '2020-01-01', '2020-12-31', 'CLOSED')`);
  const n0 = await t.journalCount();
  const e = await t.api('POST', '/expenses', { title: 'Backdated', amount: 10, category: 'Rent', expense_date: '2020-06-01' });
  assert.notEqual(e.status, 201, 'expense was posted into a closed period');
  assert.equal(await t.journalCount(), n0);
});

test('manufacturing completion moves work-in-progress into finished goods', async () => {
  const material = await t.createProduct({ cost: 5 });
  const finished = await t.createProduct({ cost: 0 });
  await t.setStock(material, 100, { warehouseId: WH_MAIN });
  const wo = await t.q(
    `INSERT INTO work_orders (id, wo_number, product_id, warehouse_id, target_quantity, status)
     VALUES (gen_random_uuid()::text, 'WO-T1', $1, $2, 2, 'PLANNED') RETURNING id`, [finished, WH_MAIN]);
  await t.q(`INSERT INTO work_order_materials (id, work_order_id, material_product_id, planned_quantity, unit_cost)
             VALUES (gen_random_uuid()::text, $1, $2, 10, 5)`, [wo[0].id, material]);

  const wip0 = await t.accountBalance('1070');
  assert.equal((await t.api('POST', `/manufacturing/work-orders/${wo[0].id}/start`)).status, 200);
  assert.equal(await t.accountBalance('1070') - wip0, 50);
  const done = await t.api('POST', `/manufacturing/work-orders/${wo[0].id}/complete`, { completedQuantity: 2 });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await t.accountBalance('1070') - wip0, 0, 'WIP was never relieved');
});

test('starting a work order without enough raw material is rejected', async () => {
  const material = await t.createProduct({ cost: 5 });
  const finished = await t.createProduct({ cost: 0 });
  await t.setStock(material, 3, { warehouseId: WH_MAIN });
  const wo = await t.q(
    `INSERT INTO work_orders (id, wo_number, product_id, warehouse_id, target_quantity, status)
     VALUES (gen_random_uuid()::text, 'WO-T2', $1, $2, 1, 'PLANNED') RETURNING id`, [finished, WH_MAIN]);
  await t.q(`INSERT INTO work_order_materials (id, work_order_id, material_product_id, planned_quantity, unit_cost)
             VALUES (gen_random_uuid()::text, $1, $2, 10, 5)`, [wo[0].id, material]);
  const res = await t.api('POST', `/manufacturing/work-orders/${wo[0].id}/start`);
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(await t.stockOf(material, { warehouseId: WH_MAIN }), 3);
});
