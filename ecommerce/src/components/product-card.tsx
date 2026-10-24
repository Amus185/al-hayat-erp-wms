import Link from "next/link";
import { AddToCart } from "./cart/add-to-cart";
import { ProductImage } from "./product-image";
import { availabilityLabel, discountPercent, formatPrice } from "@/lib/site";
import type { Product } from "@/lib/types";

/** Price with the crossed-out "was" price when the product is on sale. */
export function PriceTag({ product, large = false }: { product: Product; large?: boolean }) {
  const onSale = product.compareAtPrice != null && product.compareAtPrice > product.price;
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${large ? "text-2xl" : "text-base"}`}>
      <span className={`font-bold ${onSale ? "text-sale" : "text-ink"}`}>{formatPrice(product.price)}</span>
      {onSale && (
        <>
          <span className="sr-only">, was</span>
          <s className={`text-muted ${large ? "text-base" : "text-sm"}`}>{formatPrice(product.compareAtPrice!)}</s>
        </>
      )}
    </p>
  );
}

export function ProductCard({ product, preload = false }: { product: Product; preload?: boolean }) {
  const pct = discountPercent(product.price, product.compareAtPrice);
  const out = product.availability === "OUT";
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-white transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-brand-darker/5">
      <Link href={`/product/${product.slug}`} className="relative block aspect-square overflow-hidden bg-canvas" aria-label={product.name}>
        <div className="absolute inset-0 transition duration-500 group-hover:scale-105">
          <ProductImage image={product.images[0]} name={product.name} sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 50vw" preload={preload} />
        </div>
        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {product.isNew && <span className="rounded bg-brand px-2 py-0.5 text-[11px] font-bold uppercase text-white">New</span>}
          {pct && <span className="rounded bg-sale px-2 py-0.5 text-[11px] font-bold text-white">-{pct}%</span>}
        </div>
        {out && <span className="absolute right-3 top-3 rounded bg-ink/80 px-2 py-0.5 text-[11px] font-semibold text-white">Sold out</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        {product.category?.name && <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">{product.category.name}</p>}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">
          <Link href={`/product/${product.slug}`} className="hover:text-brand">{product.name}</Link>
        </h3>
        <PriceTag product={product} />
        {product.availability === "LOW" && <p className="text-xs font-medium text-amber-700">{availabilityLabel("LOW")}</p>}
        <div className="mt-auto pt-3">
          <AddToCart slug={product.slug} availability={product.availability} variant="compact" />
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, preloadCount = 0 }: { products: Product[]; preloadCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.slug} className="animate-fade-in">
          <ProductCard product={p} preload={i < preloadCount} />
        </li>
      ))}
    </ul>
  );
}
