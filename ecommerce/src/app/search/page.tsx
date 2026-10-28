import type { Metadata } from "next";
import Link from "next/link";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { CloseIcon, FilterIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { ProductGrid, toCardItem } from "@/components/product-card";
import { SortSelect } from "@/components/sort-select";
import { devErrorDetail, listCategories, listProducts, SORT_KEYS, type SortKey } from "@/lib/erp";
import { CURRENCY } from "@/lib/site";
import type { Category, ProductPage } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface Filters {
  q: string;
  category: string;
  page: number;
  sort: SortKey;
  sale: boolean;
  featured: boolean;
  min: number | null;
  max: number | null;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const price = (v: string) => {
  const n = Number(v);
  return v !== "" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

function href(f: Partial<Filters>) {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.category) sp.set("category", f.category);
  if (f.sort && f.sort !== "name") sp.set("sort", f.sort);
  if (f.sale) sp.set("sale", "1");
  if (f.featured) sp.set("featured", "1");
  if (f.min != null) sp.set("min", String(f.min));
  if (f.max != null) sp.set("max", String(f.max));
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return `/search${qs ? `?${qs}` : ""}`;
}

async function read(searchParams: SearchParams): Promise<Filters> {
  const sp = await searchParams;
  const sort = one(sp.sort);
  let min = price(one(sp.min));
  let max = price(one(sp.max));
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return {
    q: one(sp.q).trim().slice(0, 80),
    category: one(sp.category).slice(0, 64),
    page: Math.max(1, Math.floor(Number(one(sp.page))) || 1),
    sort: (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : "name",
    sale: one(sp.sale) === "1",
    featured: one(sp.featured) === "1",
    min,
    max,
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const f = await read(searchParams);
  return { title: f.q ? `Search: ${f.q}` : f.sale ? "On sale" : f.featured ? "Featured" : "Shop furniture" };
}

/** Page numbers to show: first, last, and two either side of the current page. */
function pageList(current: number, pages: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - current) <= 1) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const f = await read(searchParams);
  let result: ProductPage = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0 };
  let categories: Category[] = [];
  let failure: unknown = null;
  try {
    [result, categories] = await Promise.all([
      listProducts({ q: f.q, category: f.category, page: f.page, pageSize: PAGE_SIZE, sort: f.sort, sale: f.sale, featured: f.featured, minPrice: f.min, maxPrice: f.max }),
      listCategories(),
    ]);
  } catch (err) {
    failure = err;
  }
  const unavailable = failure !== null;
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const current = categories.find((c) => c.id === f.category);
  const title = f.q ? `Results for “${f.q}”` : current?.name ?? (f.sale ? "On sale" : f.featured ? "Featured" : "All furniture");

  // Active filters, each with a link that removes just that one.
  const chips = [
    f.q && { label: `“${f.q}”`, href: href({ ...f, q: "", page: 1 }) },
    current && { label: current.name, href: href({ ...f, category: "", page: 1 }) },
    f.sale && { label: "On sale", href: href({ ...f, sale: false, page: 1 }) },
    f.featured && { label: "Featured", href: href({ ...f, featured: false, page: 1 }) },
    (f.min != null || f.max != null) && {
      label: `${f.min ?? 0}–${f.max ?? "any"} ${CURRENCY}`,
      href: href({ ...f, min: null, max: null, page: 1 }),
    },
  ].filter(Boolean) as { label: string; href: string }[];

  const renderFilters = (p: string) => (
    <div className="space-y-8">
      <section aria-labelledby={`${p}-cat-filter`}>
        <h2 id={`${p}-cat-filter`} className="mb-3 font-sans text-xs font-semibold uppercase tracking-widest text-muted">Categories</h2>
        <ul className="space-y-0.5 text-sm">
          <li>
            <Link href={href({ ...f, category: "", page: 1 })} aria-current={!f.category ? "page" : undefined} className={`flex justify-between rounded-md px-3 py-2 ${!f.category ? "bg-brand-light font-semibold text-brand-darker" : "hover:bg-canvas"}`}>
              All furniture
            </Link>
          </li>
          {categories.filter((c) => c.productCount > 0 || c.id === f.category).map((c) => (
            <li key={c.id}>
              <Link href={href({ ...f, category: c.id, page: 1 })} aria-current={f.category === c.id ? "page" : undefined} className={`flex justify-between gap-2 rounded-md px-3 py-2 ${c.parentId ? "pl-6" : ""} ${f.category === c.id ? "bg-brand-light font-semibold text-brand-darker" : "hover:bg-canvas"}`}>
                <span>{c.name}</span><span className="text-muted">{c.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${p}-price-filter`}>
        <h2 id={`${p}-price-filter`} className="mb-3 font-sans text-xs font-semibold uppercase tracking-widest text-muted">Price ({CURRENCY})</h2>
        <form action="/search" className="space-y-3">
          {f.q && <input type="hidden" name="q" value={f.q} />}
          {f.category && <input type="hidden" name="category" value={f.category} />}
          {f.sort !== "name" && <input type="hidden" name="sort" value={f.sort} />}
          {f.sale && <input type="hidden" name="sale" value="1" />}
          {f.featured && <input type="hidden" name="featured" value="1" />}
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`${p}-min-price`}>Lowest price</label>
            <input id={`${p}-min-price`} name="min" type="number" min={0} step={1} inputMode="numeric" defaultValue={f.min ?? ""} placeholder="Min" className="h-10 w-full min-w-0 rounded-md border border-line px-3 text-sm" />
            <span className="text-muted" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor={`${p}-max-price`}>Highest price</label>
            <input id={`${p}-max-price`} name="max" type="number" min={0} step={1} inputMode="numeric" defaultValue={f.max ?? ""} placeholder="Max" className="h-10 w-full min-w-0 rounded-md border border-line px-3 text-sm" />
          </div>
          <button type="submit" className="btn btn-green w-full py-2.5">Apply price</button>
        </form>
      </section>

      <section aria-labelledby={`${p}-show-filter`}>
        <h2 id={`${p}-show-filter`} className="mb-3 font-sans text-xs font-semibold uppercase tracking-widest text-muted">Show only</h2>
        <ul className="space-y-1 text-sm">
          {[
            { label: "On sale", on: f.sale, to: href({ ...f, sale: !f.sale, page: 1 }) },
            { label: "Featured", on: f.featured, to: href({ ...f, featured: !f.featured, page: 1 }) },
          ].map((t) => (
            <li key={t.label}>
              <Link href={t.to} role="checkbox" aria-checked={t.on} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-canvas">
                <span className={`flex h-[18px] w-[18px] items-center justify-center rounded border ${t.on ? "border-brand-darker bg-brand-darker text-white" : "border-muted/50 bg-white"}`} aria-hidden="true">
                  {t.on && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}
                </span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  return (
    <>
      <PageHeader title={title} crumbs={[{ href: "/", label: "Home" }, { href: "/search", label: "Shop" }, ...(current || f.q || f.sale || f.featured ? [{ label: title }] : [])]}>
        <form action="/search" role="search" className="mt-5 flex max-w-xl">
          {f.category && <input type="hidden" name="category" value={f.category} />}
          <label htmlFor="page-search" className="sr-only">Search furniture</label>
          <input
            id="page-search"
            name="q"
            type="search"
            maxLength={80}
            defaultValue={f.q}
            placeholder="Search sofas, beds, tables…"
            className="h-11 min-w-0 flex-1 rounded-l-md border border-r-0 border-line bg-white px-4 text-sm placeholder:text-muted"
          />
          <button type="submit" className="btn btn-green rounded-l-none px-5">Search</button>
        </form>
      </PageHeader>

      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 lg:flex-row">
        <aside className="hidden w-60 flex-none lg:block" aria-label="Filters">{renderFilters("side")}</aside>

        <div className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted" role="status">
              {unavailable ? "" : `${result.total} piece${result.total === 1 ? "" : "s"}`}
            </p>
            <div className="flex items-center gap-3">
              <details className="group relative lg:hidden">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-line px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <FilterIcon className="h-4 w-4" /> Filters{chips.length > 0 && <span className="rounded-full bg-brand-darker px-1.5 text-xs text-white">{chips.length}</span>}
                </summary>
                <div className="absolute left-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-line bg-white p-5 shadow-xl sm:left-auto sm:right-0">{renderFilters("drop")}</div>
              </details>
              <SortSelect value={f.sort} />
            </div>
          </div>

          {chips.length > 0 && (
            <ul className="mb-5 flex flex-wrap items-center gap-2" aria-label="Active filters">
              {chips.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex items-center gap-1.5 rounded-full bg-brand-light px-3 py-1.5 text-xs font-medium text-brand-darker hover:bg-brand-darker hover:text-white">
                    {c.label} <CloseIcon className="h-3.5 w-3.5" /><span className="sr-only">Remove filter</span>
                  </Link>
                </li>
              ))}
              <li><Link href="/search" className="px-2 text-xs text-muted underline-offset-2 hover:underline">Clear all</Link></li>
            </ul>
          )}

          {unavailable ? (
            <CatalogUnavailable detail={devErrorDetail(failure)} />
          ) : result.items.length === 0 ? (
            <div className="rounded-lg border border-line bg-canvas p-10 text-center">
              <p className="text-lg font-semibold">Nothing matches your search</p>
              <p className="mt-1 text-sm text-muted">Try another word, remove a filter, or browse everything.</p>
              <Link href="/search" className="btn btn-gold mt-5">See all furniture</Link>
            </div>
          ) : (
            <>
              <ProductGrid items={result.items.map(toCardItem)} preloadCount={4} columns={3} />
              {pages > 1 && (
                <nav aria-label="Pages" className="mt-10 flex flex-wrap items-center justify-center gap-1.5 text-sm">
                  {f.page > 1 && <Link href={href({ ...f, page: f.page - 1 })} className="flex h-10 items-center rounded-md border border-line px-3 hover:border-brand-darker">← Previous</Link>}
                  {pageList(f.page, pages).map((p, i) =>
                    p === "…" ? (
                      <span key={`gap-${i}`} className="px-1 text-muted">…</span>
                    ) : (
                      <Link
                        key={p}
                        href={href({ ...f, page: p })}
                        aria-current={p === f.page ? "page" : undefined}
                        className={`flex h-10 min-w-10 items-center justify-center rounded-md border px-2 ${p === f.page ? "border-brand-darker bg-brand-darker text-white" : "border-line hover:border-brand-darker"}`}
                      >
                        {p}
                      </Link>
                    ),
                  )}
                  {f.page < pages && <Link href={href({ ...f, page: f.page + 1 })} className="flex h-10 items-center rounded-md border border-line px-3 hover:border-brand-darker">Next →</Link>}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
