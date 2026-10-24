import Link from "next/link";
import { ProductGrid } from "@/components/product-tile";
import { listCategories, listProducts } from "@/lib/erp";
import { SITE_NAME } from "@/lib/site";
import type { Category, Product } from "@/lib/types";

// Rendered on request: the page must not depend on the ERP being reachable at build time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let products: Product[] = [];
  let categories: Category[] = [];
  let unavailable = false;
  try {
    [{ items: products }, categories] = await Promise.all([listProducts({ pageSize: 8 }), listCategories()]);
  } catch {
    unavailable = true;
  }

  return (
    <div className="mx-auto max-w-(--breakpoint-2xl) px-4 pb-4">
      <section className="rounded-lg border border-neutral-200 bg-white px-6 py-12 md:px-12 md:py-16">
        <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{SITE_NAME}</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">Furniture for the way you live.</h1>
        <p className="mt-4 max-w-xl text-neutral-600">
          Browse our showroom, add what you like and send us a request. We call to confirm availability, delivery and payment. No payment online.
        </p>
        <Link href="/search" className="mt-6 inline-block rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          Browse all furniture
        </Link>
      </section>

      {categories.length > 0 && (
        <section className="mt-8" aria-labelledby="categories-heading">
          <h2 id="categories-heading" className="mb-3 text-lg font-semibold">Shop by room or type</h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/search?category=${encodeURIComponent(c.id)}`} className="inline-block rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm hover:border-neutral-900">
                  {c.name} <span className="text-neutral-400">({c.productCount})</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8" aria-labelledby="featured-heading">
        <div className="mb-3 flex items-end justify-between">
          <h2 id="featured-heading" className="text-lg font-semibold">From our collection</h2>
          {products.length > 0 && <Link href="/search" className="text-sm text-neutral-600 underline underline-offset-4 hover:text-black">See everything</Link>}
        </div>
        {unavailable ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">Our catalog is temporarily unavailable. Please try again in a moment.</p>
        ) : products.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-white p-6 text-neutral-600">New pieces are on their way. Please check back soon.</p>
        ) : (
          <ProductGrid products={products} priorityCount={4} />
        )}
      </section>
    </div>
  );
}
