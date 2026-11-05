// AI assistant support: agent tokens, read-only tools scoped like the staff
// app, and changes that only run after the user confirms them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ as HQ, BRANCH_CL as CL, type TestCtx } from './helpers';

let t: TestCtx;
const SECRET = 'agent-secret-for-tests-0123456789abcdef';

before(async () => {
  process.env.AGENT_TOKEN_SECRET = SECRET;
  t = await setupTestApp();
});
after(async () => { await t?.teardown(); });

async function raw(method: string, path: string, token: string | null, body?: unknown) {
  const res = await t.app.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, text };
}

const agentToken = async (staffToken?: string) => {
  const res = staffToken ? await raw('POST', '/agent/session', staffToken) : await t.api('POST', '/agent/session');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token as string;
};
const tool = (token: string, name: string, args: unknown = {}) => raw('POST', `/agent/tools/${name}`, token, args);

test('tokens: the assistant gets a short-lived agent token that is useless anywhere else', async () => {
  const token = await agentToken();
  assert.equal((await raw('GET', '/inventory/stock', token)).status, 401, 'an agent token opened a normal route');
  const staff = (await raw('GET', '/products', null)).status;
  assert.equal(staff, 401);
  // a normal login token is not an agent token
  const res = await t.api('POST', '/agent/tools/search_products', { query: '' });
  assert.equal(res.status, 401);
  assert.equal((await tool('not-a-token', 'search_products')).status, 401);
  assert.equal((await raw('POST', '/agent/tools/search_products', null)).status, 401);
});

test('tokens: switched off without a strong, separate secret', async () => {
  const saved = process.env.AGENT_TOKEN_SECRET;
  try {
    process.env.AGENT_TOKEN_SECRET = 'short';
    assert.equal((await t.api('POST', '/agent/session')).status, 503);
    process.env.AGENT_TOKEN_SECRET = process.env.BETTER_AUTH_SECRET;
    assert.equal((await t.api('POST', '/agent/session')).status, 503);
  } finally {
    process.env.AGENT_TOKEN_SECRET = saved;
  }
});

test('tokens: signing out cuts the assistant off at once', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  const token = await agentToken(user.token);
  assert.equal((await tool(token, 'search_products', { query: '' })).status, 200);
  await t.q('DELETE FROM "session" WHERE "userId" = $1', [user.id]);
  assert.equal((await tool(token, 'search_products', { query: '' })).status, 401);
});

test('rate limit: each message uses one token; 60 per user per hour', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  await t.q(`INSERT INTO agent_usage (id, user_id) SELECT gen_random_uuid()::text, $1 FROM generate_series(1, 60)`, [user.id]);
  assert.equal((await raw('POST', '/agent/session', user.token)).status, 429);
  await t.q(`UPDATE agent_usage SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE user_id = $1`, [user.id]);
  assert.equal((await raw('POST', '/agent/session', user.token)).status, 200);
});

test('tools: product search never exposes cost; stock is limited to the user\'s branch', async () => {
  const p = await t.createProduct({ cost: 123.45, price: 300 });
  const name = (await t.q('SELECT name FROM products WHERE id = $1', [p]))[0].name;
  await t.setStock(p, 7, { branchId: HQ });
  await t.setStock(p, 40, { branchId: CL });

  const admin = await agentToken();
  const found = await tool(admin, 'search_products', { query: name });
  assert.equal(found.status, 200, found.text);
  assert.ok(!/123\.45|cost/i.test(found.text), 'cost price reached the assistant');
  assert.equal(found.body.products[0].unitsOnHand, 47);

  const hqUser = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  const scoped = await agentToken(hqUser.token);
  const stock = await tool(scoped, 'get_stock', { product: name });
  assert.equal(stock.status, 200, stock.text);
  assert.deepEqual(stock.body.locations.map((l: any) => l.onHand), [7], 'a branch user saw another branch');
  assert.equal((await tool(scoped, 'search_products', { query: name })).body.products[0].unitsOnHand, 7);
});

test('tools: reports and orders follow the user\'s permissions', async () => {
  const noReports = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  const perms = (await t.q(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = 'role-branch-user'`)).map((r: any) => r.code);
  const token = await agentToken(noReports.token);
  const summary = await tool(token, 'get_sales_summary', { period: 'week' });
  assert.equal(summary.status, 200);
  if (perms.includes('view_reports')) assert.ok('invoices' in summary.body);
  else assert.match(summary.body.error, /permission/);

  const admin = await agentToken();
  const week = await tool(admin, 'get_sales_summary', { period: 'week' });
  assert.equal(week.status, 200, week.text);
  assert.ok(Number.isFinite(week.body.netSales));
  const odd = await tool(admin, 'get_sales_summary', { period: "week'; DROP TABLE invoices; --" });
  assert.equal(odd.body.period, 'week', 'unknown periods fall back to a fixed value');
  const low = await tool(admin, 'get_low_stock');
  assert.ok(Array.isArray(low.body.items));
  const orders = await tool(admin, 'list_orders', { limit: 3 });
  assert.ok(Array.isArray(orders.body.orders) && orders.body.orders.length <= 3);
});

test('changes: a proposal changes nothing; only the same user can confirm it, once', async () => {
  const p = await t.createProduct({ price: 100 });
  const name = (await t.q('SELECT name FROM products WHERE id = $1', [p]))[0].name;
  await t.setStock(p, 5, { branchId: HQ });
  const token = await agentToken();

  const proposed = await raw('POST', '/agent/proposals', token, { action: 'adjust_stock', args: { product: name, quantity: 20, location: 'HQ', reason: 'delivery from supplier' } });
  assert.equal(proposed.status, 200, proposed.text);
  const { id, summary } = proposed.body.proposal;
  assert.match(summary, /Ku dar 20 xabbo .* \(5 -> 25\)/);
  assert.equal(await t.stockOf(p, { branchId: HQ }), 5, 'proposing changed stock');

  // the Worker's token cannot confirm; another user cannot confirm
  assert.equal((await raw('POST', `/agent/actions/${id}/execute`, token)).status, 401);
  const other = await t.createUser({ branchId: HQ, roleId: 'role-branch-user', role: 'branch_user', grants: ['assistant.use', 'accounting.view'] });
  assert.equal((await raw('POST', `/agent/actions/${id}/execute`, other.token)).status, 409);

  const done = await t.api('POST', `/agent/actions/${id}/execute`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await t.stockOf(p, { branchId: HQ }), 25);
  assert.equal((await t.api('POST', `/agent/actions/${id}/execute`)).status, 409, 'a confirmation ran twice');
  const ledger = await t.q(`SELECT notes FROM inventory_transactions WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`, [p]);
  assert.match(ledger[0].notes, /AI assistant \(confirmed\): delivery from supplier/);
});

test('changes: price changes, refusals, cancel and expiry', async () => {
  const p = await t.createProduct({ price: 100 });
  const name = (await t.q('SELECT name FROM products WHERE id = $1', [p]))[0].name;
  await t.setStock(p, 2, { branchId: HQ });
  const token = await agentToken();

  const price = await raw('POST', '/agent/proposals', token, { action: 'set_price', args: { product: name, price: 120 } });
  assert.match(price.body.proposal.summary, /100\.00 -> 120\.00/);
  assert.equal((await t.api('POST', `/agent/actions/${price.body.proposal.id}/execute`)).status, 200);
  assert.equal(Number((await t.q('SELECT selling_price FROM products WHERE id = $1', [p]))[0].selling_price), 120);

  // impossible requests are refused before anything is proposed
  const tooMany = await raw('POST', '/agent/proposals', token, { action: 'adjust_stock', args: { product: name, quantity: -5, location: 'HQ' } });
  assert.match(tooMany.body.error, /Only 2 in stock/);
  assert.match((await raw('POST', '/agent/proposals', token, { action: 'delete_everything', args: {} })).body.error, /Unknown action/);
  assert.match((await raw('POST', '/agent/proposals', token, { action: 'set_price', args: { product: name, price: -1 } })).body.error, /positive/);

  // only the Owner can change a selling price: anyone else cannot even get a proposal
  const accountant = await t.createUser({ branchId: null, roleId: 'role-accountant', role: 'accountant', grants: ['assistant.use', 'accounting.view'] });
  const denied = await raw('POST', '/agent/proposals', await agentToken(accountant.token), { action: 'set_price', args: { product: name, price: 1 } });
  assert.match(denied.body.error, /Only the Owner/);

  const later = await raw('POST', '/agent/proposals', token, { action: 'set_price', args: { product: name, price: 130 } });
  assert.equal((await t.api('POST', `/agent/actions/${later.body.proposal.id}/cancel`)).status, 200);
  assert.equal((await t.api('POST', `/agent/actions/${later.body.proposal.id}/execute`)).status, 409);

  const stale = await raw('POST', '/agent/proposals', token, { action: 'set_price', args: { product: name, price: 140 } });
  await t.q(`UPDATE agent_actions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [stale.body.proposal.id]);
  assert.equal((await t.api('POST', `/agent/actions/${stale.body.proposal.id}/execute`)).status, 409);
  assert.equal(Number((await t.q('SELECT selling_price FROM products WHERE id = $1', [p]))[0].selling_price), 120);
});
