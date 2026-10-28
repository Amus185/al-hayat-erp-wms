"use client";

import Link from "next/link";
import { HeartIcon } from "../icons";
import { ProductGrid, ProductGridSkeleton } from "../product-card";
import { savedItems } from "@/lib/local-list";
import { useProductSummaries } from "@/lib/use-product-summaries";

export function SavedItemsView() {
  const slugs = savedItems.useSlugs();
  const { products, missing, loading, failed } = useProductSummaries(slugs);

  if (!slugs.length) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-light text-brand-darker"><HeartIcon className="h-8 w-8" /></span>
        <h2 className="mt-4 text-2xl font-semibold">No saved items yet</h2>
        <p className="mt-2 text-muted">Tap the heart on any piece to keep it here for later.</p>
        <Link href="/search" className="btn btn-gold mt-6">Browse furniture</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-sm text-muted" role="status">{slugs.length} saved piece{slugs.length === 1 ? "" : "s"}</p>
        {missing.length > 0 && (
          <button type="button" onClick={() => missing.forEach((s) => savedItems.remove(s))} className="text-sm text-muted underline underline-offset-2 hover:text-sale">
            Remove {missing.length} no longer sold
          </button>
        )}
      </div>
      {failed && <p role="alert" className="mb-5 rounded-md border border-sale/30 bg-sale/5 p-3 text-sm text-sale">We could not load your saved items. Please try again in a moment.</p>}
      {loading && products.length === 0 ? <ProductGridSkeleton count={Math.min(slugs.length, 8)} /> : <ProductGrid items={products} />}
    </div>
  );
}
