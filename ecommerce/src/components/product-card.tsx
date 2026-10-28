import Link from "next/link";
import { AddToCart } from "./cart/add-to-cart";
import { ProductImage } from "./product-image";
import { SaveButton } from "./saved/save-button";
import { availabilityLabel, discountPercent, formatPrice } from "@/lib/site";
import type { Product, ProductSummary } from "@/lib/types";

/** What a product card needs: a full product, or a summary the browser fetched by slug. */
export type CardItem = ProductSummary & { isNew?: boolean; categoryName?: string | null };

export function toCardItem(p: Product): CardItem {
  return {
    slug: p.slug,
    name: p.name,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    image: p.images[0] ?? null,
    availability: p.availability,
    isNew: p.isNew,
    categoryName: p.category?.name ?? null,
  };
}

/** Price with the crossed-out "was" price when the product is on sale. */
export function PriceTag({ price, compareAtPrice, large = false }: { price: number; compareAtPrice: number | null; large?: boolean }) {
  const onSale = compareAtPrice != null && compareAtPrice > price;
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${large ? "text-3xl" : "text-base"}`}>
      <span className={`font-semibold ${onSale ? "text-sale" : "text-brand-darker"}`}>{formatPrice(price)}</span>
      {onSale && (
        <>
          <span className="sr-only">, was</span>
          <s className={`text-muted ${large ? "text-lg" : "text-sm"}`}>{formatPrice(compareAtPrice)}</s>
        </>
      )}
    </p>
  );
}

export function ProductCard({ item, preload = false }: { item: CardItem; preload?: boolean }) {
  const pct = discountPercent(item.price, item.compareAtPrice);
  const out = item.availability === "OUT";
  const href = `/product/${item.slug}`;
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-white transition hover:border-brand-darker/20 hover:shadow-[0_8px_30px_-12px_rgba(5,68,5,0.25)]">
      <div className="relative aspect-[4/3.4] overflow-hidden bg-canvas">
        <Link href={href} className="absolute inset-0 block" tabIndex={-1} aria-hidden="true">
          <span className="absolute inset-0 block transition duration-500 group-hover:scale-[1.04]">
            <ProductImage image={item.image} name={item.name} sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw" preload={preload} />
          </span>
        </Link>
        <div className="pointer-events-none absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {pct && <span className="rounded bg-sale px-2 py-0.5 text-[11px] font-bold text-white">-{pct}%</span>}
          {item.isNew && <span className="rounded bg-brand-darker px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">New</span>}
          {out && <span className="rounded bg-ink/80 px-2 py-0.5 text-[11px] font-semibold text-white">Sold out</span>}
        </div>
        <div className="absolute right-2.5 top-2.5">
          <SaveButton slug={item.slug} name={item.name} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        {item.categoryName && <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{item.categoryName}</p>}
        <h3 className="line-clamp-2 font-sans text-sm font-semibold leading-snug sm:text-[15px]">
          <Link href={href} className="hover:text-brand-dark">{item.name}</Link>
        </h3>
        <PriceTag price={item.price} compareAtPrice={item.compareAtPrice} />
        {item.availability === "LOW" && <p className="text-xs font-medium text-amber-700">{availabilityLabel("LOW")}</p>}
        <div className="mt-auto pt-3">
          <AddToCart slug={item.slug} name={item.name} availability={item.availability} variant="compact" />
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ items, preloadCount = 0, columns = 4 }: { items: CardItem[]; preloadCount?: number; columns?: 3 | 4 }) {
  return (
    <ul className={`grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 ${columns === 4 ? "xl:grid-cols-4" : ""}`}>
      {items.map((p, i) => (
        <li key={p.slug} className="animate-fade-in">
          <ProductCard item={p} preload={i < preloadCount} />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder cards while products load. */
export function ProductGridSkeleton({ count = 8, columns = 4 }: { count?: number; columns?: 3 | 4 }) {
  return (
    <ul className={`grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 ${columns === 4 ? "xl:grid-cols-4" : ""}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-lg border border-line">
          <div className="skeleton aspect-[4/3.4]" />
          <div className="space-y-2 p-4">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-4 w-1/4 rounded" />
            <div className="skeleton mt-4 h-9 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}
