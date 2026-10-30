// The assistant's loop: ask the model, run the tools it asks for through the
// Alhayat backend, and repeat until it answers. No database access here: every
// lookup is an HTTP call to /api/v1/agent with the user's short-lived agent
// token, and changes can only be proposed (the user confirms them in the app).
// It answers in Somali (somali.ts), only about Al-Hayat, and only with figures
// the system returned.
import { DATA_SOURCES } from '../../backend/src/services/agent-data';
import { OFF_TOPIC_REPLY, SAY, systemPrompt, todayInSomaliland } from './somali';

export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface AgentEnv {
  AI: AiBinding;
  /** The model. One place to change it: wrangler.jsonc → vars.AI_MODEL. */
  AI_MODEL: string;
  /** The Alhayat backend, ending in /api/v1. */
  ALHAYAT_API_URL: string;
  /**
   * Service binding to the backend Worker. When present, backend calls go
   * through it (Workers cannot fetch another Worker's workers.dev address).
   */
  ALHAYAT_API?: { fetch: typeof fetch };
  /** Optional limits (wrangler.jsonc vars); raise them on a paid plan. */
  AGENT_MAX_ROUNDS?: string;
  AGENT_MAX_HISTORY?: string;
  AGENT_MAX_REPLY_TOKENS?: string;
  /** Optional Cloudflare AI Gateway id: logs, caching and rate limits for model calls. */
  AI_GATEWAY_ID?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Proposal {
  id: string;
  action: string;
  summary: string;
  expiresInMinutes: number;
}

export interface ChatResult {
  reply: string;
  proposals: Proposal[];
  toolsUsed: string[];
}

// Default limits, each overridable in wrangler.jsonc vars (see limitsOf).
export const MAX_HISTORY = 10;         // messages sent to the model
export const MAX_MESSAGE_CHARS = 2000; // per message
export const MAX_REPLY_TOKENS = 1000;  // Somali answers run longer than English ones
export const MAX_ROUNDS = 6;           // model calls per question
const MAX_TOOL_RESULT_CHARS = 8000;

const int = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : def;
};
export function limitsOf(env: Partial<AgentEnv>) {
  return {
    rounds: int(env.AGENT_MAX_ROUNDS, MAX_ROUNDS, 2, 12),
    history: int(env.AGENT_MAX_HISTORY, MAX_HISTORY, 2, 40),
    replyTokens: int(env.AGENT_MAX_REPLY_TOKENS, MAX_REPLY_TOKENS, 200, 4000),
  };
}

type JsonSchema = Record<string, unknown>;
const fn = (name: string, description: string, properties: JsonSchema = {}, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const str = (description: string) => ({ type: 'string', description });

const SOURCE_LIST = Object.entries(DATA_SOURCES)
  .map(([name, s]) => `${name}${s.path.includes(':id') ? '(id)' : ''}: ${s.about}${s.query.length ? ` [${s.query.join(', ')}]` : ''}`)
  .join('\n');

/** What the model may call. Read tools map 1:1 to /agent/tools/<name>. */
export const TOOLS = [
  fn('search_products', 'Find products by name, SKU or category. Returns price, category, whether it is on the website and units on hand.', { query: str('words to search for; empty for all') }),
  fn('get_stock', 'Stock of one product per branch and warehouse, including units held for website orders.', { product: str('product name or SKU') }, ['product']),
  fn('get_low_stock', 'Products at or below their reorder level.'),
  fn('get_sales_summary', 'Sales totals (invoices, net sales, paid) and top products for a period.', {
    period: { type: 'string', enum: ['today', 'week', 'month', 'year'], description: 'the period; this week if not said' },
  }),
  fn('list_orders', 'Recent sales orders, newest first, and how many website requests are new.', {
    status: str('optional: DRAFT, CONFIRMED, INVOICED, PAID, DELIVERED or CANCELLED'),
    limit: { type: 'integer', description: '1 to 10, default 5' },
  }),
  fn('get_data', `Read any part of the Al-Hayat ERP as the signed-in user, with the same permissions and branch as their screens. Sources ("(id)" needs a record id; filters in brackets):\n${SOURCE_LIST}`, {
    source: { type: 'string', enum: Object.keys(DATA_SOURCES), description: 'which part of the ERP to read' },
    id: str('the record id, for sources marked (id)'),
    filters: { type: 'object', description: 'optional filters listed for the source, e.g. {"dateFrom":"2026-10-01","dateTo":"2026-10-31"}; dates as YYYY-MM-DD' },
  }, ['source']),
  fn('decline_off_topic', 'Call this when the question is not about Al-Hayat, its business or its ERP. The user then gets the standard reply.'),
  fn('propose_stock_adjustment', 'Propose adding (positive) or removing (negative) stock. Nothing changes until the user confirms.', {
    product: str('product name or SKU'),
    quantity: { type: 'integer', description: 'units to add (positive) or remove (negative)' },
    location: str('branch name, if the user said one'),
    reason: str('short reason'),
  }, ['product', 'quantity']),
  fn('propose_price_change', 'Propose a new selling price. Nothing changes until the user confirms.', {
    product: str('product name or SKU'),
    price: { type: 'number', description: 'the new selling price' },
  }, ['product', 'price']),
];

const READ_TOOLS = new Set(['search_products', 'get_stock', 'get_low_stock', 'get_sales_summary', 'list_orders', 'get_data']);
const PROPOSE: Record<string, string> = { propose_stock_adjustment: 'adjust_stock', propose_price_change: 'set_price' };

interface ToolCall { id: string; name: string; args: Record<string, unknown> }

/**
 * Workers AI models answer in one of two shapes: OpenAI-style
 * (choices[0].message with tool_calls[].function.arguments as a JSON string)
 * or the older Workers AI shape ({ response, tool_calls: [{ name, arguments }] }).
 */
export function readModelOutput(out: unknown): { text: string; calls: ToolCall[] } {
  const o = (out ?? {}) as any;
  const parse = (a: unknown) => {
    if (a && typeof a === 'object') return a as Record<string, unknown>;
    try { return JSON.parse(String(a ?? '{}')); } catch { return {}; }
  };
  const msg = o.choices?.[0]?.message;
  if (msg) {
    const calls = (msg.tool_calls ?? []).map((c: any, i: number) => ({
      id: String(c.id ?? `call_${i}`), name: String(c.function?.name ?? c.name ?? ''), args: parse(c.function?.arguments ?? c.arguments),
    }));
    return { text: stripThinking(String(msg.content ?? '')), calls };
  }
  const calls = (o.tool_calls ?? []).map((c: any, i: number) => ({ id: `call_${i}`, name: String(c.name ?? ''), args: parse(c.arguments) }));
  const text = typeof o.response === 'string' ? o.response : o.response ? JSON.stringify(o.response) : '';
  return { text: stripThinking(text), calls };
}

/** Numbers of two or more digits in a text, normalised (12,450.00 -> 12450). */
export function figuresIn(text: string): string[] {
  return (text.match(/\d[\d,.]*\d/g) || [])
    .map((n) => n.replace(/,/g, '').replace(/\.$/, ''))
    .map((n) => (Number.isFinite(Number(n)) ? String(Number(n)) : n));
}

/** Figures in the reply that came from nowhere: not in any tool result, the conversation or today's date. */
export function unsupportedFigures(reply: string, sources: string[]): string[] {
  const known = new Set(sources.flatMap(figuresIn));
  return figuresIn(reply).filter((n) => !known.has(n));
}

/** Whether the model's text is the off-topic reply (possibly quoted or with extra words). */
const isOffTopicReply = (text: string) => text.replace(/["'“”]/g, '').includes(OFF_TOPIC_REPLY.replace(/["'“”]/g, '').slice(0, 40));

/** Reasoning models may include their thinking; users only see the answer. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** Keeps the last few messages, trimmed, starting with a user message. */
export function trimHistory(messages: ChatMessage[], max = MAX_HISTORY): ChatMessage[] {
  const clean = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-max);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  return clean;
}

export async function runAgent(
  env: AgentEnv,
  agentToken: string,
  history: ChatMessage[],
  opts: { cache?: (key: string, load: () => Promise<string>) => Promise<string>; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<ChatResult> {
  const doFetch = opts.fetchImpl ?? (env.ALHAYAT_API ? env.ALHAYAT_API.fetch.bind(env.ALHAYAT_API) : fetch);
  const api = env.ALHAYAT_API_URL.replace(/\/$/, '');
  const post = async (path: string, body: unknown) => {
    const res = await doFetch(`${api}/agent${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` },
      body: JSON.stringify(body ?? {}),
    });
    if (res.status === 401) throw new AuthError();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: (data as any)?.message || `The management system answered ${res.status}.` };
    return data;
  };

  const limits = limitsOf(env);
  const { today, weekday } = todayInSomaliland(opts.now);
  const conversation = trimHistory(history, limits.history);
  const messages: any[] = [{ role: 'system', content: systemPrompt(today, weekday) }, ...conversation];
  const proposals: Proposal[] = [];
  const toolsUsed: string[] = [];
  const toolResults: string[] = [];
  const seen = new Map<string, string>(); // the same lookup twice in one question runs once
  const aiOptions = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
  let nudged = false;

  for (let round = 0; round < limits.rounds; round++) {
    const finalRound = round === limits.rounds - 1;
    const input = {
      messages,
      ...(finalRound ? {} : { tools: TOOLS }),
      max_tokens: limits.replyTokens,
      temperature: 0.2,
    };
    const out = aiOptions ? await env.AI.run(env.AI_MODEL, input, aiOptions) : await env.AI.run(env.AI_MODEL, input);
    const { text, calls } = readModelOutput(out);

    if (calls.some((c) => c.name === 'decline_off_topic') || (!calls.length && isOffTopicReply(text))) {
      return { reply: OFF_TOPIC_REPLY, proposals, toolsUsed: [...toolsUsed, 'decline_off_topic'] };
    }

    if (!calls.length) {
      if (!text) return { reply: SAY.noAnswer, proposals, toolsUsed };
      // No figures without data: when nothing was looked up for this question,
      // a number that is not in the conversation or today's date was made up.
      // Ask once to look it up. (After a lookup the model may also state totals
      // it calculated from the results, which this check could not tell apart.)
      const invented = toolResults.length ? [] : unsupportedFigures(text, [...conversation.map((m) => m.content), today]);
      if (invented.length) {
        if (!nudged && !finalRound) {
          nudged = true;
          messages.push({ role: 'assistant', content: text });
          messages.push({ role: 'system', content: `Your answer contains figures (${invented.slice(0, 5).join(', ')}) that no tool returned. Never state figures without data: call the right tool now, or say in Somali that you do not have the data.` });
          continue;
        }
        return { reply: SAY.noData, proposals, toolsUsed };
      }
      return { reply: text, proposals, toolsUsed };
    }

    messages.push({
      role: 'assistant',
      content: text || '',
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
    });
    for (const call of calls) {
      toolsUsed.push(call.name);
      let result: string;
      if (READ_TOOLS.has(call.name)) {
        const key = `${call.name}:${JSON.stringify(call.args)}`;
        const load = async () => JSON.stringify(await post(`/tools/${call.name}`, call.args));
        result = seen.get(key) ?? (opts.cache ? await opts.cache(key, load) : await load());
        seen.set(key, result);
      } else if (PROPOSE[call.name]) {
        const data: any = await post('/proposals', { action: PROPOSE[call.name], args: call.args });
        if (data?.proposal) {
          proposals.push(data.proposal);
          result = JSON.stringify({ proposed: data.proposal.summary, note: 'Waiting for the user to press Confirm. Nothing has changed yet.' });
        } else {
          result = JSON.stringify(data);
        }
      } else {
        result = JSON.stringify({ error: `There is no tool called ${call.name}.` });
      }
      result = result.slice(0, MAX_TOOL_RESULT_CHARS);
      toolResults.push(result);
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result });
    }
  }
  return { reply: SAY.tooManySteps, proposals, toolsUsed };
}

export class AuthError extends Error {
  constructor() { super('Session ended. Please sign in again.'); this.name = 'AuthError'; }
}
