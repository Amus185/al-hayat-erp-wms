// End to end: Somali questions through the assistant Worker's loop
// (ai-agent/src/agent.ts) into this backend and database. The model is
// scripted (it picks the tool a Somali question needs); everything after that
// is real: agent token, permissions, branch scope, routes and figures. The
// checks: the data the model is given is exactly what the user's own screen
// shows, for every module including accounting, and refusals reach it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestApp, BRANCH_HQ as HQ, type TestCtx } from './helpers';
import { runAgent, type AgentEnv } from '../../ai-agent/src/agent';
import { OFF_TOPIC_REPLY } from '../../ai-agent/src/somali';
import { DATA_SOURCES, resultForModel } from '../src/services/agent-data';

let t: TestCtx;
let customerId: string;
let customerName: string;

before(async () => {
  process.env.AGENT_TOKEN_SECRET = 'agent-secret-for-tests-0123456789abcdef';
  t = await setupTestApp();
  // A real credit sale: revenue, a receivable, a journal entry and a stock movement.
  const p = await t.createProduct({ cost: 40, price: 100 });
  await t.setStock(p, 5, { branchId: HQ });
  customerId = await t.createCustomer();
  customerName = (await t.q('SELECT name FROM customers WHERE id = $1', [customerId]))[0].name;
  const sale = await t.api('POST', '/sales/orders', {
    branchId: HQ, customerId, isCreditSale: true, initialDeposit: 30, lines: [{ productId: p, quantity: 1, unitPrice: 100 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
});
after(async () => { await t?.teardown(); });

/** The Worker's backend calls, answered by this app in-process. */
const viaApp = (async (input: any, init?: any) => {
  const url = new URL(String(input));
  return t.app.request(url.pathname + url.search, init);
}) as typeof fetch;

async function agentTokenFor(staffToken: string) {
  const res = await t.app.request('/api/v1/agent/session', { method: 'POST', headers: { Authorization: `Bearer ${staffToken}` } });
  assert.equal(res.status, 200);
  return ((await res.json()) as any).token as string;
}

/**
 * Scripted model: makes the given tool calls in order, then answers in Somali
 * quoting the first figure of the last result. Records what it was given.
 */
function scriptedModel(steps: { name: string; args?: (lastResult: any) => Record<string, unknown> }[]) {
  const seenResults: string[] = [];
  let i = 0;
  const AI = {
    async run(_model: string, input: any) {
      const tool = [...input.messages].reverse().find((m: any) => m.role === 'tool');
      if (tool && input.messages.at(-1).role === 'tool') seenResults.push(tool.content);
      const step = steps[i++];
      if (step) {
        const last = seenResults.length ? JSON.parse(seenResults.at(-1)!) : null;
        return { choices: [{ message: { content: '', tool_calls: [{ id: `c${i}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args?.(last) ?? {}) } }] } }] };
      }
      const figure = (seenResults.at(-1) ?? '').match(/\d+(\.\d+)?/)?.[0] ?? '';
      return { choices: [{ message: { content: `Sida nidaamku muujinayo: ${figure}` } }] };
    },
  };
  return { AI, seenResults };
}

const env = (AI: any): AgentEnv => ({ AI, AI_MODEL: '@cf/test/model', ALHAYAT_API_URL: 'http://erp.test/api/v1' });
const screen = async (path: string, token: string) => {
  const res = await t.app.request(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, `${path}: ${res.status}`);
  return res.json();
};

const QUESTIONS: { q: string; source: string; filters?: Record<string, string> }[] = [
  { q: "faa'iidadeena guud waa imisa?", source: 'income_statement' },
  { q: 'xaashida dheelitirka hantida iyo deymaha', source: 'balance_sheet' },
  { q: 'dheelitirka tijaabada akoonada oo dhan', source: 'trial_balance' },
  { q: 'socodka lacagta caddaanka ah', source: 'cash_flow' },
  { q: 'diiwaanka xisaabaadka u dambeeyay', source: 'journal_entries' },
  { q: 'yaa deyn nagu leh wadarta guud', source: 'debts_summary' },
  { q: 'dalabaadka iibka ee la sameeyay', source: 'sales_orders' },
  { q: 'kharashaadka shirkadda', source: 'expenses_summary' },
  { q: 'gaarsiimaha xaaladooda', source: 'deliveries_stats' },
  { q: 'iibsashada iyo inta sapleerada lagu leeyahay', source: 'purchases_summary' },
  { q: 'kaydka alaabta bakhaarada iyo laamaha', source: 'inventory_stock' },
  { q: 'qiimaha kaydka oo dhan', source: 'inventory_valuation' },
  { q: 'hantida milkiilaha guud ahaan', source: 'assets_dashboard' },
  { q: 'wax soo saarka warshadda', source: 'manufacturing_stats' },
];

for (const { q, source, filters } of QUESTIONS) {
  test(`"${q}" → ${source}: the model gets exactly the administrator's screen data`, async () => {
    const { AI, seenResults } = scriptedModel([{ name: 'get_data', args: () => ({ source, ...(filters ? { filters } : {}) }) }]);
    const token = await agentTokenFor(t.adminToken);
    const result = await runAgent(env(AI), token, [{ role: 'user', content: q }], { fetchImpl: viaApp });
    const expected = resultForModel(await screen(DATA_SOURCES[source].path, t.adminToken), false);
    assert.equal(seenResults[0], expected, `${source}: the assistant's data differs from the screen`);
    assert.match(result.reply, /^Sida nidaamku muujinayo/);
  });
}

test('accounting figures are real: the income statement the assistant reads includes today\'s sale', async () => {
  const { AI, seenResults } = scriptedModel([{ name: 'get_data', args: () => ({ source: 'income_statement' }) }]);
  await runAgent(env(AI), await agentTokenFor(t.adminToken), [{ role: 'user', content: 'dakhliga iyo faaiidada' }], { fetchImpl: viaApp });
  assert.match(seenResults[0], /\b100\b/, `the 100.00 sale is not in ${seenResults[0].slice(0, 300)}`);
});

test('a customer by name: find them, then their ledger (two lookups, real ids)', async () => {
  const { AI, seenResults } = scriptedModel([
    { name: 'get_data', args: () => ({ source: 'customers', filters: { search: customerName } }) },
    { name: 'get_data', args: (found) => ({ source: 'customer_ledger', id: (Array.isArray(found) ? found : found.customers ?? found.data)[0].id }) },
  ]);
  await runAgent(env(AI), await agentTokenFor(t.adminToken), [{ role: 'user', content: `${customerName} immisa ayuu nagu leeyahay, xisaabtiisa i tus` }], { fetchImpl: viaApp });
  assert.equal(seenResults.length, 2);
  assert.equal(seenResults[1], resultForModel(await screen(`/sales/customers/${customerId}/ledger`, t.adminToken), false));
});

test('the existing quick tools still answer Somali questions (iibka toddobaadkan)', async () => {
  const { AI, seenResults } = scriptedModel([{ name: 'get_sales_summary', args: () => ({ period: 'week' }) }]);
  await runAgent(env(AI), await agentTokenFor(t.adminToken), [{ role: 'user', content: 'iibka toddobaadkan intee buu ahaa' }], { fetchImpl: viaApp });
  assert.match(seenResults[0], /"netSales":100\b/);
});

test('permissions hold: a warehouse manager asking about profit gets a refusal, not figures', async () => {
  const user = await t.createUser({ branchId: HQ, roleId: 'role-warehouse-manager', role: 'warehouse_manager' });
  const { AI, seenResults } = scriptedModel([{ name: 'get_data', args: () => ({ source: 'income_statement' }) }]);
  await runAgent(env(AI), await agentTokenFor(user.token), [{ role: 'user', content: "faa'iidada bishan?" }], { fetchImpl: viaApp });
  assert.match(seenResults[0], /permission/i);
  assert.ok(!/\b100\b/.test(seenResults[0]), 'figures reached a user without permission');
});

test('off topic never reaches the ERP and gets the fixed sentence', async () => {
  let backendCalls = 0;
  const counting = (async (...a: Parameters<typeof fetch>) => { backendCalls++; return viaApp(...a); }) as typeof fetch;
  const AI = { run: async () => ({ choices: [{ message: { content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'decline_off_topic', arguments: '{}' } }] } }] }) };
  const result = await runAgent(env(AI), await agentTokenFor(t.adminToken), [{ role: 'user', content: 'Barcelona ma guulaysatay?' }], { fetchImpl: counting });
  assert.equal(result.reply, OFF_TOPIC_REPLY);
  assert.equal(backendCalls, 0);
});
