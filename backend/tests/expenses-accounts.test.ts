// Expenses: expense account from the chart of accounts, owed then paid later, bulk entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const today = new Date().toISOString().slice(0, 10);
const bal = async (code: string) => Number((await t.q(`SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0) AS b FROM journal_entry_lines l JOIN journal_entries je ON je.id = l.journal_entry_id AND je.status IN ('POSTED','REVERSED') JOIN chart_of_accounts c ON c.id = l.account_id WHERE c.code = $1`, [code]))[0].b);

test('an expense posts to the chosen expense account; owed expenses sit in payables until paid', async () => {
  const acc = await t.api('POST', '/accounting/chart-of-accounts', { code: '6110', name: 'Fuel & Transport', account_type: 'EXPENSE' });
  assert.equal(acc.status, 201, JSON.stringify(acc.body));
  const list = await t.api('GET', '/expenses/accounts');
  assert.ok(list.body.some((a: any) => a.code === '6110'));
  const e0 = await bal('6110'), cash0 = await bal('1010'), ap0 = await bal('2010');
  const paid = await t.api('POST', '/expenses', { title: 'Diesel', amount: 30, expense_date: today, branch_id: BRANCH_HQ, expenseAccountId: acc.body.id });
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.category, 'Fuel & Transport');
  assert.equal(await bal('6110'), e0 + 30); assert.equal(await bal('1010'), cash0 - 30);
  // not an expense account -> refused
  assert.equal((await t.api('POST', '/expenses', { title: 'X', amount: 1, expense_date: today, branch_id: BRANCH_HQ, expenseAccountId: 'coa-1010' })).status, 400);

  const owed = await t.api('POST', '/expenses', { title: 'Truck repair', amount: 200, expense_date: today, branch_id: BRANCH_HQ, expenseAccountId: acc.body.id, payment_method: 'UNPAID' });
  assert.equal(owed.status, 201);
  assert.equal(await bal('6110'), e0 + 230); assert.equal(await bal('2010'), ap0 - 200, 'owed to the garage'); assert.equal(await bal('1010'), cash0 - 30, 'no money left yet');
  assert.equal((await t.api('POST', `/expenses/${owed.body.id}/pay`, {})).status, 400, 'the account must be chosen');
  const pay = await t.api('POST', `/expenses/${owed.body.id}/pay`, { moneyAccountId: 'money-main-cash' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(await bal('2010'), ap0); assert.equal(await bal('1010'), cash0 - 230);
  assert.equal((await t.api('POST', `/expenses/${owed.body.id}/pay`, { moneyAccountId: 'money-main-cash' })).status, 400, 'not twice');
  // editing the amount of a paid-later expense keeps the books right (no double payment)
  assert.equal((await t.api('PATCH', `/expenses/${owed.body.id}`, { amount: 150 })).status, 200);
  assert.equal(await bal('6110'), e0 + 180); assert.equal(await bal('1010'), cash0 - 180); assert.equal(await bal('2010'), ap0);
  // deleting it gives everything back
  assert.equal((await t.api('DELETE', `/expenses/${owed.body.id}`)).status, 200);
  assert.equal(await bal('6110'), e0 + 30); assert.equal(await bal('1010'), cash0 - 30);
});

test('bulk entry: all rows saved together, or none when one row is wrong', async () => {
  const n0 = (await t.q('SELECT COUNT(*)::int AS n FROM expenses'))[0].n;
  const bad = await t.api('POST', '/expenses/bulk', { rows: [
    { title: 'Tea', amount: 5, expense_date: today, branch_id: BRANCH_HQ, category: 'Other' },
    { title: '', amount: 9, expense_date: today, branch_id: BRANCH_HQ, category: 'Other' },
  ] });
  assert.equal(bad.status, 400); assert.match(bad.body.message, /Row 2/);
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM expenses'))[0].n, n0, 'nothing saved');
  const cash0 = await bal('1010');
  const ok = await t.api('POST', '/expenses/bulk', { rows: [
    { title: 'Tea', amount: 5, expense_date: today, branch_id: BRANCH_HQ, category: 'Other', reference: 'R-1' },
    { title: 'Water', amount: 7.5, expense_date: today, branch_id: BRANCH_HQ, category: 'Utilities', moneyAccountId: 'money-main-cash' },
  ] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.count, 2);
  assert.equal(await bal('1010'), cash0 - 12.5);
  assert.equal((await t.api('GET', '/accounting/trial-balance')).body.totals.is_balanced, true);
});
