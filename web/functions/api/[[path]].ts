// Same-origin API proxy (Cloudflare Pages Function).
//
// The browser calls https://<pages-host>/api/v1/... and this function forwards
// the request to the Railway backend. Because the page and the API share one
// origin, the refresh token can be a first-party, host-only,
// SameSite=Strict, HttpOnly cookie — browsers block third-party cookies
// between *.pages.dev and *.up.railway.app.
//
// API_ORIGIN (Pages environment variable) overrides the default backend.

const DEFAULT_API_ORIGIN = 'https://al-hayat-erp-wms-production.up.railway.app';

export async function onRequest(context: { request: Request; env: { API_ORIGIN?: string } }): Promise<Response> {
  const { request, env } = context;
  const incoming = new URL(request.url);
  if (!incoming.pathname.startsWith('/api/v1/')) {
    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN || DEFAULT_API_ORIGIN);

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
  const upstream = await fetch(target.toString(), {
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
