// The assistant's loop: ask the model, run the tools it asks for through the
// Alhayat backend, and repeat until it answers. No database access here: every
// lookup is an HTTP call to /api/v1/agent with the user's short-lived agent
// token, and changes can only be proposed (the user confirms them in the app).
// It answers in Somali (somali.ts), only about Al-Hayat, and only with figures
// the system returned.
import { DATA_SOURCES } from '../../backend/src/services/agent-data';
import { OFF_TOPIC_REPLY, SAY, systemPrompt, todayInSomaliland } from './somali';
import { readModelStream } from './stream';

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

/**
 * Progress while answering, for streaming to the chat page:
 * status (what it is doing), delta (answer text as it is written), reset
 * (discard text shown so far: the model went on to look something up, or the
 * answer was replaced). The final ChatResult is always the authoritative answer.
 */
export type AgentEvent =
  | { type: 'status'; step: 'thinking' }
  | { type: 'status'; step: 'lookup'; tool: string; source?: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' };

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
  .map(([name, s]) => `${name}${s.path.includes(':id') ? '(id)' : ''}: ${s.about}${s.query.length ? ` [${s.query.join(',')}]` : ''}`)
  .join('\n');

/** What the model may call. Read tools map 1:1 to /agent/tools/<name>. Kept short: sent with every model call. */
export const TOOLS = [
  fn('search_products', 'Find products by name, SKU or category: price, category, on website, units on hand.', { query: str('search words; empty for all') }),
  fn('get_stock', 'Stock of one product per branch and warehouse.', { product: str('product name or SKU') }, ['product']),
  fn('get_low_stock', 'Products at or below reorder level.'),
  fn('get_sales_summary', 'Sales totals and top products for a period.', {
    period: { type: 'string', enum: ['today', 'week', 'month', 'year'] },
  }),
  fn('list_orders', 'Recent sales orders and new website requests.', {
    status: str('optional: DRAFT, CONFIRMED, INVOICED, PAID, DELIVERED, CANCELLED'),
    limit: { type: 'integer', description: '1-10' },
  }),
  fn('get_data', `Read any part of the ERP as the signed-in user (same permissions as their screens). source: one of (id) = needs a record id, [filters]:\n${SOURCE_LIST}`, {
    source: str('a source name from the list'),
    id: str('record id, for (id) sources'),
    filters: { type: 'object', description: 'filters from the list, dates YYYY-MM-DD' },
  }, ['source']),
  fn('decline_off_topic', 'The question is not about Al-Hayat or its ERP.'),
  fn('propose_stock_adjustment', 'Propose adding (+) or removing (-) stock; the user confirms.', {
    product: str('product name or SKU'),
    quantity: { type: 'integer', description: '+ add, - remove' },
    location: str('branch name, if given'),
    reason: str('short reason'),
  }, ['product', 'quantity']),
  fn('propose_price_change', 'Propose a new selling price; the user confirms.', {
    product: str('product name or SKU'),
    price: { type: 'number', description: 'new selling price' },
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
  opts: {
    cache?: (key: string, load: () => Promise<string>) => Promise<string>;
    fetchImpl?: typeof fetch;
    now?: Date;
    /** Receive progress and the answer as it is written (streams the model's output). */
    onEvent?: (event: AgentEvent) => void;
  } = {},
): Promise<ChatResult> {
  const emit = opts.onEvent ?? (() => {});
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

  /**
   * One model call. Without a listener: the whole answer at once. With one:
   * streamed, passing text on as it is written; if streaming fails or the
   * model does not stream, the whole answer is fetched and passed on at once.
   */
  const callModel = async (input: Record<string, unknown>, onText: (piece: string) => void) => {
    const run = (body: Record<string, unknown>) => (aiOptions ? env.AI.run(env.AI_MODEL, body, aiOptions) : env.AI.run(env.AI_MODEL, body));
    if (opts.onEvent) {
      let sent = false;
      try {
        const out = await run({ ...input, stream: true });
        if (out && typeof (out as any).getReader === 'function') {
          return await readModelStream(out as ReadableStream<Uint8Array>, (piece) => { sent = true; onText(piece); });
        }
        const whole = readModelOutput(out);
        if (whole.text && !whole.calls.length) onText(whole.text);
        return whole;
      } catch (err) {
        if (err instanceof AuthError) throw err;
        if (sent) emit({ type: 'reset' }); // fall back to a normal call below, from a clean slate
      }
    }
    const whole = readModelOutput(await run(input));
    if (opts.onEvent && whole.text && !whole.calls.length) onText(whole.text);
    return whole;
  };

  for (let round = 0; round < limits.rounds; round++) {
    const finalRound = round === limits.rounds - 1;
    const input = {
      messages,
      ...(finalRound ? {} : { tools: TOOLS }),
      max_tokens: limits.replyTokens,
      temperature: 0.2,
    };
    emit({ type: 'status', step: 'thinking' });
    let shown = false; // answer text already sent to the page in this round
    const { text, calls } = await callModel(input, (piece) => { shown = true; emit({ type: 'delta', text: piece }); });
    if (shown && calls.length) emit({ type: 'reset' });

    if (calls.some((c) => c.name === 'decline_off_topic') || (!calls.length && isOffTopicReply(text))) {
      if (shown) emit({ type: 'reset' });
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
        if (shown) emit({ type: 'reset' });
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
      emit({ type: 'status', step: 'lookup', tool: call.name, ...(call.name === 'get_data' && typeof call.args.source === 'string' ? { source: call.args.source } : {}) });
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
