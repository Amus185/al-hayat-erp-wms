// Branch-specific accounting: isolation, admin consolidation/filtering, attribution,
// integrity, live scope changes, inter-branch transfers, closing, historical data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as A, BRANCH_CL as B, WH_MAIN, type TestCtx } from './helpers';

let t: TestCtx;
type U = { id: string; token: string };
let userA: U, userB: U, accountant: U, noBranch: U;
let customerId: string;
const fx: Record<string, any> = {};

/** A credit sale, a payment, an expense and a manual charge in one branch. */
async function branchActivity(branch: string, price: number, expense: number, debt: number) {
  const p = await t.createProduct({ cost: 40, price });
  await t.setStock(p, 10, { branchId: branch });
  const order = await t.api('POST', '/sales/orders', {
    branchId: branch, customerId, isCreditSale: true, lines: [{ productId: p, quantity: 1, unitPrice: price }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const pay = await t.api('POST', '/sales/payments', { customerId, allocationType: 'INVOICE', invoiceId: order.body.invoice_id, amount: 30 });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  const exp = await t.api('POST', '/expenses', { title: `Rent ${branch}`, amount: expense, category: 'Rent', expense_date: new Date().toISOString().slice(0, 10), branch_id: branch });
  assert.equal(exp.status, 201, JSON.stringify(exp.body));
  const d = await t.api('POST', `/sales/customers/${customerId}/debts`, { amount: debt, description: `Charge ${branch}`, branchId: branch });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  return { orderId: order.body.id, invoiceId: order.body.invoice_id, paymentId: pay.body.receipt.payment_id, expenseId: exp.body.id, debtId: d.body.id };
}

before(async () => {
  t = await setupTestApp();
  userA = await t.createUser({ branchId: A, roleId: 'role-branch-user', role: 'branch_user', grants: ['accounting.view'] });
  userB = await t.createUser({ branchId: B, roleId: 'role-branch-user', role: 'branch_user', grants: ['accounting.view'] });
  accountant = await t.createUser({ branchId: null, roleId: 'role-accountant', role: 'accountant' });
  noBranch = await t.createUser({ branchId: null, roleId: 'role-sales-rep', role: 'sales_rep' });
  customerId = await t.createCustomer();
  fx.A = await branchActivity(A, 100, 15, 20);
  fx.B = await branchActivity(B, 300, 25, 40);
  // Company-level purchasing (no branch): goods receipt + supplier payment
  const product = await t.createProduct({ cost: 10 });
  const supplier = await t.api('POST', '/purchasing/suppliers', { name: 'Supplier X' });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: supplier.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantity: 5, unitCost: 10 }] });
  assert.equal((await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, lines: [{ productId: product, quantityReceived: 5 }] })).status, 201);
  assert.equal((await t.api('POST', `/purchasing/invoices/pi-${po.body.id}/payments`, { amount: 20 })).status, 201);
});
after(async () => { await t?.teardown(); });

const tb = async (token: string, branch?: string, type = 'UNADJUSTED') => {
  const r = await t.api('GET', `/accounting/trial-balance?type=${type}${branch ? `&branch_id=${branch}` : ''}`, undefined, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const net = (tbBody: any, code: string) => Number(tbBody.accounts.find((a: any) => a.code === code)?.net_balance ?? 0);
const lineBranches = async (sql: string, params: unknown[]) => (await t.q(sql, params)).map((r: any) => r.branch_id);

test('A. a branch user sees only their own branch journal entries', async () => {
  for (const [u, own, other] of [[userA, A, B], [userB, B, A]] as const) {
    const r = await t.api('GET', '/accounting/journal-entries?limit=200', undefined, u.token);
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 0);
    assert.deepEqual([...new Set(r.body.map((e: any) => e.branch_id))], [own], `leaked: ${JSON.stringify([...new Set(r.body.map((e: any) => e.branch_id))])}`);
    assert.ok(!r.body.some((e: any) => e.branch_id === other));
  }
});

test('A. a branch user cannot widen scope through the branch filter', async () => {
  for (const path of ['/accounting/journal-entries', '/accounting/trial-balance', '/accounting/income-statement', '/accounting/balance-sheet',
    '/accounting/general-ledger', '/accounting/cash-flow', '/accounting/dashboard', '/accounting/owners-equity', '/accounting/inventory-counts']) {
    for (const branch of [B, 'UNASSIGNED']) {
      const r = await t.api('GET', `${path}?branch_id=${branch}`, undefined, userA.token);
      assert.equal(r.status, 403, `${path}?branch_id=${branch} → ${r.status}`);
    }
  }
});

test('E. a branch user cannot open another branch\'s journal entry, ledger lines or payment', async () => {
  const [bEntry] = await t.q("SELECT id FROM journal_entries WHERE branch_id = $1 LIMIT 1", [B]);
  const detail = await t.api('GET', `/accounting/journal-entries/${bEntry.id}`, undefined, userA.token);
  assert.equal(detail.status, 404, JSON.stringify(detail.body));
  const gl = await t.api('GET', '/accounting/general-ledger', undefined, userA.token);
  assert.equal(gl.status, 200);
  assert.ok(gl.body.length > 0 && gl.body.every((r: any) => r.branch_id === A), 'ledger leaked other branches');
  const flow = await t.api('GET', '/accounting/audit/transaction-flow', undefined, userA.token);
  assert.equal(flow.status, 200);
  assert.ok(JSON.stringify(flow.body).indexOf(fx.B.paymentId) === -1, 'transaction flow leaked branch B payment');
});

test('A/C. each branch view shows only that branch\'s figures; admin filter matches the branch user view', async () => {
  const expected = { [A]: { revenue: 120, rent: 15, cash: 15 }, [B]: { revenue: 340, rent: 25, cash: 5 } };
  for (const [u, branch] of [[userA, A], [userB, B]] as const) {
    const mine = await tb(u.token);
    const viaAdmin = await tb(t.adminToken, branch);
    assert.equal(net(mine, '4010'), expected[branch].revenue, `${branch} revenue`);
    assert.equal(net(mine, '6010'), expected[branch].rent, `${branch} rent`);
    assert.equal(net(mine, '1010'), expected[branch].cash, `${branch} cash`);
    assert.deepEqual(mine.accounts, viaAdmin.accounts, 'admin branch filter differs from the branch user view');

    const is = await t.api('GET', '/accounting/income-statement', undefined, u.token);
    assert.equal(is.body.summary.total_revenue, expected[branch].revenue);
    const dash = await t.api('GET', '/accounting/dashboard', undefined, u.token);
    assert.equal(dash.body.total_revenue, expected[branch].revenue);
    assert.equal(dash.body.net_income, is.body.summary.net_income, 'dashboard disagrees with income statement');
    const cf = await t.api('GET', '/accounting/cash-flow', undefined, u.token);
    assert.equal(cf.body.summary.net_cash_from_operations, expected[branch].cash);
    assert.equal(cf.body.summary.ending_cash_balance, expected[branch].cash);
  }
});

test('B. admin "All branches" equals branch A + branch B + unassigned, without duplication', async () => {
  const all = await tb(t.adminToken);
  const parts = await Promise.all([A, B, 'UNASSIGNED'].map((b) => tb(t.adminToken, b)));
  for (const code of ['1010', '1020', '1030', '2010', '4010', '5010', '6010']) {
    const sum = Math.round(parts.reduce((s, p) => s + net(p, code), 0) * 100) / 100;
    assert.equal(Math.round(net(all, code) * 100) / 100, sum, `account ${code}`);
  }
  assert.equal(net(all, '4010'), 460);
  assert.equal(net(parts[2], '2010'), 30, 'unassigned (company) payable after receipt 50 - payment 20');
  const dashAll = await t.api('GET', '/accounting/dashboard');
  const dashParts = await Promise.all([A, B, 'UNASSIGNED'].map((b) => t.api('GET', `/accounting/dashboard?branch_id=${b}`)));
  assert.equal(dashAll.body.total_revenue, dashParts.reduce((s, d) => s + d.body.total_revenue, 0));
  assert.equal(dashAll.body.total_expenses, dashParts.reduce((s, d) => s + d.body.total_expenses, 0));
});

test('D. every scope\'s trial balance and balance sheet balance', async () => {
  for (const branch of [A, B, 'UNASSIGNED', undefined]) {
    const r = await tb(t.adminToken, branch);
    assert.ok(r.totals.is_balanced, `trial balance unbalanced for ${branch ?? 'ALL'}`);
    const bs = await t.api('GET', `/accounting/balance-sheet${branch ? `?branch_id=${branch}` : ''}`);
    assert.ok(bs.body.totals.is_balanced, `balance sheet unbalanced for ${branch ?? 'ALL'}: ${JSON.stringify(bs.body.totals)}`);
  }
});

test('D. payments and charges are attributed to the branch of the document they settle', async () => {
  // admin (no branch) paid branch B's invoice: the cash belongs to branch B
  assert.deepEqual(await lineBranches(
    "SELECT DISTINCT jel.branch_id FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id WHERE je.reference_id = $1", [fx.B.paymentId]), [B]);
  const pay = await t.api('POST', '/sales/payments', { customerId, allocationType: 'MANUAL_DEBT', manualDebtId: fx.B.debtId, amount: 5 });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  assert.deepEqual(await lineBranches("SELECT DISTINCT branch_id FROM journal_entries WHERE reference_id = $1", [pay.body.receipt.payment_id]), [B]);
  const cp = await t.q('SELECT branch_id FROM customer_payments WHERE id = $1', [pay.body.receipt.payment_id]);
  assert.equal(cp[0].branch_id, B);
});

test('A. a branch user\'s manual charge and account payment stay in their own branch', async () => {
  const cross = await t.api('POST', `/sales/customers/${customerId}/debts`, { amount: 7, description: 'Try B', branchId: B }, userA.token);
  assert.equal(cross.status, 403, 'an explicit other-branch request must be refused, not silently redirected');
  const d = await t.api('POST', `/sales/customers/${customerId}/debts`, { amount: 7, description: 'Own' }, userA.token);
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.equal(d.body.branch_id, A);
  const acct = await t.api('POST', '/sales/payments', { customerId, allocationType: 'ACCOUNT', amount: 7 }, userA.token);
  assert.equal(acct.status, 201, JSON.stringify(acct.body));
  assert.equal((await t.q('SELECT branch_id FROM customer_payments WHERE id = $1', [acct.body.receipt.payment_id]))[0].branch_id, A);
});

test('A. receivable balances are scoped to the viewer\'s branch', async () => {
  const forA = await t.api('GET', `/sales/customers/${customerId}/balance`, undefined, userA.token);
  const forB = await t.api('GET', `/sales/customers/${customerId}/balance`, undefined, userB.token);
  const forAdmin = await t.api('GET', `/sales/customers/${customerId}/balance`);
  assert.equal(forA.status, 200);
  assert.equal(Math.round((forA.body.current_balance + forB.body.current_balance) * 100), Math.round(forAdmin.body.current_balance * 100));
  assert.ok(forA.body.current_balance < forAdmin.body.current_balance);
  const debtsA = await t.api('GET', '/sales/debts?status=ALL', undefined, userA.token);
  const row = debtsA.body.find((r: any) => r.id === customerId);
  assert.equal(row.current_balance, forA.body.current_balance);
  const ledgerA = await t.api('GET', `/sales/customers/${customerId}/ledger`, undefined, userA.token);
  assert.ok(!JSON.stringify(ledgerA.body).includes(fx.B.invoiceId), 'customer ledger leaked branch B invoice');
  const summaryA = await t.api('GET', '/sales/debts/summary', undefined, userA.token);
  assert.equal(Math.round(summaryA.body.total_outstanding_debt * 100), Math.round(forA.body.current_balance * 100));
});

test('E. a branch user cannot read or change another branch\'s expenses', async () => {
  const list = await t.api('GET', '/expenses', undefined, userA.token);
  assert.ok(list.body.length > 0 && list.body.every((e: any) => e.branch_id === A));
  assert.equal((await t.api('GET', `/expenses?branch_id=${B}`, undefined, userA.token)).status, 403);
  assert.equal((await t.api('PATCH', `/expenses/${fx.B.expenseId}`, { amount: 1 }, userA.token)).status, 404);
  assert.equal((await t.api('DELETE', `/expenses/${fx.B.expenseId}`, undefined, userA.token)).status, 404);
});

test('A. branch users cannot post into, post, or reverse another branch\'s journals', async () => {
  const coa = await t.q("SELECT id, code FROM chart_of_accounts WHERE code IN ('6050', '1010')");
  const acc = (code: string) => coa.find((r: any) => r.code === code).id;
  const lines = (branch?: string) => [
    { account_id: acc('6050'), debit_amount: 9, credit_amount: 0, branch_id: branch },
    { account_id: acc('1010'), debit_amount: 0, credit_amount: 9, branch_id: branch },
  ];
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await t.api('POST', '/accounting/journal-entries', { entry_date: day, description: 'x', branch_id: B, lines: lines() }, userA.token)).status, 403);
  assert.equal((await t.api('POST', '/accounting/journal-entries', { entry_date: day, description: 'x', lines: lines(B) }, userA.token)).status, 403);
  const own = await t.api('POST', '/accounting/journal-entries', { entry_date: day, description: 'own', lines: lines() }, userA.token);
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.equal(own.body.branch_id, A);
  assert.deepEqual(await lineBranches('SELECT DISTINCT branch_id FROM journal_entry_lines WHERE journal_entry_id = $1', [own.body.id]), [A]);

  const forB = await t.api('POST', '/accounting/journal-entries', { entry_date: day, description: 'b', branch_id: B, lines: lines() });
  assert.equal(forB.status, 201, JSON.stringify(forB.body));
  assert.equal((await t.api('POST', `/accounting/journal-entries/${forB.body.id}/post`, {}, userA.token)).status, 404);
  assert.equal((await t.api('POST', `/accounting/journal-entries/${forB.body.id}/post`, {})).status, 200);
  assert.equal((await t.api('POST', `/accounting/journal-entries/${forB.body.id}/reverse`, {}, userA.token)).status, 404);
});

test('D. a journal entry cannot mix branches (API and database constraint)', async () => {
  const coa = await t.q("SELECT id, code FROM chart_of_accounts WHERE code IN ('6050', '1010')");
  const acc = (code: string) => coa.find((r: any) => r.code === code).id;
  const mixed = await t.api('POST', '/accounting/journal-entries', {
    entry_date: new Date().toISOString().slice(0, 10), description: 'mixed', branch_id: A,
    lines: [{ account_id: acc('6050'), debit_amount: 5, credit_amount: 0, branch_id: A }, { account_id: acc('1010'), debit_amount: 0, credit_amount: 5, branch_id: B }],
  });
  assert.equal(mixed.status, 400, JSON.stringify(mixed.body));
  const [entry] = await t.q('SELECT id FROM journal_entries WHERE branch_id = $1 LIMIT 1', [A]);
  await assert.rejects(t.q(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, branch_id, line_order)
    VALUES ($1, $2, $3, 0, 0, $4, 99)`, [randomUUID(), entry.id, acc('1010'), B]), /branch/i);
});

test('A. company-wide accounting configuration is restricted to all-branch roles', async () => {
  const period = (await t.q('SELECT id FROM fiscal_periods LIMIT 1'))[0].id;
  const attempts: Array<[string, string, unknown]> = [
    ['POST', '/accounting/fiscal-periods', { name: 'X', start_date: '2030-01-01', end_date: '2030-12-31' }],
    ['PATCH', `/accounting/fiscal-periods/${period}/status`, { status: 'CLOSED' }],
    ['POST', '/accounting/chart-of-accounts', { code: '9999', name: 'X', account_type: 'ASSET' }],
    ['POST', '/accounting/closing-entries', { fiscal_period_id: period }],
    ['POST', '/accounting/reconcile-journals', {}],
    ['POST', '/accounting/depreciation', { asset_name: 'x', acquisition_date: '2026-01-01', cost: 1, useful_life_years: 1, period_depreciation: 1 }],
  ];
  for (const [method, path, body] of attempts) {
    assert.equal((await t.api(method, path, body, userA.token)).status, 403, `${method} ${path}`);
  }
  assert.equal((await t.q("SELECT status FROM fiscal_periods WHERE id = $1", [period]))[0].status, 'OPEN');
});

test('A. a user with neither a branch nor an all-branch role is denied; an accountant gets the consolidated view', async () => {
  assert.equal((await t.api('GET', '/accounting/trial-balance', undefined, noBranch.token)).status, 403);
  assert.equal((await t.api('GET', '/expenses', undefined, noBranch.token)).status, 403);
  assert.equal((await t.api('GET', `/sales/customers/${customerId}/balance`, undefined, noBranch.token)).status, 403);
  const acc = await tb(accountant.token);
  assert.equal(net(acc, '4010'), net(await tb(t.adminToken), '4010'));
});

test('F. changing a user\'s branch takes effect on the next request without a new login', async () => {
  const u = await t.createUser({ branchId: A, roleId: 'role-branch-user', role: 'branch_user', grants: ['accounting.view'] });
  assert.equal(net(await tb(u.token), '4010'), net(await tb(userA.token), '4010'));
  const res = await t.api('PATCH', `/users/${u.id}`, { fullName: 'Moved', email: `${u.id}@test.local`, branchId: B, isActive: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(net(await tb(u.token), '4010'), net(await tb(userB.token), '4010'), 'old branch still visible with the old token');
  const off = await t.api('PATCH', `/users/${u.id}`, { fullName: 'Moved', email: `${u.id}@test.local`, branchId: B, isActive: false });
  assert.equal(off.status, 200);
  assert.equal((await t.api('GET', '/accounting/trial-balance', undefined, u.token)).status, 401);
});

test('G. a duplicated payment request is recorded once and only in its branch', async () => {
  const before = await tb(t.adminToken, A);
  const beforeB = await tb(t.adminToken, B);
  const body = { customerId, allocationType: 'INVOICE', invoiceId: fx.A.invoiceId, amount: 70 };
  const results = await Promise.all([1, 2].map(() => t.api('POST', '/sales/payments', body)));
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.body)));
  const after = await tb(t.adminToken, A);
  assert.equal(net(after, '1010') - net(before, '1010'), 70);
  assert.equal(net(await tb(t.adminToken, B), '1010'), net(beforeB, '1010'), 'branch B cash changed');
});

test('D. an inter-branch stock transfer moves inventory value between branch books via a clearing account', async () => {
  const p = await t.createProduct({ cost: 40 });
  await t.setStock(p, 10, { warehouseId: WH_MAIN });
  const tr = await t.api('POST', '/transfers', {
    sourceOwnerType: 'WAREHOUSE', sourceWarehouseId: WH_MAIN, destinationOwnerType: 'BRANCH', destinationBranchId: A,
    lines: [{ productId: p, quantityRequested: 3 }],
  });
  const invA0 = net(await tb(t.adminToken, A), '1030');
  const invU0 = net(await tb(t.adminToken, 'UNASSIGNED'), '1030');
  const invAll0 = net(await tb(t.adminToken), '1030');
  assert.equal((await t.api('POST', `/transfers/${tr.body.id}/dispatch`)).status, 200);
  assert.equal((await t.api('POST', `/transfers/${tr.body.id}/receive`)).status, 200);
  assert.equal(net(await tb(t.adminToken, A), '1030') - invA0, 120);
  assert.equal(net(await tb(t.adminToken, 'UNASSIGNED'), '1030') - invU0, -120);
  assert.equal(net(await tb(t.adminToken), '1030'), invAll0, 'consolidated inventory changed on an internal transfer');
  assert.equal(net(await tb(t.adminToken), '1090'), 0, 'inter-branch clearing does not net to zero');
});

test('H. history: unbranched journals are backfilled only when their source document proves the branch', async () => {
  // Legacy rows written before branch attribution: a payment journal keyed `<order>-pay`
  // (branch provable from the order) and an unallocated account payment (not provable).
  const coa = await t.q("SELECT id, code FROM chart_of_accounts WHERE code IN ('1010', '1020')");
  const acc = (code: string) => coa.find((r: any) => r.code === code).id;
  const legacy = async (id: string, ref: string) => {
    await t.q(`INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit)
               VALUES ($1, $1, CURRENT_DATE, 'legacy', 'SALE', $2, 'POSTED', 1, 1)`, [id, ref]);
    await t.q(`INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, line_order)
               VALUES ($1, $2, $3, 1, 0, 1), ($4, $2, $5, 0, 1, 2)`, [randomUUID(), id, acc('1010'), randomUUID(), acc('1020')]);
  };
  const provable = `legacy-${randomUUID().slice(0, 8)}`;
  const ambiguous = `legacy-${randomUUID().slice(0, 8)}`;
  const acctPay = randomUUID();
  await t.q(`INSERT INTO customer_payments (id, receipt_number, customer_id, allocation_type, amount) VALUES ($1, $2, $3, 'ACCOUNT', 1)`, [acctPay, `R-${acctPay.slice(0, 6)}`, customerId]);
  await legacy(provable, `${fx.B.orderId}-pay`);
  await legacy(ambiguous, acctPay);

  execFileSync(process.execPath, ['--import', 'tsx', '-e', `
    const pg = require('pg');
    const { ensurePostgresInit } = require('./src/init-postgres');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    ensurePostgresInit(pool).then(() => pool.end());
  `], { env: process.env, stdio: 'ignore' });

  assert.deepEqual(await lineBranches('SELECT DISTINCT branch_id FROM journal_entry_lines WHERE journal_entry_id = $1', [provable]), [B]);
  assert.equal((await t.q('SELECT branch_id FROM journal_entries WHERE id = $1', [provable]))[0].branch_id, B);
  assert.equal((await t.q('SELECT branch_id FROM journal_entries WHERE id = $1', [ambiguous]))[0].branch_id, null, 'ambiguous record was guessed');
  // still visible to the administrator as unassigned, never to a branch
  const unassigned = await t.api('GET', '/accounting/journal-entries?branch_id=UNASSIGNED&limit=200');
  assert.ok(unassigned.body.some((e: any) => e.id === ambiguous));
});

test('closing a period posts per-branch closing entries atomically and locks the period', async () => {
  const year = new Date().getFullYear();
  const period = `fp-${year}-annual`;
  const isA = (await t.api('GET', `/accounting/income-statement?period_id=${period}`, undefined, userA.token)).body.summary.net_income;
  const res = await t.api('POST', '/accounting/closing-entries', { fiscal_period_id: period });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const tbA = await tb(t.adminToken, A, 'ADJUSTED'); // includes closing entries
  const tbB = await tb(t.adminToken, B, 'ADJUSTED');
  // 6050 holds a manual entry posted without choosing a period (ACC-26)
  for (const code of ['4010', '5010', '6010', '6050']) {
    assert.equal(net(tbA, code), 0, `branch A ${code} not closed`);
    assert.equal(net(tbB, code), 0, `branch B ${code} not closed`);
  }
  assert.equal(Math.round(net(tbA, '3020') * 100), Math.round(isA * 100), 'branch A retained earnings ≠ its net income');
  assert.equal(net(tbA, '3030'), 0);
  assert.equal((await t.q('SELECT status FROM fiscal_periods WHERE id = $1', [period]))[0].status, 'CLOSED');
  assert.notEqual((await t.api('POST', '/accounting/closing-entries', { fiscal_period_id: period })).status, 200, 'closing ran twice');
  for (const branch of [A, B, 'UNASSIGNED', undefined]) assert.ok((await tb(t.adminToken, branch, 'ADJUSTED')).totals.is_balanced);
});
