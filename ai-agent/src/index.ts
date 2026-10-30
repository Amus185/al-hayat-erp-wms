// Cloudflare Worker: POST /chat for the Alhayat assistant.
//
// The browser sends { messages } with a short-lived agent token that the
// Alhayat backend issued for this message (POST /api/v1/agent/session). The
// Worker checks it, runs the model with tools, and returns { reply, proposals }.
// It holds no API keys the browser could see, and no database access.
import { AuthError, runAgent, type AgentEnv, type ChatMessage } from './agent';
import { SAY } from './somali';

export interface Env extends AgentEnv {
  /** Same value as AGENT_TOKEN_SECRET on the backend (wrangler secret put AGENT_TOKEN_SECRET). */
  AGENT_TOKEN_SECRET: string;
  /** Comma-separated staff app origins, e.g. https://erp.example.com */
  ALLOWED_ORIGINS: string;
}

const CACHE_SECONDS = 30;

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

/** Verifies an HS256 agent token; returns its claims or null. */
export async function verifyAgentToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ sub: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || !secret || secret.length < 32) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    if (header.alg !== 'HS256') return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
    if (claims.typ !== 'agent' || typeof claims.sub !== 'string' || typeof claims.exp !== 'number' || claims.exp <= nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Short-lived cache of read-only lookups, per user (Cache API; skipped where unavailable). */
function lookupCache(userId: string) {
  return async (key: string, load: () => Promise<string>): Promise<string> => {
    const cache = typeof caches !== 'undefined' ? (caches as any).default as Cache : null;
    if (!cache) return load();
    const url = `https://agent-cache.internal/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`;
    const hit = await cache.match(url);
    if (hit) return hit.text();
    const value = await load();
    if (!value.includes('"error"')) {
      await cache.put(url, new Response(value, { headers: { 'Cache-Control': `max-age=${CACHE_SECONDS}` } }));
    }
    return value;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(env, origin);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    if (url.pathname !== '/chat' || request.method !== 'POST') return json({ message: 'Not found' }, 404);
    // Browsers from other sites are refused (servers without an Origin may still call, with a valid token).
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ message: 'Origin not allowed' }, 403);

    const token = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const claims = await verifyAgentToken(token, env.AGENT_TOKEN_SECRET);
    if (!claims) return json({ message: SAY.signIn }, 401);

    const body = (await request.json().catch(() => null)) as { messages?: ChatMessage[] } | null;
    if (!body || !Array.isArray(body.messages) || !body.messages.length) return json({ message: SAY.badRequest }, 400);

    try {
      const result = await runAgent(env, token, body.messages, { cache: lookupCache(claims.sub) });
      return json(result);
    } catch (err) {
      if (err instanceof AuthError) return json({ message: SAY.signIn }, 401);
      console.error('assistant failed', err instanceof Error ? err.message : err);
      return json({ message: SAY.unavailable }, 502);
    }
  },
};
