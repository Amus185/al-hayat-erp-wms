// Financial statements must derive from the ledger and reconcile to it:
// cash flow (beginning + net change = ending, by activity), balance sheet
// (net income from P&L accounts, negative cash as an overdraft), inventory and
// cash ledgers against operational records — per branch and consolidated.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as A, BRANCH_CL as B, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
let customerId: string;
const year = new Date().getFullYear();
const today = new Date().toISOString().slice(0, 10);
const currentPeriod = `fp-${year}-annual`;

before(async () => {
  t = await setupTestApp();
  customerId = await t.createCustomer();
});
after(async () => { await t?.teardown(); });

const r2 = (n: number) => Math.round(n * 100) / 100;
const tbNet = async (code: string, branch?: string) => {
  const r = await t.api('GET', `/accounting/trial-balance${branch ? `?branch_id=${branch}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r2(Number(r.body.accounts.find((a: any) => a.code === code)?.net_balance ?? 0));
};
const cashFlow = async (opts: { branch?: string; period?: string } = {}) => {
  const qs = new URLSearchParams();
  if (opts.branch) qs.set('branch_id', opts.branch);
  if (opts.period) qs.set('period_id', opts.period);
  const r = await t.api('GET', `/accounting/cash-flow?${qs}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

async function product(branchOrWh: { branch?: string; warehouse?: string }, qty: number, cost: number, price: number) {
  const res = await t.api('POST', '/products', {
    sku: `SKU-${randomUUID().slice(0, 8)}`, name: 'Item', costPrice: cost, sellingPrice: price,
    initialQuantity: qty, ...(branchOrWh.branch ? { initialBranchId: branchOrWh.branch } : { initialWarehouseId: branchOrWh.warehouse }),
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}
async function sale(branch: string, productId: string, qty: number, price: number, amountPaid?: number) {
  const o = await t.api('POST', '/sales/orders', { branchId: branch, customerId, lines: [{ productId, quantity: qty, unitPrice: price }] });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const d = await t.api('POST', `/sales/orders/${o.body.id}/complete`, amountPaid === undefined ? {} : { amountPaid });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  return { orderId: o.body.id as string, invoiceId: d.body.invoiceId as string };
}

test('setup: realistic activity in two branches and at company level', async () => {
  // Prior year: opening cash and an expense in branch A
  const open = await t.api('POST', '/accounting/opening-balances', { branch_id: A, opening_cash: 500, entry_date: `${year - 1}-01-02` });
  assert.equal(open.status, 200, JSON.stringify(open.body));
  assert.equal((await t.api('POST', '/expenses', { title: 'Old rent', amount: 100, category: 'Rent', expense_date: `${year - 1}-06-01`, branch_id: A })).status, 201);

  // Current year
  const pA = await product({ branch: A }, 10, 40, 100);
  const pB = await product({ branch: B }, 6, 30, 90);
  await sale(A, pA, 2, 100);                       // paid 200 cash
  const credit = await sale(B, pB, 1, 90, 0);       // on credit
  assert.equal((await t.api('POST', '/sales/payments', { customerId, allocationType: 'INVOICE', invoiceId: credit.invoiceId, amount: 40 })).status, 201);
  const cancelled = await sale(A, pA, 1, 100);
  assert.equal((await t.api('POST', `/sales/orders/${cancelled.orderId}/cancel`, { reason: 'test' })).status, 200);
  assert.equal((await t.api('POST', '/expenses', { title: 'Rent', amount: 50, category: 'Rent', expense_date: today, branch_id: A })).status, 201);
  assert.equal((await t.api('POST', '/expenses', { title: 'Salaries', amount: 700, category: 'Salaries', expense_date: today })).status, 201);
  assert.equal((await t.api('POST', '/inventory/adjust', { productId: pB, branchId: B, quantity: 1, direction: 'DECREASE' })).status, 201);

  // Company-level purchasing into the warehouse, then a transfer to branch A
  const pW = await t.createProduct({ cost: 20, price: 60 });
  const sup = await t.api('POST', '/purchasing/suppliers', { name: 'Supplier' });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: pW, quantity: 10, unitCost: 20 }] });
  assert.equal((await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, lines: [{ productId: pW, quantityReceived: 10 }] })).status, 201);
  assert.equal((await t.api('POST', `/purchasing/invoices/pi-${po.body.id}/payments`, { amount: 120 })).status, 201);
  const tr = await t.api('POST', '/transfers', { sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN, destinationOwnerType: 'BRANCH', destinationBranchId: A, lines: [{ productId: pW, quantityRequested: 4 }] });
  assert.equal((await t.api('POST', `/transfers/${tr.body.id}/dispatch`)).status, 200);
  assert.equal((await t.api('POST', `/transfers/${tr.body.id}/receive`)).status, 200);
  await sale(A, pW, 1, 60);                          // paid 60

  // A fixed-asset purchase (investing) by the company
  assert.equal((await t.api('POST', '/assets/properties', { name: 'Shop', property_type: 'BUILDING', purchase_price: 300, purchase_date: today })).status, 201);
});

test('every journal entry balances and every scope\'s trial balance balances', async () => {
  const unbalanced = await t.q(`SELECT je.id FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
    GROUP BY je.id HAVING ABS(SUM(l.debit_amount) - SUM(l.credit_amount)) > 0.005`);
  assert.equal(unbalanced.length, 0);
  for (const b of [A, B, 'UNASSIGNED', undefined]) {
    const r = await t.api('GET', `/accounting/trial-balance${b ? `?branch_id=${b}` : ''}`);
    assert.ok(r.body.totals.is_balanced, `trial balance ${b ?? 'ALL'}`);
  }
});

test('cash flow: beginning cash + net change = ending cash, and ending cash = the cash ledger, for every scope and period', async () => {
  for (const branch of [A, B, 'UNASSIGNED', undefined]) {
    for (const period of [undefined, currentPeriod]) {
      const cf = await cashFlow({ branch, period });
      const s = cf.summary;
      assert.equal(r2(s.beginning_cash_balance + s.net_change_in_cash), r2(s.ending_cash_balance), `${branch ?? 'ALL'} / ${period ?? 'all time'} does not reconcile`);
      assert.equal(r2(s.net_cash_from_operations + s.net_cash_from_investing + s.net_cash_from_financing), r2(s.net_change_in_cash));
      assert.equal(r2(s.ending_cash_balance), await tbNet('1010', branch), `${branch ?? 'ALL'} ending cash ≠ ledger`);
    }
  }
  // the prior-year activity in branch A is the current year's beginning balance (500 opening − 100 rent)
  const a = await cashFlow({ branch: A, period: currentPeriod });
  assert.equal(r2(a.summary.beginning_cash_balance), 400);
});

test('cash flow: owner funding is financing, a property purchase is investing, sales and expenses are operating', async () => {
  const all = await cashFlow({});
  assert.equal(r2(all.summary.net_cash_from_financing), 500, 'opening cash / owner capital not shown as financing');
  assert.equal(r2(all.summary.net_cash_from_investing), -300, 'property purchase not shown as investing');
  // operating = 200 + 40 + 60 (receipts) − 100 − 50 − 700 (expenses) − 120 (supplier)
  assert.equal(r2(all.summary.net_cash_from_operations), 200 + 40 + 60 - 100 - 50 - 700 - 120);
});

test('branch cash flows add up to the consolidated cash flow without duplication', async () => {
  const parts = await Promise.all([A, B, 'UNASSIGNED'].map((b) => cashFlow({ branch: b, period: currentPeriod })));
  const all = await cashFlow({ period: currentPeriod });
  for (const k of ['beginning_cash_balance', 'net_cash_from_operations', 'net_cash_from_investing', 'net_cash_from_financing', 'ending_cash_balance']) {
    assert.equal(r2(parts.reduce((s, p) => s + p.summary[k], 0)), r2(all.summary[k]), k);
  }
});

test('balance sheet: net income comes from the income statement accounts, and negative cash is shown as an overdraft liability', async () => {
  for (const branch of [A, B, 'UNASSIGNED', undefined]) {
    const qs = branch ? `?branch_id=${branch}` : '';
    const bs = (await t.api('GET', `/accounting/balance-sheet${qs}`)).body;
    const is = (await t.api('GET', `/accounting/income-statement${qs}`)).body;
    const ni = bs.equity.find((e: any) => e.code === '3990');
    assert.equal(r2(Number(ni?.balance ?? 0)), r2(is.summary.net_income), `${branch ?? 'ALL'}: balance-sheet net income ≠ income statement`);
    assert.ok(bs.totals.is_balanced, `${branch ?? 'ALL'} unbalanced`);
    assert.ok(bs.verification?.trial_balance_balanced, `${branch ?? 'ALL'}: no independent trial-balance check`);

    const cash = await tbNet('1010', branch);
    const assetCash = Number(bs.assets.find((a: any) => a.code === '1010')?.balance ?? 0);
    const overdraft = bs.liabilities.find((l: any) => l.code === 'OVERDRAFT');
    if (cash < 0) {
      assert.equal(assetCash, 0, `${branch ?? 'ALL'}: negative cash still shown as an asset`);
      assert.equal(r2(overdraft?.balance ?? 0), -cash, `${branch ?? 'ALL'}: overdraft liability missing`);
      assert.ok((bs.warnings || []).some((w: string) => /cash/i.test(w)), 'no warning about negative cash');
    } else {
      assert.equal(r2(assetCash), cash);
      assert.equal(overdraft, undefined);
    }
  }
  // company-level paid 700 + 120 + 300 with no inflows: an overdraft
  assert.ok(await tbNet('1010', 'UNASSIGNED') < 0);
});

test('inventory ledger equals stock on hand at cost, per branch and consolidated (no double deduction)', async () => {
  const valuation = async (where: string) => r2(Number((await t.q(
    `SELECT COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0)::float AS v FROM inventory_stock s JOIN products p ON p.id = s.product_id WHERE ${where}`,
  ))[0].v));
  assert.equal(await tbNet('1030', A), await valuation(`s.branch_id = '${A}'`));
  assert.equal(await tbNet('1030', B), await valuation(`s.branch_id = '${B}'`));
  assert.equal(await tbNet('1030', 'UNASSIGNED'), await valuation('s.branch_id IS NULL'));
  assert.equal(await tbNet('1030'), await valuation('TRUE'));
  const negative = await t.q('SELECT 1 FROM inventory_stock WHERE quantity_on_hand < 0');
  assert.equal(negative.length, 0);
});

test('branch cash ledger equals operational receipts minus payments', async () => {
  // Branch A: opening 500 − old rent 100 + paid sales 200 + 60 − rent 50
  //   (the cancelled sale's checkout payment is reversed with the sale)
  assert.equal(await tbNet('1010', A), 500 - 100 + 200 + 60 - 50);
  // Branch B: one payment of 40 on a credit sale
  assert.equal(await tbNet('1010', B), 40);
  // Company-level: salaries 700, supplier payment 120, property 300
  assert.equal(await tbNet('1010', 'UNASSIGNED'), -700 - 120 - 300);
});
