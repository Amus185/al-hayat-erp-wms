// The assistant's loop: ask the model, run the tools it asks for through the
// Alhayat backend, and repeat until it answers. No database access here: every
// lookup is an HTTP call to /api/v1/agent with the user's short-lived agent
// token, and changes can only be proposed (the user confirms them in the app).

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
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

// Cost limits.
export const MAX_HISTORY = 8;          // messages sent to the model
export const MAX_MESSAGE_CHARS = 2000; // per message
export const MAX_REPLY_TOKENS = 600;
export const MAX_ROUNDS = 4;           // model calls per question
const MAX_TOOL_RESULT_CHARS = 4000;

const SYSTEM_PROMPT = [
  'You are the assistant of Al Hayat Furniture staff, inside their management system.',
  'Use the tools for every fact about products, stock, sales and orders. Never guess numbers.',
  'You cannot change data. For stock or price changes call a propose_ tool: the user then sees a Confirm button. Never say a change was made.',
  'If a tool returns "error", explain it simply. If several products match, ask which one.',
  'Be brief. Reply in the language of the user\'s last message.',
].join(' ');

type JsonSchema = Record<string, unknown>;
const fn = (name: string, description: string, properties: JsonSchema = {}, required: string[] = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});
const str = (description: string) => ({ type: 'string', description });

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

const READ_TOOLS = new Set(['search_products', 'get_stock', 'get_low_stock', 'get_sales_summary', 'list_orders']);
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

/** Reasoning models may include their thinking; users only see the answer. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

/** Keeps the last few messages, trimmed, starting with a user message. */
export function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  const clean = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }))
    .slice(-MAX_HISTORY);
  while (clean.length && clean[0].role !== 'user') clean.shift();
  return clean;
}

export async function runAgent(
  env: AgentEnv,
  agentToken: string,
  history: ChatMessage[],
  opts: { cache?: (key: string, load: () => Promise<string>) => Promise<string>; fetchImpl?: typeof fetch } = {},
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

  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...trimHistory(history)];
  const proposals: Proposal[] = [];
  const toolsUsed: string[] = [];
  const seen = new Map<string, string>(); // the same lookup twice in one question runs once

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const finalRound = round === MAX_ROUNDS - 1;
    const out = await env.AI.run(env.AI_MODEL, {
      messages,
      ...(finalRound ? {} : { tools: TOOLS }),
      max_tokens: MAX_REPLY_TOKENS,
      temperature: 0.2,
    });
    const { text, calls } = readModelOutput(out);
    if (!calls.length) return { reply: text || 'Sorry, I could not answer that.', proposals, toolsUsed };

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
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: result.slice(0, MAX_TOOL_RESULT_CHARS) });
    }
  }
  return { reply: 'Sorry, that took too many steps. Please ask a more specific question.', proposals, toolsUsed };
}

export class AuthError extends Error {
  constructor() { super('Session ended. Please sign in again.'); this.name = 'AuthError'; }
}
