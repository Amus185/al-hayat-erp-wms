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
