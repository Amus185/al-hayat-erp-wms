// The general ledger is a view over posted journal lines — one source of truth.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ as A, BRANCH_CL as B, type TestCtx } from './helpers';
import { ensureLedgerView } from '../src/init-postgres';

let t: TestCtx;
before(async () => { t = await setupTestApp(); });
after(async () => { await t?.teardown(); });

const today = () => new Date().toISOString().slice(0, 10);
const cashId = async () => (await t.q("SELECT id FROM chart_of_accounts WHERE code = '1010'"))[0].id as string;
const lastBalance = (rows: any[], accountId: string) => {
  const mine = rows.filter((r) => r.account_id === accountId);
  return Number(mine[mine.length - 1]?.running_balance ?? 0);
};
const tbCash = async (branch?: string) => {
  const r = await t.api('GET', `/accounting/trial-balance${branch ? `?branch_id=${branch}` : ''}`);
  return Number(r.body.accounts.find((a: any) => a.code === '1010')?.net_balance ?? 0);
};

test('general_ledger is a view, not a second copy of the journal lines', async () => {
  const kind = await t.q("SELECT c.relkind FROM pg_class c WHERE c.relname = 'general_ledger' AND c.relnamespace = current_schema()::regnamespace");
  assert.equal(kind[0]?.relkind, 'v');
});

test('running balances are per branch scope: each branch ledger ends at that branch\'s cash, consolidated at the total', async () => {
  for (const [branch, cash] of [[A, 1000], [B, 400]] as const) {
    const r = await t.api('POST', '/accounting/opening-balances', { branch_id: branch, opening_cash: cash });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await t.api('POST', '/expenses', { title: 'Rent', amount: 150, category: 'Rent', expense_date: today(), branch_id: A });

  const cash = await cashId();
  for (const branch of [A, B]) {
    const gl = await t.api('GET', `/accounting/general-ledger?account_id=${cash}&branch_id=${branch}`);
    assert.equal(gl.status, 200, JSON.stringify(gl.body));
    assert.equal(lastBalance(gl.body, cash), await tbCash(branch), `ledger balance for ${branch} includes other branches`);
  }
  const all = await t.api('GET', `/accounting/general-ledger?account_id=${cash}`);
  assert.equal(lastBalance(all.body, cash), await tbCash());
  assert.equal(await tbCash(A), 850);

  // a branch user's ledger is their branch's numbers only
  const user = await t.createUser({ branchId: B, roleId: 'role-branch-user', role: 'branch_user', grants: ['accounting.view'] });
  const mine = await t.api('GET', `/accounting/general-ledger?account_id=${cash}`, undefined, user.token);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(lastBalance(mine.body, cash), 400);
});

test('a date window starts from the balance brought forward', async () => {
  const cash = await cashId();
  const later = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await t.api('POST', '/expenses', { title: 'Fuel', amount: 50, category: 'Transport', expense_date: later, branch_id: A });
  const gl = await t.api('GET', `/accounting/general-ledger?account_id=${cash}&branch_id=${A}&from_date=${later}`);
  assert.equal(gl.body.length, 1, JSON.stringify(gl.body));
  assert.equal(Number(gl.body[0].running_balance), 800, 'window did not carry the earlier balance forward');
});

test('every posted line appears exactly once; drafts appear only when posted, and only once', async () => {
  const lines = async () => Number((await t.q(`SELECT COUNT(*) AS n FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id WHERE e.status IN ('POSTED','REVERSED')`))[0].n);
  const glRows = async () => Number((await t.q('SELECT COUNT(*) AS n FROM general_ledger'))[0].n);
  assert.equal(await glRows(), await lines());

  const accounts = await t.q("SELECT id, code FROM chart_of_accounts WHERE code IN ('1010', '6010')");
  const id = (code: string) => accounts.find((a: any) => a.code === code).id;
  const draft = await t.api('POST', '/accounting/journal-entries', {
    entry_date: today(), description: 'Manual rent', branch_id: A,
    lines: [{ account_id: id('6010'), debit_amount: 20, credit_amount: 0 }, { account_id: id('1010'), debit_amount: 0, credit_amount: 20 }],
  });
  assert.equal(draft.status, 201, JSON.stringify(draft.body));
  assert.equal(draft.body.status, 'DRAFT');
  const before = await glRows();
  const posts = await Promise.all([1, 2].map(() => t.api('POST', `/accounting/journal-entries/${draft.body.id}/post`)));
  assert.deepEqual(posts.map((p) => p.status).sort(), [200, 409], JSON.stringify(posts.map((p) => p.body)));
  assert.equal(await glRows(), before + 2);
  assert.equal(await glRows(), await lines());
});

test('depreciation posts one balanced, company-level entry atomically', async () => {
  const res = await t.api('POST', '/accounting/depreciation', {
    asset_name: 'Delivery van', acquisition_date: today(), cost: 12000, useful_life_years: 5, period_depreciation: 200,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const rows = await t.q(`SELECT a.code, gl.debit_amount, gl.credit_amount, gl.branch_id FROM general_ledger gl
    JOIN journal_entries e ON e.id = gl.journal_entry_id JOIN chart_of_accounts a ON a.id = gl.account_id
    WHERE e.reference_type = 'DEPRECIATION' AND e.reference_id = $1 ORDER BY a.code`, [res.body.id]);
  assert.deepEqual(rows.map((r: any) => [r.code, Number(r.debit_amount), Number(r.credit_amount), r.branch_id]),
    [['1501', 0, 200, null], ['6060', 200, 0, null]]);
});

test('migration keeps the old table as general_ledger_legacy and is idempotent', async () => {
  await t.q('DROP VIEW general_ledger');
  await t.q(`CREATE TABLE general_ledger (id TEXT PRIMARY KEY, account_id TEXT, journal_entry_id TEXT, running_balance DOUBLE PRECISION)`);
  await t.q(`INSERT INTO general_ledger VALUES ('old-1', 'coa-1010', 'je-x', 123)`);
  await ensureLedgerView(t.pool);
  await ensureLedgerView(t.pool);
  const legacy = await t.q('SELECT id, running_balance FROM general_ledger_legacy');
  assert.deepEqual(legacy.map((r: any) => [r.id, Number(r.running_balance)]), [['old-1', 123]]);
  const kind = await t.q("SELECT relkind FROM pg_class WHERE relname = 'general_ledger' AND relnamespace = current_schema()::regnamespace");
  assert.equal(kind[0].relkind, 'v');
});
