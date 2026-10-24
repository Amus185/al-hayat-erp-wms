import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product-card";
import { listCategories, listProducts } from "@/lib/erp";
import type { Category, ProductPage } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; category?: string; page?: string; sort?: string; sale?: string; featured?: string }>;

interface Filters { q: string; category: string; page: number; sort: "name" | "new"; sale: boolean; featured: boolean }

const href = (f: Partial<Filters>) => {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.category) sp.set("category", f.category);
  if (f.sort === "new") sp.set("sort", "new");
  if (f.sale) sp.set("sale", "1");
  if (f.featured) sp.set("featured", "1");
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  const qs = sp.toString();
  return `/search${qs ? `?${qs}` : ""}`;
};

async function read(searchParams: SearchParams): Promise<Filters> {
  const sp = await searchParams;
  return {
    q: (sp.q || "").slice(0, 80),
    category: (sp.category || "").slice(0, 64),
    page: Math.max(1, Math.floor(Number(sp.page)) || 1),
    sort: sp.sort === "new" ? "new" : "name",
    sale: sp.sale === "1",
    featured: sp.featured === "1",
  };
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const f = await read(searchParams);
  return { title: f.q ? `Search: ${f.q}` : f.sale ? "On sale" : "All furniture" };
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const f = await read(searchParams);
  let result: ProductPage = { items: [], page: 1, pageSize: 24, total: 0 };
  let categories: Category[] = [];
  let unavailable = false;
  try {
    [result, categories] = await Promise.all([
      listProducts({ q: f.q, category: f.category, page: f.page, pageSize: 24, sort: f.sort, sale: f.sale, featured: f.featured }),
      listCategories(),
    ]);
  } catch {
    unavailable = true;
  }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const current = categories.find((c) => c.id === f.category);
  const title = f.q ? `Results for “${f.q}”` : current?.name ?? (f.sale ? "On sale" : f.featured ? "Featured" : "All furniture");
  const chip = (active: boolean) =>
    `rounded-full border px-3.5 py-1.5 text-xs font-semibold ${active ? "border-brand bg-brand text-white" : "border-line bg-white hover:border-brand hover:text-brand"}`;

  return (
    <div className="mx-auto max-w-7xl px-4">
      <div className="my-6 rounded-2xl bg-brand-lighter px-6 py-8 md:px-10">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Shop</p>
        <h1 className="mt-1 text-3xl font-extrabold uppercase tracking-tight">{title}</h1>
        {!unavailable && <p className="mt-1 text-sm text-muted">{result.total} piece{result.total === 1 ? "" : "s"}</p>}
        <form action="/search" role="search" className="mt-5 flex max-w-xl gap-2">
          {f.category && <input type="hidden" name="category" value={f.category} />}
          <label htmlFor="page-search" className="sr-only">Search furniture</label>
          <input
            id="page-search"
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="Search sofas, beds, tables…"
            className="min-w-0 flex-1 rounded-md border border-line bg-white px-4 py-2.5 text-sm placeholder:text-muted"
          />
          <button type="submit" className="rounded-md bg-brand px-5 text-sm font-bold uppercase text-white hover:bg-brand-dark">Search</button>
        </form>
      </div>

      <div className="flex flex-col gap-8 md:flex-row">
        <nav aria-label="Categories" className="w-full flex-none md:w-56">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted">Categories</h2>
          <ul className="flex flex-wrap gap-2 text-sm md:block md:space-y-1">
            <li>
              <Link href={href({ ...f, category: "", page: 1 })} aria-current={!f.category} className={`block rounded-md px-3 py-2 ${!f.category ? "bg-brand-light font-semibold text-brand-dark" : "hover:bg-canvas"}`}>All furniture</Link>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={href({ ...f, category: c.id, page: 1 })} aria-current={f.category === c.id} className={`flex justify-between rounded-md px-3 py-2 ${f.category === c.id ? "bg-brand-light font-semibold text-brand-dark" : "hover:bg-canvas"}`}>
                  <span>{c.name}</span><span className="text-muted">{c.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-bold uppercase tracking-widest text-muted">Sort</span>
            <Link href={href({ ...f, sort: "name", page: 1 })} className={chip(f.sort === "name")}>Name A–Z</Link>
            <Link href={href({ ...f, sort: "new", page: 1 })} className={chip(f.sort === "new")}>Newest</Link>
            <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
            <Link href={href({ ...f, sale: !f.sale, page: 1 })} aria-pressed={f.sale} className={chip(f.sale)}>On sale</Link>
            <Link href={href({ ...f, featured: !f.featured, page: 1 })} aria-pressed={f.featured} className={chip(f.featured)}>Featured</Link>
          </div>

          {unavailable ? (
            <p className="rounded-xl border border-line bg-canvas p-6 text-muted">Our catalog is temporarily unavailable. Please try again in a moment.</p>
          ) : result.items.length === 0 ? (
            <div className="rounded-xl border border-line bg-canvas p-8 text-center">
              <p className="font-semibold">Nothing matches yet.</p>
              <p className="mt-1 text-sm text-muted">Try another word or category, or <Link href="/search" className="text-brand underline">see all furniture</Link>.</p>
            </div>
          ) : (
            <>
              <ProductGrid products={result.items} preloadCount={4} />
              {pages > 1 && (
                <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-4 text-sm">
                  {f.page > 1 ? <Link href={href({ ...f, page: f.page - 1 })} className="rounded-full border border-line px-4 py-2 hover:border-brand hover:text-brand">← Previous</Link> : <span />}
                  <span className="text-muted">Page {f.page} of {pages}</span>
                  {f.page < pages ? <Link href={href({ ...f, page: f.page + 1 })} className="rounded-full border border-line px-4 py-2 hover:border-brand hover:text-brand">Next →</Link> : <span />}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
