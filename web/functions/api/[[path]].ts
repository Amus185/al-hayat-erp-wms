// Same-origin API proxy (Cloudflare Pages Function).
//
// The browser calls https://<pages-host>/api/v1/... (ERP) and /api/auth/...
// (Better Auth sign-in) and this function forwards the request to the backend
// Worker. Because the page and the API share one origin, the session can be a
// first-party, SameSite=Strict, HttpOnly cookie — browsers block third-party
// cookies between *.pages.dev and *.workers.dev.
//
// The backend is reached through the API service binding (Pages project →
// Settings → Bindings → Service binding "API" → Worker al-hayat-api) or, if
// there is none, at API_ORIGIN (Pages environment variable).

type Env = { API?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> }; API_ORIGIN?: string };

export async function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  const { request, env } = context;
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/v1/') && !incoming.pathname.startsWith('/api/auth/')) {
    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (!env.API && !env.API_ORIGIN) {
    return new Response(JSON.stringify({ message: 'Service misconfigured. Contact the administrator.' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN || 'https://al-hayat-api.internal');

  const headers = new Headers(request.headers);
  headers.delete('host');
  // The client's address as seen by Cloudflare; overwrite anything the client sent.
  const ip = request.headers.get('cf-connecting-ip');
  headers.delete('x-forwarded-for');
  headers.delete('x-real-ip');
  if (ip) {
    headers.set('x-forwarded-for', ip);
    headers.set('x-real-ip', ip);
  }

  const method = request.method.toUpperCase();
  const upstream = await (env.API ? env.API.fetch.bind(env.API) : fetch)(target.toString(), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });

  // Pass status, body and headers (including Set-Cookie) straight through.
  const response = new Response(upstream.body, upstream);
  response.headers.set('Cache-Control', upstream.headers.get('Cache-Control') || 'no-store');
  return response;
}
