// Roadmap wave 1: period comparison, class tracking, currencies (SLSH), bank reconciliation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ, type TestCtx } from './helpers';
let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });
const today = new Date().toISOString().slice(0, 10);
const A = '/accounting';

test('classes: expenses carry a class, the report splits by class, and management can make it required', async () => {
  const cls = await t.api('POST', `${A}/classes`, { name: 'Showroom' });
  assert.equal(cls.status, 201, JSON.stringify(cls.body));
  assert.equal((await t.api('POST', `${A}/classes`, { name: 'showroom' })).status, 409);
  const e = await t.api('POST', '/expenses', { title: 'Lights', amount: 40, category: 'Utilities', expense_date: today, branch_id: BRANCH_HQ, classId: cls.body.id });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  await t.api('POST', '/expenses', { title: 'Tea', amount: 10, category: 'Other', expense_date: today, branch_id: BRANCH_HQ });
  const rep = await t.api('GET', `${A}/class-report?from=${today}&to=${today}`);
  const row = (n: string) => rep.body.rows.find((r: any) => r.class_name === n);
  assert.equal(row('Showroom').expenses, 40); assert.equal(row('No class').expenses, 10);
  // required
  assert.equal((await t.api('PUT', `${A}/classes-required`, { required: true })).status, 200);
  const refused = await t.api('POST', '/expenses', { title: 'No class', amount: 5, category: 'Other', expense_date: today, branch_id: BRANCH_HQ });
  assert.equal(refused.status, 400); assert.match(refused.body.message, /choose a class/);
  await t.api('PUT', `${A}/classes-required`, { required: false });
});

test('comparison: two periods side by side with difference and percent', async () => {
  const far = '2020-01-01', farEnd = '2020-01-31';
  const r = await t.api('GET', `${A}/comparison?fromA=${far}&toA=${farEnd}&fromB=${today}&toB=${today}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const exp = r.body.rows.find((x: any) => x.key === 'expenses');
  assert.equal(exp.a, 0); assert.ok(exp.b >= 50); assert.equal(exp.difference, exp.b); assert.equal(exp.percent, null, 'no percent from zero');
  assert.equal((await t.api('GET', `${A}/comparison?fromA=x`)).status, 400);
});

test('currencies: an SLSH account keeps shillings at the rate of the day; the books stay in dollars', async () => {
  const noRate = await t.api('POST', `${A}/money-accounts`, { kind: 'MOBILE_MONEY', provider: 'ZAAD (Telesom)', name: 'ZAAD SLSH', currency: 'SLSH' });
  assert.equal(noRate.status, 400); assert.match(noRate.body.message, /exchange rate/);
  assert.equal((await t.api('PUT', `${A}/currencies/SLSH/rate`, { rate: 8500 })).status, 200);
  assert.equal((await t.api('PUT', `${A}/currencies/USD/rate`, { rate: 2 })).status, 400);
  const acc = await t.api('POST', `${A}/money-accounts`, { kind: 'MOBILE_MONEY', provider: 'ZAAD (Telesom)', name: 'ZAAD SLSH', currency: 'SLSH', opening: { amount: 850000, source: 'NEW_MONEY' } });
  assert.equal(acc.status, 201, JSON.stringify(acc.body));
  const get = async () => (await t.api('GET', `${A}/money-accounts`)).body.accounts.find((a: any) => a.id === acc.body.id);
  let a = await get();
  assert.equal(a.balance, 100, '850,000 SLSH = $100 in the books'); assert.equal(a.foreign_balance, 850000);
  // an expense of $10 paid from it takes 85,000 shillings
  const e = await t.api('POST', '/expenses', { title: 'Airtime', amount: 10, category: 'Other', expense_date: today, moneyAccountId: acc.body.id });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  a = await get(); assert.equal(a.balance, 90); assert.equal(a.foreign_balance, 765000);
  // a new rate does not rewrite the past
  await t.api('PUT', `${A}/currencies/SLSH/rate`, { rate: 9000 });
  a = await get(); assert.equal(a.foreign_balance, 765000);
  assert.equal((await t.api('GET', `${A}/trial-balance`)).body.totals.is_balanced, true);
});

test('bank reconciliation: statement lines match book entries once; differences are shown; nothing is posted', async () => {
  const acc = await t.api('POST', `${A}/money-accounts`, { kind: 'BANK', provider: 'Premier Bank', name: 'Recon Bank', opening: { amount: 1000, source: 'NEW_MONEY' } });
  const id = acc.body.id;
  await t.api('POST', '/expenses', { title: 'Rent', amount: 300, category: 'Rent', expense_date: today, moneyAccountId: id });
  const entries0 = (await t.q('SELECT COUNT(*)::int AS n FROM journal_entries'))[0].n;
  const add = await t.api('POST', `${A}/reconciliation/${id}/lines`, { lines: [
    { date: today, description: 'Opening deposit', amount: 1000 },
    { date: today, description: 'Rent cheque', amount: -300, reference: 'CHQ1' },
    { date: today, description: 'Bank fee', amount: -5 },
  ] });
  assert.equal(add.status, 201, JSON.stringify(add.body)); assert.equal(add.body.added, 3);
  assert.equal((await t.api('POST', `${A}/reconciliation/${id}/lines`, { lines: [{ date: today, description: 'Bank fee', amount: -5 }] })).body.skipped, 1, 'the same line is not added twice');
  const auto = await t.api('POST', `${A}/reconciliation/${id}/auto`, {});
  assert.equal(auto.body.matched, 2);
  const view = await t.api('GET', `${A}/reconciliation/${id}?statementBalance=695`);
  assert.equal(view.body.summary.book_balance, 700);
  assert.equal(view.body.summary.unmatched_statement, 1); assert.equal(view.body.summary.unmatched_statement_total, -5);
  assert.equal(view.body.summary.difference, -5, 'the bank fee is missing from the books');
  assert.equal(view.body.summary.unmatched_book, 0);
  // a wrong manual match is refused; unmatch then delete works
  const fee = view.body.statement.find((s: any) => s.description === 'Bank fee');
  const rent = view.body.statement.find((s: any) => s.description === 'Rent cheque');
  assert.equal((await t.api('POST', `${A}/reconciliation/match`, { statementLineId: fee.id, ledgerLineId: rent.matched_line_id })).status, 400);
  assert.equal((await t.api('DELETE', `${A}/reconciliation/lines/${rent.id}`)).status, 400, 'matched lines cannot be deleted');
  await t.api('POST', `${A}/reconciliation/unmatch`, { statementLineId: rent.id });
  assert.equal((await t.api('GET', `${A}/reconciliation/${id}`)).body.summary.unmatched_book, 1);
  assert.equal((await t.q('SELECT COUNT(*)::int AS n FROM journal_entries'))[0].n, entries0, 'reconciling posts nothing');
});
