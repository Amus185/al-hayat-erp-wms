// Server-side client for the ERP's public storefront API.
// Only import this from server components and route handlers: it reads
// STOREFRONT_API_KEY, which must never reach the browser.
import type { Category, Product, ProductPage } from "./types";

const API = (process.env.ERP_API_URL || "http://localhost:3000/api/v1").replace(/\/$/, "");
const REVALIDATE_SECONDS = 60;

class ErpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ErpError";
  }
}

async function get<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${API}/storefront${path}`, {
      headers: { Accept: "application/json" },
      // Short cache: prices and availability stay fresh without hitting the ERP on every view.
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ErpError(503, "The shop is temporarily unavailable.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ErpError(res.status, "The shop is temporarily unavailable.");
  return (await res.json()) as T;
}

export interface ListOptions {
  q?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  sort?: "name" | "new";
  featured?: boolean;
  sale?: boolean;
}

export async function listProducts(opts: ListOptions = {}): Promise<ProductPage> {
  const params = new URLSearchParams();
  if (opts.sort === "new") params.set("sort", "new");
  if (opts.featured) params.set("featured", "1");
  if (opts.sale) params.set("sale", "1");
  if (opts.q) params.set("q", opts.q);
  if (opts.category) params.set("category", opts.category);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  return (await get<ProductPage>(`/products${qs ? `?${qs}` : ""}`)) ?? { items: [], page: 1, pageSize: opts.pageSize ?? 24, total: 0 };
}

export async function getProduct(slug: string): Promise<Product | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  return get<Product>(`/products/${slug}`);
}

export async function listCategories(): Promise<Category[]> {
  return (await get<Category[]>("/categories")) ?? [];
}

export interface RequestPayload {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  notes?: string;
  website?: string; // honeypot
  lines: { slug: string; quantity: number }[];
}

export type RequestResult =
  | { ok: true; requestNumber: string }
  | { ok: false; status: number; message: string };

/** Send an order request to the ERP. The ERP re-checks everything and sets the prices. */
export async function submitRequest(payload: RequestPayload, clientIp: string): Promise<RequestResult> {
  const key = process.env.STOREFRONT_API_KEY;
  if (!key) return { ok: false, status: 503, message: "Online requests are not available yet. Please call us." };
  let res: Response;
  try {
    res = await fetch(`${API}/storefront/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-storefront-key": key, "x-client-ip": clientIp },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { ok: false, status: 503, message: "We could not reach the shop. Please try again in a moment." };
  }
  const body = (await res.json().catch(() => null)) as { requestNumber?: string; message?: string } | null;
  if (res.status === 201 && body?.requestNumber) return { ok: true, requestNumber: body.requestNumber };
  // Pass through the ERP's customer-safe messages for expected problems; hide anything else.
  const expected = [400, 409, 429, 503].includes(res.status);
  return {
    ok: false,
    status: expected ? res.status : 502,
    message: expected && body?.message ? body.message : "Something went wrong. Please try again or call us.",
  };
}
