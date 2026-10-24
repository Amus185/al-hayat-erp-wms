import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product-tile";
import { listCategories, listProducts } from "@/lib/erp";
import type { Category, ProductPage } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ q?: string; category?: string; page?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "All furniture" };
}

const href = (params: { q?: string; category?: string; page?: number }) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return `/search${qs ? `?${qs}` : ""}`;
};

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const q = (sp.q || "").slice(0, 80);
  const category = (sp.category || "").slice(0, 64);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  let result: ProductPage = { items: [], page: 1, pageSize: 24, total: 0 };
  let categories: Category[] = [];
  let unavailable = false;
  try {
    [result, categories] = await Promise.all([listProducts({ q, category, page, pageSize: 24 }), listCategories()]);
  } catch {
    unavailable = true;
  }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="mx-auto flex max-w-(--breakpoint-2xl) flex-col gap-8 px-4 pb-4 md:flex-row">
      <nav aria-label="Categories" className="order-first w-full flex-none md:max-w-[180px]">
        <h2 className="mb-2 text-xs text-neutral-500">Categories</h2>
        <ul className="flex flex-wrap gap-2 text-sm md:block md:space-y-1">
          <li>
            <Link href={href({ q })} aria-current={!category} className={`block rounded-md px-2 py-1 hover:underline ${!category ? "font-semibold underline underline-offset-4" : "text-neutral-600"}`}>All</Link>
          </li>
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={href({ q, category: c.id })} aria-current={category === c.id} className={`block rounded-md px-2 py-1 hover:underline ${category === c.id ? "font-semibold underline underline-offset-4" : "text-neutral-600"}`}>
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 flex-1">
        {q && (
          <p className="mb-4 text-sm text-neutral-600">
            {result.total === 0 ? "No products match " : `Showing ${result.total} result${result.total === 1 ? "" : "s"} for `}
            <span className="font-bold">&ldquo;{q}&rdquo;</span>
          </p>
        )}
        {unavailable ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">Our catalog is temporarily unavailable. Please try again in a moment.</p>
        ) : result.items.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">{q ? "Try a different word, or browse all categories." : "No furniture to show here yet."}</p>
        ) : (
          <>
            <ProductGrid products={result.items} priorityCount={4} />
            {pages > 1 && (
              <nav aria-label="Pages" className="mt-8 flex items-center justify-center gap-4 text-sm">
                {page > 1 ? <Link href={href({ q, category, page: page - 1 })} className="rounded-full border border-neutral-300 px-4 py-2 hover:border-neutral-900">← Previous</Link> : <span />}
                <span className="text-neutral-500">Page {page} of {pages}</span>
                {page < pages ? <Link href={href({ q, category, page: page + 1 })} className="rounded-full border border-neutral-300 px-4 py-2 hover:border-neutral-900">Next →</Link> : <span />}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
