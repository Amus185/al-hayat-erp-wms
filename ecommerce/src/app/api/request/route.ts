import { submitRequest } from "@/lib/erp";
import { clientIp, isJson, isSameSiteRequest } from "@/lib/request-guard";
import { MAX_CART_LINES, MAX_QUANTITY_PER_ITEM } from "@/lib/types";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Receives the checkout form and forwards it to the ERP together with the
// server-side API key. The ERP re-validates everything and sets the prices;
// nothing the browser sends about prices is used.
export async function POST(request: Request) {
  if (!isSameSiteRequest(request) || !isJson(request)) {
    return Response.json({ message: "Not allowed" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ message: "Invalid request." }, { status: 400 });

  const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_CART_LINES + 1) : [];
  const lines = rawLines.map((l) => {
    const o = (l ?? {}) as { slug?: unknown; quantity?: unknown };
    return { slug: text(o.slug, 100), quantity: Number(o.quantity) };
  });
  if (!lines.length || lines.length > MAX_CART_LINES || lines.some((l) => !l.slug || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_QUANTITY_PER_ITEM)) {
    return Response.json({ message: "Please check the items in your cart." }, { status: 400 });
  }

  const result = await submitRequest(
    {
      name: text(body.name, 100),
      phone: text(body.phone, 30),
      email: text(body.email, 120) || undefined,
      address: text(body.address, 300) || undefined,
      city: text(body.city, 100) || undefined,
      notes: text(body.notes, 500) || undefined,
      website: text(body.website, 50), // honeypot: real visitors leave it empty
      lines,
    },
    clientIp(request),
  );
  if (!result.ok) return Response.json({ message: result.message, ...(result.problems ? { problems: result.problems } : {}) }, { status: result.status });
  return Response.json({ requestNumber: result.requestNumber }, { status: 201 });
}
