import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 "proxy" (the successor of middleware). Adds a per-request nonce
// Content-Security-Policy: only scripts Next.js itself emits for this response
// may run, so injected script cannot execute. Pages are rendered per request
// (see the root layout) because a nonce cannot exist at build time.
//
// Do not add loading.tsx files: in Next 16.2 the scripts for a loading boundary
// are rendered without the nonce (next/dist/server/app-render/
// create-component-styles-and-scripts.js), so the browser blocks them.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // <style> elements need the nonce; inline style="" attributes (used by next/image) are allowed on their own.
    // In development only, Next's error overlay injects un-nonced <style> tags into its shadow DOM, so dev
    // allows inline styles (a nonce in the list would make browsers ignore 'unsafe-inline'). Production stays strict.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    // Photos are served through /_next/image on this same origin.
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
