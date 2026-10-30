// Somali evaluation of the REAL model against a running ERP: varied Somali
// questions (dialects, misspellings, informal and mixed with English) across
// every module, accounting included, plus off-topic questions and a greeting.
// For each it checks which part of the ERP the model consulted, that the reply
// is in Somali, the fixed off-topic sentence, and figures not found in the data.
//
// Run from the repository root (read-only: it only asks questions):
//   $env:ERP_API_URL="https://al-hayat-erp.pages.dev/api/v1"
//   $env:STAFF_EMAIL="..."; $env:STAFF_PASSWORD="..."        (an administrator, to reach every module)
//   $env:CLOUDFLARE_ACCOUNT_ID="..."; $env:CLOUDFLARE_API_TOKEN="..."   (token with Workers AI: Read)
//   node --import tsx ai-agent/scripts/somali-eval.ts
// Optional: AI_MODEL (default: the one in ai-agent/wrangler.jsonc), ONLY=3,7 (question numbers).
// Each question uses one of the user's 60 assistant messages per hour.
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { runAgent, unsupportedFigures, type AiBinding } from '../src/agent';
import { OFF_TOPIC_REPLY } from '../src/somali';

type Case = { q: string; expect: string[] | 'off_topic' | 'chat'; english?: boolean };

// expect: tools or get_data sources, any one of which counts as the right place.
const CASES: Case[] = [
  { q: 'maanta iibkeenu muxuu ahaa?', expect: ['get_sales_summary', 'sales_summary', 'sales_orders'] },
  { q: 'iibka todobaadkan', expect: ['get_sales_summary', 'sales_summary', 'sales_orders'] },
  { q: 'bishan wax badan ma iibinay mise wax yar', expect: ['get_sales_summary', 'sales_summary', 'sales_orders', 'income_statement'] },
  { q: 'alaabta ku dhamaanaysa stoorka', expect: ['get_low_stock', 'low_stock', 'inventory_stock'] },
  { q: 'kursiyada imisa ayaa inoo yaal', expect: ['search_products', 'get_stock', 'inventory_stock', 'products'] },
  { q: 'yaa lacag nagu leh?', expect: ['debts', 'debts_summary', 'customers', 'receivables_report'] },
  { q: 'macaamiisha deynta ugu badan ku leh liiska ii soo saar', expect: ['debts', 'customers', 'debts_summary', 'receivables_report'] },
  { q: 'lacagihii la bixiyay maanta', expect: ['sales_orders', 'customer_ledger', 'sales_summary', 'get_sales_summary', 'debts_summary'] },
  { q: 'dalabaadka aan weli la gaarsiin', expect: ['deliveries', 'deliveries_stats', 'sales_orders', 'list_orders'] },
  { q: 'darawaliinta alaabta qaada xaaladdooda maanta', expect: ['deliveries', 'deliveries_stats'] },
  { q: 'maxaan ka soo iibsanay sapleerada bishan', expect: ['purchase_orders', 'purchases_summary'] },
  { q: 'imisa ayaan ku leenahay shirkadaha alaabta noo keena', expect: ['purchases_summary', 'suppliers', 'balance_sheet', 'purchase_orders', 'supplier_performance'] },
  { q: 'faaidada bishan', expect: ['income_statement', 'accounting_dashboard', 'sales_profit'] },
  { q: 'khasaare ma ku jirnaa sanadkan?', expect: ['income_statement', 'accounting_dashboard'] },
  { q: 'income statement-ka i tus', expect: ['income_statement'] },
  { q: 'xaashida dheelitirka', expect: ['balance_sheet'] },
  { q: 'hantida iyo deymaha shirkadda wadartooda', expect: ['balance_sheet', 'accounting_dashboard'] },
  { q: 'trial balance-ka ma dheelitiran yahay', expect: ['trial_balance'] },
  { q: 'lacagta caddaanka ah ee khasnadda', expect: ['cash_flow', 'balance_sheet', 'general_ledger', 'chart_of_accounts', 'accounting_dashboard'] },
  { q: 'jornaalada ugu dambeeyay ee la qoray', expect: ['journal_entries'] },
  { q: 'akoonka bangiga dhaqdhaqaaqiisa bishan', expect: ['chart_of_accounts', 'general_ledger'] },
  { q: 'kharashyada bishan maxay ahaayeen', expect: ['expenses_summary', 'expenses', 'income_statement'] },
  { q: 'kirada guryaha intee la qaaday', expect: ['rental_summary', 'rental_payments', 'properties', 'assets_dashboard'] },
  { q: 'xoolaha imisa ayaa jira', expect: ['livestock', 'assets_dashboard'] },
  { q: 'laanta ugu iibka badan', expect: ['branch_performance', 'branch_accounts', 'get_sales_summary'] },
  { q: 'qiimaha alaabta bakhaarka ku jirta oo dhan', expect: ['inventory_valuation', 'inventory_stock'] },
  { q: 'wax soo saarka socda', expect: ['work_orders', 'manufacturing_stats'] },
  { q: 'raasumaalka milkiilaha', expect: ['owners_equity', 'balance_sheet'] },
  { q: 'qiima dhaca hantida go\'an', expect: ['depreciation', 'balance_sheet'] },
  { q: 'yaa ku guulaystay doorashadii?', expect: 'off_topic' },
  { q: 'gabay ii tiri', expect: 'off_topic' },
  { q: 'cimilada berri sidee noqonaysaa', expect: 'off_topic' },
  { q: 'Python code ii qor', expect: 'off_topic' },
  { q: 'asc, sidee tahay?', expect: 'chat' },
  { q: 'how much did we sell this month?', expect: ['get_sales_summary', 'sales_summary', 'sales_orders', 'income_statement'], english: true },
];

const SOMALI = /\b(waa|waxaa|waxay|waxa|ayaa|ayuu|iyo|oo|ah|ka|ku|u|la|ma|aan|tahay|yahay|ahaa|sida|inta|wadarta|guud|bishan|maanta|lacag\w*|iib\w*|deyn\w*|kharash\w*|faa'?iido\w*|xog\w*|nidaam\w*|xisaab\w*|hanti\w*|kayd\w*|alaab\w*|macmiil\w*|fadlan)\b/gi;
const ENGLISH = /\b(the|is|are|and|of|your|this|that|with|from|total|sales|was|were|you)\b/gi;
const looksSomali = (s: string) => { const so = s.match(SOMALI)?.length ?? 0; return so >= 1 && so > (s.match(ENGLISH)?.length ?? 0); };

function need(name: string) {
  const v = process.env[name];
  if (!v) { console.error(`Set ${name}.`); process.exit(1); }
  return v;
}
const ERP = need('ERP_API_URL').replace(/\/$/, '');
const AUTH = ERP.replace(/\/api\/v1$/, '/api/auth');
const MODEL = process.env.AI_MODEL || (readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').match(/"AI_MODEL":\s*"([^"]+)"/)?.[1] ?? '');

/** Better Auth sign-in as a native client (node:http: fetch would add Sec-Fetch-Mode). */
function signIn(email: string, password: string): Promise<string> {
  const body = JSON.stringify({ email, password });
  const mod = AUTH.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(`${AUTH}/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Client-Type': 'native' } }, (res) => {
      res.resume();
      res.on('end', () => {
        const token = res.headers['set-auth-token'];
        if (res.statusCode === 200 && typeof token === 'string') resolve(token);
        else reject(new Error(`sign-in failed: HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// WORKERS_AI_URL: only to test this script against a stand-in; normally Cloudflare's API.
const WORKERS_AI = (process.env.WORKERS_AI_URL || 'https://api.cloudflare.com/client/v4').replace(/\/$/, '');
const restAI = (accountId: string, apiToken: string): AiBinding => ({
  async run(model, input) {
    const res = await fetch(`${WORKERS_AI}/accounts/${accountId}/ai/run/${model}`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const data: any = await res.json();
    if (!res.ok || data.success === false) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
    return data.result;
  },
});

async function main() {
  const session = await signIn(need('STAFF_EMAIL'), need('STAFF_PASSWORD'));
  const AI = restAI(need('CLOUDFLARE_ACCOUNT_ID'), need('CLOUDFLARE_API_TOKEN'));
  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null;
  console.log(`Model ${MODEL}, ERP ${ERP}\n`);
  let passed = 0, ran = 0;
  for (const [i, c] of CASES.entries()) {
    const n = i + 1;
    if (only && !only.has(n)) continue;
    ran++;
    const tokenRes = await fetch(`${ERP}/agent/session`, { method: 'POST', headers: { Authorization: `Bearer ${session}` } });
    if (!tokenRes.ok) { console.error(`agent session failed: HTTP ${tokenRes.status} ${await tokenRes.text()}`); process.exit(1); }
    const agentToken = ((await tokenRes.json()) as any).token as string;
    const consulted: string[] = [];
    const results: string[] = [];
    const recording = (async (input: any, init?: any) => {
      const path = new URL(String(input)).pathname;
      const body = init?.body ? JSON.parse(init.body) : {};
      consulted.push(path.endsWith('/get_data') ? String(body.source) : path.split('/').pop()!);
      const res = await fetch(input, init);
      const text = await res.clone().text();
      results.push(text);
      return res;
    }) as typeof fetch;
    let reply = '', error = '';
    try {
      reply = (await runAgent({ AI, AI_MODEL: MODEL, ALHAYAT_API_URL: ERP }, agentToken, [{ role: 'user', content: c.q }], { fetchImpl: recording })).reply;
    } catch (err) { error = err instanceof Error ? err.message : String(err); }

    const problems: string[] = [];
    if (error) problems.push(`error: ${error}`);
    if (c.expect === 'off_topic') {
      if (reply !== OFF_TOPIC_REPLY) problems.push('expected the off-topic sentence');
    } else {
      if (reply === OFF_TOPIC_REPLY) problems.push('refused an Al-Hayat question as off topic');
      if (Array.isArray(c.expect) && !consulted.some((s) => c.expect.includes(s))) problems.push(`consulted [${consulted.join(', ') || 'nothing'}], expected one of [${c.expect.join(', ')}]`);
      if (!c.english && reply && !looksSomali(reply)) problems.push('reply does not look Somali');
    }
    const unsupported = reply && results.length ? unsupportedFigures(reply, [...results, c.q]) : [];
    const ok = problems.length === 0;
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${String(n).padStart(2)}. ${c.q}`);
    console.log(`        consulted: ${consulted.join(', ') || '-'}`);
    console.log(`        reply: ${reply.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (unsupported.length) console.log(`        note: figures not found as-is in the data (check they are calculated, not invented): ${unsupported.join(', ')}`);
    for (const p of problems) console.log(`        problem: ${p}`);
  }
  console.log(`\n${passed}/${ran} passed.`);
  process.exitCode = passed === ran ? 0 : 1;
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
