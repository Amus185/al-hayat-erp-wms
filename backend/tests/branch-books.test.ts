// Per-branch books: statements per account, branch summary, opening stock and cash.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as A, BRANCH_CL as B, type TestCtx } from './helpers';

let t: TestCtx;
let customerId: string;
before(async () => {
  t = await setupTestApp();
  customerId = await t.createCustomer();
});
after(async () => { await t?.teardown(); });

const balance = async (code: string, branch?: string) => {
  const r = await t.api('GET', `/accounting/trial-balance${branch ? `?branch_id=${branch}` : ''}`);
  return Number(r.body.accounts.find((a: any) => a.code === code)?.net_balance ?? 0);
};

async function createProductWithStock(branch: string, qty: number, cost = 40, price = 100) {
  const res = await t.api('POST', '/products', {
    sku: `SKU-${randomUUID().slice(0, 8)}`, name: 'Sofa', costPrice: cost, sellingPrice: price,
    initialQuantity: qty, initialBranchId: branch,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as string;
}

async function sell(branch: string, productId: string, qty: number, price = 100) {
  const order = await t.api('POST', '/sales/orders', { branchId: branch, customerId, lines: [{ productId, quantity: qty, unitPrice: price }] });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const done = await t.api('POST', `/sales/orders/${order.body.id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
}

test('stock entered with a new product is valued in the books, so selling it keeps inventory positive', async () => {
  const p = await createProductWithStock(A, 5, 40);
  assert.equal(await balance('1030', A), 200);
  assert.equal(await balance('3010', A), 200, 'opening stock not credited to owner\'s capital');
  await sell(A, p, 2);
  assert.equal(await balance('1030', A), 120);
  const moves = await t.q("SELECT transaction_type, quantity FROM inventory_transactions WHERE product_id = $1 ORDER BY created_at", [p]);
  assert.deepEqual(moves.map((m: any) => m.transaction_type), ['OPENING_STOCK', 'SALE_ISSUE']);
});

test('bulk-imported stock is valued per branch too', async () => {
  const before = await balance('1030', B);
  const res = await t.api('POST', '/products/bulk', [{ sku: `BULK-${randomUUID().slice(0, 6)}`, name: 'Chair', costPrice: 10, sellingPrice: 30, initialStock: 4, locationName: 'Al Hayat CL Branch' }]);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await balance('1030', B) - before, 40);
});

test('consolidated statements show each account once, and the branch views add up to it', async () => {
  const p = await createProductWithStock(B, 3, 50, 200);
  await sell(B, p, 1, 200);
  await t.api('POST', '/expenses', { title: 'Rent', amount: 30, category: 'Rent', expense_date: new Date().toISOString().slice(0, 10), branch_id: A });
  await t.api('POST', '/expenses', { title: 'Salaries', amount: 70, category: 'Salaries', expense_date: new Date().toISOString().slice(0, 10) });

  const bs = await t.api('GET', '/accounting/balance-sheet');
  for (const section of ['assets', 'liabilities']) {
    const codes = bs.body[section].map((a: any) => a.code);
    assert.equal(new Set(codes).size, codes.length, `${section} lists an account more than once: ${codes}`);
  }
  const cashAll = bs.body.assets.find((a: any) => a.code === '1010').balance;
  const parts = await Promise.all([A, B, 'UNASSIGNED'].map((b) => t.api('GET', `/accounting/balance-sheet?branch_id=${b}`)));
  assert.equal(cashAll, parts.reduce((s, r) => s + r.body.assets.find((a: any) => a.code === '1010').balance, 0));

  const is = await t.api('GET', '/accounting/income-statement');
  const revCodes = is.body.revenue.map((r: any) => r.code);
  assert.equal(new Set(revCodes).size, revCodes.length, 'income statement lists an account more than once');
});

test('branch summary shows every branch side by side; totals equal the consolidated dashboard', async () => {
  const sum = await t.api('GET', '/accounting/branch-summary');
  assert.equal(sum.status, 200, JSON.stringify(sum.body));
  const names = sum.body.branches.map((b: any) => b.branch_id);
  assert.ok(names.includes(A) && names.includes(B) && names.includes(null), JSON.stringify(names));
  const dash = await t.api('GET', '/accounting/dashboard');
  assert.equal(Math.round(sum.body.totals.revenue * 100), Math.round(dash.body.total_revenue * 100));
  assert.equal(Math.round(sum.body.totals.net_income * 100), Math.round(dash.body.net_income * 100));
  const a = sum.body.branches.find((b: any) => b.branch_id === A);
  assert.equal(a.expenses, 30);
  assert.equal(a.cash, await balance('1010', A));
  assert.equal(sum.body.branches.find((b: any) => b.branch_id === null).expenses, 70);

  const user = await t.createUser({ branchId: A, roleId: 'role-branch-user', role: 'branch_user' });
  const mine = await t.api('GET', '/accounting/branch-summary', undefined, user.token);
  assert.deepEqual(mine.body.branches.map((b: any) => b.branch_id), [A]);
});

test('opening balances: stock with no recorded value is found per branch, posted once, with opening cash', async () => {
  // legacy stock: on hand but never recorded as a movement or in the books
  const p = await t.createProduct({ cost: 25 });
  await t.setStock(p, 8, { branchId: B });
  const preview = await t.api('GET', '/accounting/opening-balances');
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const rowB = preview.body.find((r: any) => r.branch_id === B);
  assert.ok(rowB.unrecorded_stock_value >= 200, JSON.stringify(rowB));

  const inv0 = await balance('1030', B), cash0 = await balance('1010', B);
  const posts = await Promise.all([1, 2].map(() =>
    t.api('POST', '/accounting/opening-balances', { branch_id: B, include_stock: true, opening_cash: 1000 })));
  assert.equal(posts.filter((r) => r.status === 200).length, 1, JSON.stringify(posts.map((r) => r.body)));
  assert.equal(await balance('1030', B) - inv0, rowB.unrecorded_stock_value);
  assert.equal(await balance('1010', B) - cash0, 1000);

  const again = await t.api('GET', '/accounting/opening-balances');
  assert.equal(again.body.find((r: any) => r.branch_id === B).unrecorded_stock_value, 0);
  assert.equal(again.body.find((r: any) => r.branch_id === B).opening_cash_posted, 1000);
  assert.equal((await t.api('POST', '/accounting/opening-balances', { branch_id: B, opening_cash: 500 })).status, 409);
  for (const b of [A, B, 'UNASSIGNED', undefined]) {
    const r = await t.api('GET', `/accounting/trial-balance${b ? `?branch_id=${b}` : ''}`);
    assert.ok(r.body.totals.is_balanced, `unbalanced ${b}`);
  }
});

test('opening balances are restricted to administrators and accountants', async () => {
  const user = await t.createUser({ branchId: A, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', '/accounting/opening-balances', undefined, user.token)).status, 403);
  assert.equal((await t.api('POST', '/accounting/opening-balances', { branch_id: A, opening_cash: 5 }, user.token)).status, 403);
});
