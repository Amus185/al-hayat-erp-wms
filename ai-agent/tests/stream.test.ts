// Streaming answers: reading both Workers AI stream shapes, progress events,
// fallback when streaming fails, and the /chat event stream end to end.
//   node --import tsx --test ai-agent/tests/*.test.ts   (from the repository root)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readModelStream } from '../src/stream';
import { runAgent, type AgentEvent, type AgentEnv } from '../src/agent';
import worker, { type Env } from '../src/index';

/** A model stream as Workers AI sends it, split at awkward places. */
function sse(chunks: unknown[], splitEvery = 7): ReadableStream<Uint8Array> {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + splitEvery));
      i += splitEvery;
    },
  });
}

test('older Workers AI shape: text pieces in order, <think> hidden even across pieces', async () => {
  const pieces: string[] = [];
  const out = await readModelStream(sse([{ response: '<thi' }, { response: 'nk>secret plan</th' }, { response: 'ink>Iibka ' }, { response: 'maanta: **$600**.' }]), (p) => pieces.push(p));
  assert.equal(out.text, 'Iibka maanta: **$600**.');
  assert.equal(pieces.join(''), 'Iibka maanta: **$600**.');
  assert.ok(!pieces.join('').includes('secret'));
  assert.deepEqual(out.calls, []);
});

test('OpenAI-style shape: text deltas, and tool calls assembled from pieces', async () => {
  const out = await readModelStream(sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_', arguments: '{"sou' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'data', arguments: 'rce":"income_statement"}' } }] } }] },
  ]), () => {});
  assert.deepEqual(out.calls, [{ id: 'c1', name: 'get_data', args: { source: 'income_statement' } }]);
  const text = await readModelStream(sse([{ choices: [{ delta: { content: 'Haa, ' } }] }, { choices: [{ delta: { content: 'waa la helay.' } }] }]), () => {});
  assert.equal(text.text, 'Haa, waa la helay.');
});

test('older shape tool calls, and a "<" at the very end is not lost', async () => {
  const out = await readModelStream(sse([{ response: '', tool_calls: [{ name: 'get_low_stock', arguments: {} }] }]), () => {});
  assert.deepEqual(out.calls.map((c) => c.name), ['get_low_stock']);
  const tail = await readModelStream(sse([{ response: 'a < b and 3 <' }], 3), () => {});
  assert.equal(tail.text, 'a < b and 3 <');
});

// A model that streams when asked: each output is a list of stream chunks.
function streamingAI(outputs: unknown[][], opts: { failStream?: boolean } = {}) {
  const calls: any[] = [];
  const AI = {
    run: async (_model: string, input: any) => {
      calls.push(structuredClone({ ...input, messages: undefined }));
      if (input.stream && opts.failStream) throw new Error('streaming not supported');
      const next = outputs.shift() ?? [{ response: '' }];
      if (input.stream) return sse(next);
      // non-streamed: the same content as one answer
      const text = next.map((c: any) => c.response ?? '').join('');
      const tool_calls = next.flatMap((c: any) => c.tool_calls ?? []);
      return { response: text, tool_calls };
    },
  };
  return { AI, calls };
}
const backend = (async () => new Response(JSON.stringify({ total_sales: 600 }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
const env = (AI: any): AgentEnv => ({ AI, AI_MODEL: '@cf/test/model', ALHAYAT_API_URL: 'https://erp.example.com/api/v1' });

test('events: thinking -> looking up (with the source) -> thinking -> the answer as it is written', async () => {
  const { AI, calls } = streamingAI([
    [{ response: '', tool_calls: [{ name: 'get_data', arguments: { source: 'sales_summary' } }] }],
    [{ response: 'Iibka ' }, { response: 'waa ' }, { response: '**$600**.' }],
  ]);
  const events: AgentEvent[] = [];
  const result = await runAgent(env(AI), 'tok', [{ role: 'user', content: 'iibka?' }], { fetchImpl: backend, onEvent: (e) => events.push(e) });
  assert.equal(result.reply, 'Iibka waa **$600**.');
  assert.deepEqual(events.map((e) => e.type === 'status' ? `${e.step}${'source' in e && e.source ? `:${e.source}` : ''}` : e.type === 'delta' ? `+${e.text}` : e.type),
    ['thinking', 'lookup:sales_summary', 'thinking', '+Iibka ', '+waa ', '+**$600**.']);
  assert.ok(calls.every((c) => c.stream === true), 'model calls were not streamed');
});

test('text shown before a lookup is withdrawn (reset), and the final answer is the authority', async () => {
  const { AI } = streamingAI([
    [{ response: 'Aan eego...' }, { response: '', tool_calls: [{ name: 'get_data', arguments: { source: 'sales_summary' } }] }],
    [{ response: 'Waa **$600**.' }],
  ]);
  const events: AgentEvent[] = [];
  const result = await runAgent(env(AI), 'tok', [{ role: 'user', content: 'iibka?' }], { fetchImpl: backend, onEvent: (e) => events.push(e) });
  const types = events.map((e) => e.type);
  assert.ok(types.indexOf('reset') > types.indexOf('delta'), 'early text not withdrawn');
  assert.equal(result.reply, 'Waa **$600**.');
});

test('when streaming fails, the answer still arrives (normal call), shown in one piece', async () => {
  const { AI } = streamingAI([[{ response: 'Salaan! Maxaan kaa caawiyaa?' }]], { failStream: true });
  const events: AgentEvent[] = [];
  const result = await runAgent(env(AI), 'tok', [{ role: 'user', content: 'asc' }], { fetchImpl: backend, onEvent: (e) => events.push(e) });
  assert.equal(result.reply, 'Salaan! Maxaan kaa caawiyaa?');
  assert.deepEqual(events.filter((e) => e.type === 'delta').map((e: any) => e.text), ['Salaan! Maxaan kaa caawiyaa?']);
});

// /chat end to end
const SECRET = 'worker-test-secret-0123456789abcdefghij';
const ORIGIN = 'https://staff.example.com';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token() {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ typ: 'agent', sub: 'user-1', sid: 's', exp: Math.floor(Date.now() / 1000) + 300 });
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
}
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('/chat with Accept: text/event-stream sends progress, text and a final "done"', async () => {
  globalThis.fetch = backend;
  const { AI } = streamingAI([
    [{ response: '', tool_calls: [{ name: 'get_data', arguments: { source: 'sales_summary' } }] }],
    [{ response: 'Iibka ' }, { response: 'waa **$600**.' }],
  ]);
  const e: Env = { AI, AI_MODEL: '@cf/test/model', ALHAYAT_API_URL: 'https://erp.example.com/api/v1', AGENT_TOKEN_SECRET: SECRET, ALLOWED_ORIGINS: ORIGIN };
  const res = await worker.fetch(new Request('https://agent.example.com/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token()}`, Origin: ORIGIN },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'iibka?' }] }),
  }), e);
  assert.match(res.headers.get('Content-Type') || '', /text\/event-stream/);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const raw = await res.text();
  const events = raw.trim().split('\n\n').map((block) => ({
    event: block.match(/^event: (.*)$/m)?.[1],
    data: JSON.parse(block.match(/^data: (.*)$/m)?.[1] ?? 'null'),
  }));
  assert.deepEqual(events.map((x) => x.event), ['status', 'status', 'status', 'delta', 'delta', 'done']);
  assert.equal(events.at(-1)!.data.reply, 'Iibka waa **$600**.');
});

test('/chat stream reports failures as an "error" event without leaking details', async () => {
  const broken = { run: async () => { throw new Error('upstream secret detail'); } };
  const e: Env = { AI: broken, AI_MODEL: 'm', ALHAYAT_API_URL: 'https://erp.example.com/api/v1', AGENT_TOKEN_SECRET: SECRET, ALLOWED_ORIGINS: ORIGIN };
  const res = await worker.fetch(new Request('https://agent.example.com/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token()}`, Origin: ORIGIN },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'x' }] }),
  }), e);
  const raw = await res.text();
  assert.match(raw, /event: error/);
  assert.ok(!raw.includes('secret detail'));
});
