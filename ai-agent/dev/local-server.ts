// LOCAL DEVELOPMENT ONLY: runs the Worker in Node on http://127.0.0.1:8788.
//
//   AGENT_TOKEN_SECRET=... ALHAYAT_API_URL=http://localhost:3100/api/v1 \
//     node --import tsx ai-agent/dev/local-server.ts          (from the repository root)
//
// With CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN set (a token with
// "Workers AI: Read"), it calls the real model through Cloudflare's REST API.
// Without them it uses a tiny simulated model that picks tools by keywords,
// so the chat screen and the confirm flow can be tried offline.
import http from 'node:http';
import worker, { type Env } from '../src/index';
import type { AiBinding } from '../src/agent';

const PORT = Number(process.env.AGENT_DEV_PORT || 8788);
const MODEL = process.env.AI_MODEL || '@cf/qwen/qwen3-30b-a3b-fp8';

function restAI(accountId: string, apiToken: string): AiBinding {
  return {
    async run(model, input) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data: any = await res.json();
      if (!res.ok || data.success === false) throw new Error(`Workers AI ${res.status}: ${JSON.stringify(data.errors ?? data).slice(0, 300)}`);
      return data.result;
    },
  };
}

/** Keyword "model": enough to exercise the tools and the confirm step. Not an AI. */
const simulatedAI: AiBinding = {
  async run(_model, input: any) {
    const msgs = input.messages as any[];
    const last = msgs[msgs.length - 1];
    if (last.role === 'tool') {
      const results = msgs.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
      return { response: `(Simulated model, no AI) Here is what the system returned:\n${results}` };
    }
    const q = String(last.content).toLowerCase();
    const call = (name: string, args: Record<string, unknown> = {}) => ({ response: '', tool_calls: [{ name, arguments: args }] });
    const add = q.match(/(?:add|remove)\s+(\d+)\s+(?:units?\s+)?(?:of|to|from)?\s*(.+?)(?:\s+at\s+(.+))?$/);
    if (add) return call('propose_stock_adjustment', { product: add[2].trim(), quantity: (q.startsWith('remove') ? -1 : 1) * Number(add[1]), location: add[3]?.trim(), reason: 'Requested in chat' });
    if (/low|reorder/.test(q)) return call('get_low_stock');
    if (/sale|revenue|sold/.test(q)) return call('get_sales_summary', { period: /today/.test(q) ? 'today' : /month/.test(q) ? 'month' : 'week' });
    if (/order/.test(q)) return call('list_orders', { limit: 5 });
    if (/stock of|how many/.test(q)) return call('get_stock', { product: q.replace(/.*(stock of|how many)\s*/, '').replace(/\?$/, '') });
    return call('search_products', { query: q.replace(/[?.!]/g, '').split(' ').slice(-1)[0] });
  },
};

const secret = process.env.AGENT_TOKEN_SECRET || '';
if (secret.length < 32) {
  console.error('Set AGENT_TOKEN_SECRET (32+ characters, the same value as on the local backend).');
  process.exit(1);
}
const real = process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN;
const env: Env = {
  AI: real ? restAI(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!) : simulatedAI,
  AI_MODEL: MODEL,
  ALHAYAT_API_URL: process.env.ALHAYAT_API_URL || 'http://localhost:3100/api/v1',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'http://localhost:5173',
  AGENT_TOKEN_SECRET: secret,
};

http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') ? undefined : Buffer.concat(chunks),
  });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Assistant (development) on http://127.0.0.1:${PORT}/chat — ${real ? `real model ${MODEL}` : 'SIMULATED model (no Cloudflare credentials set)'}`);
});
