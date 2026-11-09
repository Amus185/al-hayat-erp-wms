// Bank & Cash accounts: registered like Odoo's Bank / Cash journals, balances read from the
// ledger, opening balances, moving money, and the reports still balancing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const accounts = async () => (await t.api('GET', '/accounting/money-accounts')).body;
const find = (body: any, name: string) => body.accounts.find((a: any) => a.name === name);

test('Main Cash is created once from the existing cash account; Hargeisa providers are offered', async () => {
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM app_migrations WHERE name = 'money_accounts_v1'"))[0].n, 1);
  const main = find(await accounts(), 'Main Cash');
  assert.ok(main, 'Main Cash exists');
  assert.equal(main.coa_account_id, 'coa-1010', 'it is the original cash account, so history keeps its balance');
  const { ensureMoneyAccounts } = await import('../src/init-postgres');
  await ensureMoneyAccounts(t.pool);
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM money_accounts WHERE coa_account_id = 'coa-1010'"))[0].n, 1, 'never twice');
  const prov = (await t.api('GET', '/accounting/money-accounts/providers')).body;
  assert.ok(prov.providers.BANK.includes('Dahabshil Bank International'));
  assert.ok(prov.providers.MOBILE_MONEY.includes('ZAAD (Telesom)'));
});

test('register accounts, opening balances, move money; the books and reports stay balanced', async () => {
  const dah = await t.api('POST', '/accounting/money-accounts', {
    kind: 'MOBILE_MONEY', provider: 'Dahabshiil (money transfer)', name: 'Dahabshiil', account_number: '063-0000000',
    opening: { amount: 1000, source: 'NEW_MONEY' },
  });
  assert.equal(dah.status, 201, JSON.stringify(dah.body));
  assert.match(dah.body.account_code, /^1010-\d\d$/, 'its own ledger account under Cash');
  assert.equal(dah.body.balance, 1000);

  assert.equal((await t.api('POST', '/accounting/money-accounts', { kind: 'BANK', provider: 'Premier Bank', name: 'Dahabshiil' })).status, 409, 'names are unique');
  assert.equal((await t.api('POST', '/accounting/money-accounts', { kind: 'BANK', provider: '' })).status, 400, 'a provider is required');

  // Main Cash only has what the books say: an opening moved out of it can't exceed that.
  const mainBefore = find(await accounts(), 'Main Cash').balance;
  const tooMuch = await t.api('POST', '/accounting/money-accounts', { kind: 'BANK', provider: 'Premier Bank', opening: { amount: mainBefore + 500, source: 'MAIN_CASH' } });
  assert.equal(tooMuch.status, 400, JSON.stringify(tooMuch.body));
  assert.equal((await t.q("SELECT COUNT(*)::int AS n FROM chart_of_accounts WHERE name = 'Premier Bank'"))[0].n, 0, 'a refused account leaves nothing behind');

  // Move 400 from Dahabshiil to Main Cash, then open Premier Bank with 300 out of Main Cash.
  const dahId = dah.body.id;
  const mainId = find(await accounts(), 'Main Cash').id;
  assert.equal((await t.api('POST', '/accounting/money-accounts/transfer', { fromId: dahId, toId: mainId, amount: 5000 })).status, 400, 'no overdraft');
  const mv = await t.api('POST', '/accounting/money-accounts/transfer', { fromId: dahId, toId: mainId, amount: 400, note: 'Cash needed at the till' });
  assert.equal(mv.status, 201, JSON.stringify(mv.body));
  const prem = await t.api('POST', '/accounting/money-accounts', { kind: 'BANK', provider: 'Premier Bank', account_number: '12345', opening: { amount: 300, source: 'MAIN_CASH' } });
  assert.equal(prem.status, 201, JSON.stringify(prem.body));

  const now = await accounts();
  assert.equal(find(now, 'Dahabshiil').balance, 600);
  assert.equal(find(now, 'Premier Bank').balance, 300);
  assert.equal(find(now, 'Main Cash').balance, Math.round((mainBefore + 400 - 300) * 100) / 100);

  // Statement with a running balance, newest first.
  const st = await t.api('GET', `/accounting/money-accounts/${dahId}/statement`);
  assert.equal(st.body.lines.length, 2);
  assert.equal(st.body.lines[0].money_out, 400);
  assert.equal(st.body.lines[0].balance, 600);

  // The books: balanced, the balance sheet counts every account as cash, the cash flow reconciles
  // and moves between our own accounts are not cash in / out.
  const tb = await t.api('GET', '/accounting/trial-balance');
  assert.equal(tb.body.totals.is_balanced, true);
  const bs = await t.api('GET', '/accounting/balance-sheet');
  assert.equal(bs.body.totals.is_balanced, true);
  const cashLines = bs.body.assets.filter((a: any) => a.code === '1010' || String(a.code).startsWith('1010-'));
  assert.ok(cashLines.some((a: any) => a.code === dah.body.account_code));
  const cf = await t.api('GET', '/accounting/cash-flow');
  assert.equal(cf.body.summary.reconciles, true, JSON.stringify(cf.body.warnings));
  const fin = cf.body.financing_activities.reduce((a: number, l: any) => a + l.cash_in, 0);
  assert.ok(fin >= 1000, 'new money into Dahabshiil is owner funding');
  const moved = [...cf.body.operating_activities, ...cf.body.financing_activities, ...cf.body.investing_activities]
    .filter((l: any) => l.reference_type === 'MONEY_TRANSFER');
  assert.equal(moved.length, 0, 'moving money between our own accounts is not cash in or out');

  // Closing: refused while money is in it, allowed when empty; Main Cash can never be closed.
  assert.equal((await t.api('PATCH', `/accounting/money-accounts/${prem.body.id}`, { is_active: false })).status, 400);
  await t.api('POST', '/accounting/money-accounts/transfer', { fromId: prem.body.id, toId: mainId, amount: 300 });
  assert.equal((await t.api('PATCH', `/accounting/money-accounts/${prem.body.id}`, { is_active: false })).status, 200);
  assert.equal((await t.api('PATCH', `/accounting/money-accounts/${mainId}`, { is_active: false })).status, 400);
});

test('only the Owner or accountants manage Bank & Cash; a branch manager cannot', async () => {
  const mgr = await t.createUser({ branchId: BRANCH_HQ, roleId: 'role-branch-user', role: 'branch_user' });
  assert.equal((await t.api('GET', '/accounting/money-accounts', undefined, mgr.token)).status, 403);
  assert.equal((await t.api('POST', '/accounting/money-accounts', { kind: 'CASH', provider: 'Safe' }, mgr.token)).status, 403);
});

test('"Paid from" / "Received into": every kind of payment moves the chosen account; wrong or closed accounts are refused', async () => {
  const { BRANCH_CL, WH_MAIN } = await import('./helpers');
  const bal = async (id: string) => (await accounts()).accounts.find((a: any) => a.id === id).balance;
  const mk = async (body: any) => { const r = await t.api('POST', '/accounting/money-accounts', body); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string; };
  const zaad = await mk({ kind: 'MOBILE_MONEY', provider: 'ZAAD (Telesom)', name: 'ZAAD HQ', branchId: BRANCH_HQ, opening: { amount: 5000, source: 'NEW_MONEY' } });
  const bank = await mk({ kind: 'BANK', provider: 'Dahabshil Bank International', name: 'DBI Company', opening: { amount: 5000, source: 'NEW_MONEY' } });
  const clCash = await mk({ kind: 'CASH', provider: 'Cash drawer', name: 'CL Drawer', branchId: BRANCH_CL });

  // Supplier payment from the company bank account.
  const product = await t.createProduct({ cost: 10, price: 30 });
  const sup = await t.api('POST', '/purchasing/suppliers', { name: 'Money Supplier', phone: '0631231231' });
  const po = await t.api('POST', '/purchasing/orders', { supplierId: sup.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantity: 10, unitCost: 10 }] });
  assert.equal((await t.api('POST', '/purchasing/receipts', { purchaseOrderId: po.body.id, warehouseId: WH_MAIN, lines: [{ productId: product, quantityReceived: 10 }] })).status, 201);
  const b0 = await bal(bank);
  const sp = await t.api('POST', `/purchasing/invoices/pi-${po.body.id}/payments`, { amount: 60, moneyAccountId: bank });
  assert.equal(sp.status, 201, JSON.stringify(sp.body));
  assert.equal(await bal(bank), b0 - 60, 'the bank account paid the supplier');
  const pip = (await t.q('SELECT money_account_id, payment_method FROM purchase_invoice_payments WHERE purchase_invoice_id = $1', [`pi-${po.body.id}`]))[0];
  assert.equal(pip.money_account_id, bank); assert.equal(pip.payment_method, 'BANK_TRANSFER');

  // A sale with a deposit received into ZAAD (HQ), then a customer payment into ZAAD.
  await t.setStock(product, 5, { branchId: BRANCH_HQ });
  const cust = await t.api('POST', '/sales/customers', { name: 'Money Customer', phone: '0637778899' });
  const z0 = await bal(zaad);
  const sale = await t.api('POST', '/sales/orders', { branchId: BRANCH_HQ, customerId: cust.body.id, fulfillmentType: 'PICKUP', isCreditSale: true, initialDeposit: 20, moneyAccountId: zaad, lines: [{ productId: product, quantity: 2, unitPrice: 30 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(await bal(zaad), z0 + 20, 'the deposit went into ZAAD');
  const inv = (await t.q('SELECT id FROM invoices WHERE sales_order_id = $1', [sale.body.id]))[0].id;
  const cp = await t.api('POST', '/sales/payments', { customerId: cust.body.id, allocationType: 'INVOICE', invoiceId: inv, amount: 15, moneyAccountId: zaad });
  assert.equal(cp.status, 201, JSON.stringify(cp.body));
  assert.equal(cp.body.receipt.payment_method, 'MOBILE_MONEY');
  assert.equal(await bal(zaad), z0 + 35);

  // The CL drawer can't take an HQ payment; a closed account is refused; an unknown one too.
  const wrong = await t.api('POST', '/sales/payments', { customerId: cust.body.id, allocationType: 'INVOICE', invoiceId: inv, amount: 5, moneyAccountId: clCash });
  assert.equal(wrong.status, 400); assert.match(wrong.body.message, /another branch/);
  assert.equal(await bal(zaad), z0 + 35, 'a refused payment moves nothing');
  assert.equal((await t.api('POST', '/sales/payments', { customerId: cust.body.id, allocationType: 'INVOICE', invoiceId: inv, amount: 5, moneyAccountId: 'nope' })).status, 400);

  // Expense paid from ZAAD (HQ), salary advance from the company bank.
  const ex = await t.api('POST', '/expenses', { title: 'Fuel', amount: 12, category: 'Transport', expense_date: new Date().toISOString().slice(0, 10), branch_id: BRANCH_HQ, moneyAccountId: zaad });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  assert.equal(await bal(zaad), z0 + 23);
  const emp = await t.api('POST', '/employees', { full_name: 'Money Worker', branch_id: BRANCH_HQ, salary: 300 });
  const b1 = await bal(bank);
  const adv = await t.api('POST', `/employees/${emp.body.id}/advances`, { kind: 'ADVANCE', amount: 40, moneyAccountId: bank });
  assert.equal(adv.status, 201, JSON.stringify(adv.body));
  assert.equal(await bal(bank), b1 - 40);
  assert.equal(adv.body.method, 'BANK');

  // Close ZAAD after emptying it: then it is refused.
  await t.api('POST', '/accounting/money-accounts/transfer', { fromId: zaad, toId: (await accounts()).accounts.find((a: any) => a.name === 'Main Cash').id, amount: await bal(zaad), branchId: BRANCH_HQ });
  assert.equal((await t.api('PATCH', `/accounting/money-accounts/${zaad}`, { is_active: false })).status, 200);
  const closed = await t.api('POST', '/expenses', { title: 'Fuel 2', amount: 1, category: 'Transport', expense_date: new Date().toISOString().slice(0, 10), branch_id: BRANCH_HQ, moneyAccountId: zaad });
  assert.equal(closed.status, 400); assert.match(closed.body.message, /closed/);

  // Nothing chosen = Main Cash, as before.
  const plain = await t.api('POST', '/expenses', { title: 'Tea', amount: 3, category: 'Other', expense_date: new Date().toISOString().slice(0, 10), branch_id: BRANCH_HQ });
  assert.equal(plain.status, 201);
  assert.equal((await t.q('SELECT money_account_id FROM expenses WHERE id = $1', [plain.body.id]))[0].money_account_id, null);

  // The books still balance.
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
  assert.equal((await t.api('GET', '/accounting/balance-sheet')).body.totals.is_balanced, true);

  // What a CL person may choose: CL's own and company-wide accounts, never HQ's, no balances.
  const clUser = await t.createUser({ branchId: BRANCH_CL, roleId: 'role-branch-user', role: 'branch_user' });
  const opts = (await t.api('GET', '/money-accounts/options', undefined, clUser.token)).body as any[];
  assert.ok(opts.some((o) => o.id === clCash) && opts.some((o) => o.id === bank), 'own + company-wide');
  assert.ok(!opts.some((o) => o.name === 'ZAAD HQ'), 'never another branch');
  assert.ok(opts.every((o) => o.balance === undefined), 'no balances without accounting access');
});
