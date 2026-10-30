// Somali-first behaviour of the assistant loop, with a scripted model and a
// stubbed backend: the instructions it gets, reading every module through
// get_data, the fixed off-topic reply, and no figures without data.
//   node --import tsx --test ai-agent/tests/*.test.ts   (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, TOOLS, figuresIn, unsupportedFigures, limitsOf, type AgentEnv } from '../src/agent';
import { OFF_TOPIC_REPLY, SAY, systemPrompt, todayInSomaliland } from '../src/somali';
import { DATA_SOURCES } from '../../backend/src/services/agent-data';

function scripted(outputs: unknown[]) {
  const calls: any[] = [];
  return {
    calls,
    AI: { run: async (model: string, input: any, options?: any) => { calls.push({ model, input: structuredClone(input), options }); return outputs.shift() ?? { response: '' }; } },
  };
}
const callTool = (name: string, args: Record<string, unknown> = {}, id = 'c1') =>
  ({ choices: [{ message: { content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const say = (content: string) => ({ choices: [{ message: { content } }] });

/** Backend stub: answers /agent/tools/* from a table and records what was asked. */
function backend(answers: Record<string, unknown>) {
  const seen: { path: string; body: any }[] = [];
  const fetchImpl = (async (input: any, init?: any) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(init.body) : {};
    seen.push({ path, body });
    const key = path.endsWith('/get_data') ? `get_data:${body.source}` : path.split('/').pop()!;
    return new Response(JSON.stringify(answers[key] ?? { error: 'not stubbed' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { seen, fetchImpl };
}
const env = (AI: any, extra: Partial<AgentEnv> = {}): AgentEnv => ({ AI, AI_MODEL: '@cf/test/model', ALHAYAT_API_URL: 'https://erp.example.com/api/v1', ...extra });
const ask = (e: AgentEnv, question: string, fetchImpl: typeof fetch, earlier: { role: 'user' | 'assistant'; content: string }[] = []) =>
  runAgent(e, 'agent-token', [...earlier, { role: 'user', content: question }], { fetchImpl });

test('instructions: Somali first, today\'s date, the glossary, the off-topic rule and no invented figures', () => {
  const { today, weekday } = todayInSomaliland(new Date('2026-10-29T22:30:00Z')); // already Friday in Hargeisa
  assert.equal(today, '2026-10-30');
  assert.equal(weekday, 'Jimco');
  const prompt = systemPrompt(today, weekday);
  for (const must of ['Reply in Somali', 'Jimco 2026-10-30', 'decline_off_topic', 'Never estimate, invent', 'deyn', "faa'iido", 'xaashida dheelitirka', 'kharash', 'bishan=this month', 'never ask them to use particular words']) {
    assert.ok(prompt.includes(must), `instructions lack: ${must}`);
  }
});

test('tools: every ERP module is reachable through get_data, accounting included', () => {
  const getData = TOOLS.find((t) => t.function.name === 'get_data')!;
  const params = getData.function.parameters as any;
  assert.deepEqual(params.properties.source.enum, Object.keys(DATA_SOURCES));
  for (const source of ['income_statement', 'balance_sheet', 'trial_balance', 'cash_flow', 'general_ledger', 'journal_entries', 'expenses_summary',
    'debts_summary', 'customer_ledger', 'deliveries', 'purchase_orders', 'suppliers', 'inventory_valuation', 'assets_dashboard', 'livestock', 'work_orders', 'branch_performance']) {
    assert.ok(params.properties.source.enum.includes(source), `${source} missing`);
    assert.ok(getData.function.description.includes(`${source}`), `${source} not described`);
  }
  assert.ok(TOOLS.some((t) => t.function.name === 'decline_off_topic'));
});

// One Somali question per module: the model's tool choice is scripted (the real
// model's understanding is checked by scripts/somali-eval.ts); this checks the
// request reaches the right part of the ERP and the data-backed answer is returned.
const MODULES: { q: string; source: string; data: unknown; answer: string }[] = [
  { q: "faaidada bishan maxay ahayd?", source: 'income_statement', data: { revenue: 48250, net_income: 9120.5 }, answer: "Faa'iidada bishan: dakhli $48,250.00, faa'iido saafi ah $9,120.50." },
  { q: 'xaashida dheelitirka i tus', source: 'balance_sheet', data: { total_assets: 310400, total_liabilities: 85200, total_equity: 225200 }, answer: 'Hantida guud $310,400, deymaha $85,200, raasumaalka $225,200.' },
  { q: 'yaa deyn nagu leh', source: 'debts_summary', data: { total_outstanding: 15730, debtors: 12 }, answer: '12 macmiil ayaa deyn idinku leh, wadarta $15,730.' },
  { q: 'kharashyada bishan', source: 'expenses_summary', data: { total: 4310.75 }, answer: 'Kharashyada bishan waa $4,310.75.' },
  { q: 'gaarsiimaha xaaladooda', source: 'deliveries_stats', data: { pending: 4, dispatched: 7, delivered: 31 }, answer: '4 sugaya, 7 la diray, 31 la gaarsiiyay.' },
  { q: 'inta aan sapleerada ku leenahay', source: 'purchases_summary', data: { outstanding_payables: 22640 }, answer: 'Waxaad alaab-keenayaasha ku leedihiin $22,640.' },
  { q: 'qiimaha kaydka oo dhan', source: 'inventory_valuation', data: { total_value: 187300 }, answer: 'Qiimaha kaydka oo dhan waa $187,300.' },
  { q: 'kirada guryaha', source: 'rental_summary', data: { collected: 3600, outstanding: 1200 }, answer: 'Kirada la qaaday $3,600, harsan $1,200.' },
  { q: 'xoolaha imisa ayaa jira', source: 'livestock', data: [{ type: 'geel', count: 14 }], answer: '14 geel ayaa jira.' },
  { q: 'wax soo saarka sidee yahay', source: 'manufacturing_stats', data: { in_progress: 3, completed: 18 }, answer: '3 socda, 18 la dhammeeyay.' },
];

for (const m of MODULES) {
  test(`module "${m.source}": "${m.q}" is answered from the system's data`, async () => {
    const { AI } = scripted([callTool('get_data', { source: m.source }), say(m.answer)]);
    const { seen, fetchImpl } = backend({ [`get_data:${m.source}`]: m.data });
    const result = await ask(env(AI), m.q, fetchImpl);
    assert.equal(result.reply, m.answer);
    assert.deepEqual(result.toolsUsed, ['get_data']);
    assert.deepEqual(seen.map((s) => [s.path, s.body.source]), [['/api/v1/agent/tools/get_data', m.source]]);
  });
}

test('accounting follow-up: looks up the account, then its ledger, with dates for "bishii hore"', async () => {
  const { AI, calls } = scripted([
    callTool('get_data', { source: 'chart_of_accounts' }),
    callTool('get_data', { source: 'general_ledger', filters: { account_id: 'acc-cash', from_date: '2026-09-01', to_date: '2026-09-30' } }, 'c2'),
    say('Akoonka lacagta caddaanka ah bishii hore: soo galay $21,000, baxay $17,450.'),
  ]);
  const { seen, fetchImpl } = backend({
    'get_data:chart_of_accounts': [{ id: 'acc-cash', code: '1000', name: 'Cash' }],
    'get_data:general_ledger': { debits: 21000, credits: 17450 },
  });
  const result = await ask(env(AI), 'lacagta caddaanka ah bishii hore xisaabteeda i sii', fetchImpl);
  assert.match(result.reply, /21,000/);
  assert.deepEqual(seen.map((s) => s.body.source), ['chart_of_accounts', 'general_ledger']);
  assert.deepEqual(seen[1].body.filters, { account_id: 'acc-cash', from_date: '2026-09-01', to_date: '2026-09-30' });
  assert.equal(calls[1].input.messages.filter((m: any) => m.role === 'tool').length, 1);
});

test('off topic: the fixed Somali sentence, whether the model calls the tool or answers it in words', async () => {
  const { fetchImpl, seen } = backend({});
  const viaTool = await ask(env(scripted([callTool('decline_off_topic')]).AI), 'yaa ku guulaystay kubadda cagta shalay?', fetchImpl);
  assert.equal(viaTool.reply, OFF_TOPIC_REPLY);
  const viaText = await ask(env(scripted([say(`"${OFF_TOPIC_REPLY}" Laakiin...`)]).AI), 'cimilada Hargeysa?', fetchImpl);
  assert.equal(viaText.reply, OFF_TOPIC_REPLY);
  assert.equal(seen.length, 0, 'an off-topic question reached the ERP');
  assert.equal(OFF_TOPIC_REPLY, 'Kaliya waxaan kaaga jawaabi karaa wax ku saabsan hawlaha Al-Hayat.');
});

test('no invented figures: a number without a lookup gets one nudge, then a refusal to guess', async () => {
  const { fetchImpl } = backend({ 'get_data:sales_summary': { total_sales: 5120 } });
  // nudged, then the model looks it up and answers from the data
  const fixed = scripted([say('Iibka maanta waa $9,999.'), callTool('get_data', { source: 'sales_summary' }), say('Iibka waa $5,120.')]);
  const ok = await ask(env(fixed.AI), 'iibka maanta?', fetchImpl);
  assert.equal(ok.reply, 'Iibka waa $5,120.');
  assert.match(fixed.calls[1].input.messages.at(-1).content, /9999/);
  // keeps inventing: the user gets the "no data" sentence, never the made-up number
  const stubborn = scripted([say('Iibka maanta waa $9,999.'), say('Waa $8,888 qiyaas ahaan.')]);
  const refused = await ask(env(stubborn.AI), 'iibka maanta?', fetchImpl);
  assert.equal(refused.reply, SAY.noData);
});

test('figures that are allowed: from the data (also totals worked out from it), the conversation, or the date', async () => {
  const { fetchImpl } = backend({ 'get_data:branch_performance': [{ branch: 'HQ', sales: 1200 }, { branch: 'CL', sales: 800 }] });
  const sum = scripted([callTool('get_data', { source: 'branch_performance' }), say('Labada laamood: $1,200 iyo $800, wadar $2,000.')]);
  assert.match((await ask(env(sum.AI), 'iibka laamaha isbarbar dhig', fetchImpl)).reply, /2,000/);
  const greet = scripted([say('Salaan! Maxaan kaaga caawin karaa Al-Hayat maanta?')]);
  assert.match((await ask(env(greet.AI), 'asc, see tahay', fetchImpl)).reply, /Salaan/);
  const echo = scripted([say('Haa, 25 xabbo ayaad sheegtay.')]);
  assert.match((await ask(env(echo.AI), 'waxaan rabaa 25 xabbo', fetchImpl)).reply, /25 xabbo/);
});

test('settings: limits and AI Gateway come from the Worker\'s vars, with safe bounds', async () => {
  assert.deepEqual(limitsOf({}), { rounds: 6, history: 10, replyTokens: 1000 });
  assert.deepEqual(limitsOf({ AGENT_MAX_ROUNDS: '9', AGENT_MAX_HISTORY: '30', AGENT_MAX_REPLY_TOKENS: '2000' }), { rounds: 9, history: 30, replyTokens: 2000 });
  assert.deepEqual(limitsOf({ AGENT_MAX_ROUNDS: '999', AGENT_MAX_HISTORY: 'x', AGENT_MAX_REPLY_TOKENS: '-5' }), { rounds: 12, history: 10, replyTokens: 1000 });
  const { AI, calls } = scripted([say('Haa.')]);
  await ask(env(AI, { AI_GATEWAY_ID: 'al-hayat', AGENT_MAX_REPLY_TOKENS: '1500' }), 'hi', backend({}).fetchImpl);
  assert.deepEqual(calls[0].options, { gateway: { id: 'al-hayat' } });
  assert.equal(calls[0].input.max_tokens, 1500);
});

test('helpers: figures are compared after removing separators', () => {
  assert.deepEqual(figuresIn('Iibka $12,450.00 iyo 3 dalab, 2026-10-30'), ['12450', '2026', '10', '30']);
  assert.deepEqual(unsupportedFigures('Wadar $12,450', ['{"total":12450}']), []);
  assert.deepEqual(unsupportedFigures('Wadar $12,451', ['{"total":12450}']), ['12451']);
});
