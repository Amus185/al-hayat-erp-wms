import { getProduct } from "@/lib/erp";
import { isJson, isSameSiteRequest } from "@/lib/request-guard";
import { MAX_CART_LINES, type CartLine } from "@/lib/types";

// Fresh name, price, photo and availability for the products in a cart.
export async function POST(request: Request) {
  if (!isSameSiteRequest(request) || !isJson(request)) {
    return Response.json({ message: "Not allowed" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { slugs?: unknown } | null;
  const slugs = Array.isArray(body?.slugs)
    ? Array.from(new Set(body.slugs.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 100))).slice(0, MAX_CART_LINES)
    : [];
  if (!slugs.length) return Response.json({ products: [], missing: [] });

  const settled = await Promise.allSettled(slugs.map((s) => getProduct(s)));
  if (settled.some((r) => r.status === "rejected")) {
    return Response.json({ message: "The shop is temporarily unavailable." }, { status: 503 });
  }

  const products: Omit<CartLine, "quantity">[] = [];
  const missing: string[] = [];
  settled.forEach((r, i) => {
    const p = r.status === "fulfilled" ? r.value : null;
    if (!p) { missing.push(slugs[i]); return; }
    products.push({ slug: p.slug, name: p.name, price: p.price, image: p.images[0] ?? null, availability: p.availability });
  });
  return Response.json({ products, missing }, { headers: { "Cache-Control": "no-store" } });
}
