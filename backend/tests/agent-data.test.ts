// The assistant's access to every ERP module (get_data): the same routes,
// permissions, branch scope and figures as the staff screens.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, type TestCtx } from './helpers';
import { DATA_SOURCES, resultForModel } from '../src/services/agent-data';

let t: TestCtx;
const SECRET = 'agent-secret-for-tests-0123456789abcdef';

before(async () => {
  process.env.AGENT_TOKEN_SECRET = SECRET;
  t = await setupTestApp();
});
after(async () => { await t?.teardown(); });

async function raw(method: string, path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await t.app.request(path.startsWith('/api/') ? path : `/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text, headers: res.headers };
}

async function agentToken(staffToken: string) {
  const res = await raw('POST', '/agent/session', staffToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
}
const getData = (token: string, source: string, extra: Record<string, unknown> = {}) =>
  raw('POST', '/agent/tools/get_data', token, { source, ...extra });

test('every module: each source answers for an administrator, with the same data as its screen', async () => {
  const pid = await t.createProduct({ cost: 40, price: 100 });
  await t.setStock(pid, 7, { branchId: HQ });
  await t.createCustomer();
  const token = await agentToken(t.adminToken);
  const failed: string[] = [];
  for (const [name, source] of Object.entries(DATA_SOURCES)) {
    if (source.path.includes(':id')) continue;
    const viaAgent = await getData(token, name);
    const direct = await raw('GET', source.path, t.adminToken);
    if (viaAgent.status !== 200 || direct.status !== 200 || viaAgent.body?.error) {
      failed.push(`${name}: agent ${viaAgent.status} ${viaAgent.text.slice(0, 120)} / screen ${direct.status}`);
      continue;
    }
    // Same route, same user: the assistant gets exactly the screen's data (compacted).
    if (viaAgent.text !== resultForModel(direct.body, false)) failed.push(`${name}: differs from the screen`);
  }
  assert.deepEqual(failed, []);
});

test('accounting: figures come from the accounting routes, filtered as asked', async () => {
  const token = await agentToken(t.adminToken);
  const periods = await getData(token, 'fiscal_periods');
  assert.equal(periods.status, 200);
  const periodId = (Array.isArray(periods.body) ? periods.body : periods.body.periods ?? periods.body.data ?? [])[0]?.id;
  assert.ok(periodId, `no period id in ${periods.text.slice(0, 200)}`);
  for (const source of ['income_statement', 'balance_sheet', 'trial_balance', 'cash_flow']) {
    const viaAgent = await getData(token, source, { filters: { period_id: periodId, branch_id: HQ } });
    const direct = await raw('GET', `${DATA_SOURCES[source].path}?period_id=${periodId}&branch_id=${HQ}`, t.adminToken);
    assert.equal(viaAgent.status, 200, `${source}: ${viaAgent.text.slice(0, 200)}`);
    assert.equal(viaAgent.text, resultForModel(direct.body, false), `${source} differs from the screen`);
  }
  // the general ledger of one account, picked from the chart of accounts
  const accounts = await raw('GET', '/accounting/chart-of-accounts', t.adminToken);
  const cash = (accounts.body.accounts ?? accounts.body).find((a: any) => a.code === '1000') ?? (accounts.body.accounts ?? accounts.body)[0];
  const ledger = await getData(token, 'general_ledger', { filters: { account_id: cash.id } });
  assert.equal(ledger.status, 200, ledger.text.slice(0, 200));
  assert.ok(!ledger.body.error, ledger.text.slice(0, 200));
});

test('permissions: a user without view_reports cannot read accounting, and is told so', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-warehouse-manager', role: 'warehouse_manager', grants: ['assistant.use'] });
  const token = await agentToken(user.token);
  for (const source of ['income_statement', 'balance_sheet', 'expenses_summary', 'inventory_valuation', 'assets_dashboard']) {
    const res = await getData(token, source);
    assert.equal(res.status, 200);
    assert.match(String(res.body.error), /permission/i, `${source} was not refused: ${res.text.slice(0, 160)}`);
  }
});

test('branch scope: a branch user sees only their branch, exactly as on screen; other branches are refused', async () => {
  const accountant = await t.createUser({ branchId: null, roleId: 'role-accountant', role: 'accountant', grants: ['assistant.use'] });
  const branchOnly = randomUUID().slice(0, 6);
  await t.q(`INSERT INTO roles (id, code, name) VALUES ($1, $1, 'Reports')`, [`role-rep-${branchOnly}`]);
  await t.q(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, '66666666-6666-6666-6666-666666666666'), ($1, '55555555-5555-5555-5555-555555555555')`, [`role-rep-${branchOnly}`]);
  const user = await t.createUser({ branchId: HQ, roleId: `role-rep-${branchOnly}`, role: `role-rep-${branchOnly}`, grants: ['assistant.use', 'accounting.view'] });
  const token = await agentToken(user.token);

  const viaAgent = await getData(token, 'income_statement');
  const direct = await raw('GET', '/accounting/income-statement', user.token);
  assert.equal(direct.status, 200, direct.text.slice(0, 200));
  assert.equal(viaAgent.text, resultForModel(direct.body, true), 'branch user saw something other than their screen');

  const other = await getData(token, 'income_statement', { filters: { branch_id: CL } });
  assert.match(String(other.body.error), /permission|own branch/i, other.text.slice(0, 200));
  // an all-branch accountant may ask for any branch
  const acc = await getData(await agentToken(accountant.token), 'income_statement', { filters: { branch_id: HQ } });
  assert.ok(!acc.body.error, acc.text.slice(0, 200));
});

test('inputs: unknown sources, unsafe ids and unknown filters are refused or dropped', async () => {
  const token = await agentToken(t.adminToken);
  const unknown = await getData(token, 'users_and_passwords');
  assert.match(unknown.body.error, /Unknown source/);
  for (const id of ['../../users', 'a/b', '', 'x'.repeat(101), '1 OR 1=1']) {
    const res = await getData(token, 'customer_ledger', { id });
    assert.match(String(res.body.error), /needs the id/, `id ${JSON.stringify(id)} accepted`);
  }
  // a filter the route does not take is not passed on (it would otherwise reach the route's query)
  const users = await getData(token, 'sales_orders', { filters: { status: 'PAID', '../users': 'x', role: 'admin' } });
  assert.equal(users.status, 200);
  assert.ok(!users.body.error, users.text.slice(0, 200));
  // records looked up by id: not found is reported, never invented
  const missing = await getData(token, 'sales_order', { id: randomUUID() });
  assert.ok(missing.body.error, missing.text.slice(0, 200));
});

test('costs: per-item cost is hidden from users who cannot see cost reports, shown to those who can', async () => {
  const pid = await t.createProduct({ cost: 123.45, price: 300 });
  await t.setStock(pid, 3, { branchId: HQ });
  const user = await t.createUser({ branchId: HQ, roleId: 'role-warehouse-manager', role: 'warehouse_manager', grants: ['assistant.use'] });
  const branchView = await getData(await agentToken(user.token), 'products');
  assert.equal(branchView.status, 200);
  assert.ok(!branchView.text.includes('123.45'), 'cost price reached a user without view_reports');
  const adminView = await getData(await agentToken(t.adminToken), 'products');
  assert.ok(adminView.text.includes('123.45'), 'cost price missing for an administrator');
});

test('results stay small: long lists are cut with a count of what was left out', async () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, name: `Row ${i}`, note: 'x'.repeat(500) }));
  const text = resultForModel({ rows: many }, false);
  assert.ok(text.length <= 8000, `result is ${text.length} characters`);
  const parsed = JSON.parse(text);
  assert.ok(parsed.rows.at(-1).more_not_shown > 0);
  assert.ok(parsed.rows[0].note.length <= 201);
});

test('Confirm works when the user is signed in with the browser cookie', async () => {
  const email = `cookie-${randomUUID().slice(0, 8)}@test.local`;
  const created = await t.api('POST', '/users', { email, password: 'Cookie-pass-123', fullName: 'Cookie User', branchId: HQ, roleIds: ['role-branch-user'] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await t.q(`INSERT INTO user_permissions (user_id, permission_id) SELECT $1, id FROM permissions WHERE code = 'assistant.use'`, [created.body.id]);
  const origin = 'https://al-hayat-erp.pages.dev';
  const signIn = await raw('POST', '/api/auth/sign-in/email', null, { email, password: 'Cookie-pass-123' }, { Origin: origin });
  assert.equal(signIn.status, 200, signIn.text);
  const cookie = signIn.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const browser = { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-CSRF-Protection': '1' };

  const pid = await t.createProduct({ price: 100 });
  await t.setStock(pid, 5, { branchId: HQ });
  const name = (await t.q('SELECT name FROM products WHERE id = $1', [pid]))[0].name;
  const session = await raw('POST', '/agent/session', null, undefined, browser);
  assert.equal(session.status, 200, session.text);
  const proposal = await raw('POST', '/agent/proposals', session.body.token, { action: 'adjust_stock', args: { product: name, quantity: 2, reason: 'test' } });
  assert.ok(proposal.body.proposal, proposal.text);
  const done = await raw('POST', `/agent/actions/${proposal.body.proposal.id}/execute`, null, undefined, browser);
  assert.equal(done.status, 200, done.text);
  assert.equal(await t.stockOf(pid, { branchId: HQ }), 7);
});

test('the hourly message limit is a setting (AGENT_MESSAGES_PER_HOUR)', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  const saved = process.env.AGENT_MESSAGES_PER_HOUR;
  try {
    process.env.AGENT_MESSAGES_PER_HOUR = '2';
    assert.equal((await raw('POST', '/agent/session', user.token)).status, 200);
    assert.equal((await raw('POST', '/agent/session', user.token)).status, 200);
    assert.equal((await raw('POST', '/agent/session', user.token)).status, 429);
    process.env.AGENT_MESSAGES_PER_HOUR = '500';
    assert.equal((await raw('POST', '/agent/session', user.token)).status, 200);
  } finally {
    if (saved === undefined) delete process.env.AGENT_MESSAGES_PER_HOUR; else process.env.AGENT_MESSAGES_PER_HOUR = saved;
  }
});
