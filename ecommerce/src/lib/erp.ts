// Server-side client for the ERP's public storefront API.
// Only import this from server components and route handlers: it reads
// STOREFRONT_API_KEY, which must never reach the browser.
import { isAllowedImageUrl } from "./image-hosts";
import type { Category, Product, ProductImage, ProductPage } from "./types";

const isDev = process.env.NODE_ENV === "development";
// In development the backend runs on port 3100 (docs/LOCAL_TESTING.md). In
// production ERP_API_URL must be set; a missing value is reported, not guessed.
const API = (process.env.ERP_API_URL || (isDev ? "http://localhost:3100/api/v1" : "")).replace(/\/$/, "");
const REVALIDATE_SECONDS = 60;

export class ErpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** What actually went wrong, for logs and the development-only hint. Never shown to customers in production. */
    public detail: string,
  ) {
    super(message);
    this.name = "ErpError";
  }
}

const UNAVAILABLE = "The shop is temporarily unavailable.";
const TIMEOUT_MS = 5000;

// Circuit breaker: once the ERP cannot be reached, skip it for a short while
// instead of making every page (header, footer, content) wait for a timeout.
// Short in development, so "Try again" works soon after starting the backend.
const BREAK_MS = isDev ? 2_000 : 10_000;
let erpDownUntil = 0;
let erpDownReason = "";

// Log each distinct failure at most once a minute so a down ERP does not flood the logs.
const lastLogged = new Map<string, number>();
function logFailure(detail: string) {
  const now = Date.now();
  if ((lastLogged.get(detail) ?? 0) > now - 60_000) return;
  lastLogged.set(detail, now);
  console.error(`[storefront] ERP request failed: ${detail}`);
}

function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError") return `timed out after ${TIMEOUT_MS / 1000} s`;
  return e?.cause?.code || e?.cause?.message || e?.message || String(err);
}

async function get<T>(path: string): Promise<T | null> {
  if (!API) {
    const detail = "ERP_API_URL is not set. Set it to the ERP's /api/v1 address (see ecommerce/README.md).";
    logFailure(detail);
    throw new ErpError(503, UNAVAILABLE, detail);
  }
  const url = `${API}/storefront${path}`;
  if (Date.now() < erpDownUntil) {
    throw new ErpError(503, UNAVAILABLE, `${erpDownReason} (not retried for ${BREAK_MS / 1000} s)`);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Short cache: prices and availability stay fresh without hitting the ERP on every view.
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    erpDownUntil = Date.now() + BREAK_MS;
    const why = describe(err);
    const hint = why === "ECONNREFUSED" ? " Is the ERP backend running, and is ERP_API_URL right?" : "";
    const detail = `GET ${url} failed: ${why}.${hint}`;
    erpDownReason = detail;
    logFailure(detail);
    throw new ErpError(503, UNAVAILABLE, detail);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    const detail = `GET ${url} returned HTTP ${res.status}${body ? `: ${body}` : ""}`;
    logFailure(detail);
    throw new ErpError(res.status, UNAVAILABLE, detail);
  }
  return (await res.json()) as T;
}

// next/image throws on a photo host it is not configured for, which would fail the
// whole page. Such photos are dropped (the page shows "photo coming soon") and logged.
function allowedImages(images: ProductImage[]): ProductImage[] {
  return images.filter((img) => {
    if (isAllowedImageUrl(img.url)) return true;
    let host = img.url;
    try { host = new URL(img.url).host; } catch { /* keep the raw value */ }
    logFailure(`photo host "${host}" is not allowed by the image settings; set IMAGE_HOSTNAME to the photo bucket's host (or ALLOW_LOCAL_IMAGES=1 in development) and restart.`);
    return false;
  });
}

function withAllowedImages(p: Product): Product {
  return { ...p, images: allowedImages(p.images) };
}

/** The real cause of a catalog failure, but only in development (never shown to customers). */
export function devErrorDetail(err: unknown): string | null {
  return isDev && err instanceof ErpError ? err.detail : null;
}

export interface ListOptions {
  q?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  sort?: SortKey;
  featured?: boolean;
  sale?: boolean;
  minPrice?: number | null;
  maxPrice?: number | null;
}

export const SORT_KEYS = ["name", "new", "price_asc", "price_desc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export async function listProducts(opts: ListOptions = {}): Promise<ProductPage> {
  const params = new URLSearchParams();
  if (opts.sort && opts.sort !== "name") params.set("sort", opts.sort);
  if (opts.featured) params.set("featured", "1");
  if (opts.sale) params.set("sale", "1");
  if (opts.minPrice != null) params.set("minPrice", String(opts.minPrice));
  if (opts.maxPrice != null) params.set("maxPrice", String(opts.maxPrice));
  if (opts.q) params.set("q", opts.q);
  if (opts.category) params.set("category", opts.category);
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  const qs = params.toString();
  const page = await get<ProductPage>(`/products${qs ? `?${qs}` : ""}`);
  if (!page) return { items: [], page: 1, pageSize: opts.pageSize ?? 24, total: 0 };
  return { ...page, items: page.items.map(withAllowedImages) };
}

export async function getProduct(slug: string): Promise<Product | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return null;
  const product = await get<Product>(`/products/${slug}`);
  return product && withAllowedImages(product);
}

export async function listCategories(): Promise<Category[]> {
  const categories = (await get<Category[]>("/categories")) ?? [];
  return categories.map((c) => ({ ...c, image: c.image && allowedImages([c.image])[0] ? c.image : null }));
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
  if (!key) {
    logFailure("STOREFRONT_API_KEY is not set, so order requests cannot be sent. It must equal STOREFRONT_API_KEY on the ERP.");
    return { ok: false, status: 503, message: "Online requests are not available yet. Please call us." };
  }
  if (!API) {
    logFailure("ERP_API_URL is not set, so order requests cannot be sent.");
    return { ok: false, status: 503, message: "We could not reach the shop. Please try again in a moment." };
  }
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
  if (!expected) {
    const why = res.status === 401 ? " (STOREFRONT_API_KEY does not match the ERP's)" : "";
    logFailure(`POST ${API}/storefront/requests returned HTTP ${res.status}${why}`);
  }
  return {
    ok: false,
    status: expected ? res.status : 502,
    message: expected && body?.message ? body.message : "Something went wrong. Please try again or call us.",
  };
}
