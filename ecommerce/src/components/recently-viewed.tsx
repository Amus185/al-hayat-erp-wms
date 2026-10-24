"use client";

import { useEffect } from "react";
import { ProductGrid } from "./product-card";
import { recentlyViewed } from "@/lib/local-list";
import { useProductSummaries } from "@/lib/use-product-summaries";

// Records this product as viewed (on this device only) and shows the other
// products viewed before it.
export function RecentlyViewed({ slug }: { slug: string }) {
  useEffect(() => { recentlyViewed.add(slug); }, [slug]);
  const slugs = recentlyViewed.useSlugs().filter((s) => s !== slug).slice(0, 4);
  const { products } = useProductSummaries(slugs);
  if (!products.length) return null;
  return (
    <section className="mt-16" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-6 text-2xl font-semibold tracking-tight text-brand-darker">Recently viewed</h2>
      <ProductGrid items={products} />
    </section>
  );
}
