// Helpers for the shop's own API routes (/api/cart, /api/request, /api/track).

/**
 * True only when the request was sent by a page of this site. Browsers always
 * send Sec-Fetch-Site and/or Origin on a POST made with fetch(), and a page on
 * another site cannot forge them. JSON-only bodies add a second barrier,
 * because a cross-site <form> cannot send application/json.
 */
export function isSameSiteRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return site === "same-origin";
}

export function isJson(request: Request): boolean {
  return (request.headers.get("content-type") || "").toLowerCase().startsWith("application/json");
}

/**
 * The visitor's address as seen by the hosting proxy. Prefer X-Real-IP; with
 * X-Forwarded-For take the LAST entry (the one our own proxy appended), since
 * earlier entries can be written by the client.
 */
export function clientIp(request: Request): string {
  // On Cloudflare Workers the visitor's address is set by Cloudflare itself.
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim().slice(0, 64);
  return "unknown";
}
