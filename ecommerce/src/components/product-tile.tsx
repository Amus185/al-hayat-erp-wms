import Link from "next/link";
import { ProductImage } from "./product-image";
import { formatPrice } from "@/lib/site";
import type { Product } from "@/lib/types";

// Rounded photo tile with a name + price pill (design from Next.js Commerce, MIT).
export function ProductTile({
  product,
  priority,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw",
}: {
  product: Product;
  priority?: boolean;
  sizes?: string;
}) {
  const soldOut = product.availability === "OUT";
  return (
    <Link
      href={`/product/${product.slug}`}
      className="group relative block aspect-square h-full w-full overflow-hidden rounded-lg border border-neutral-200 bg-white hover:border-neutral-900"
    >
      <div className="absolute inset-0 transition duration-300 ease-in-out group-hover:scale-105">
        <ProductImage image={product.images[0]} name={product.name} sizes={sizes} preload={priority} />
      </div>
      {soldOut && (
        <span className="absolute right-3 top-3 rounded-full bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold text-white">Out of stock</span>
      )}
      <div className="absolute bottom-0 left-0 flex w-full px-3 pb-3">
        <div className="flex w-full items-center rounded-full border border-neutral-200 bg-white/80 p-1 text-xs font-semibold text-black backdrop-blur-md">
          <h3 className="mr-3 line-clamp-1 grow pl-2 leading-none tracking-tight">{product.name}</h3>
          <span className="flex-none rounded-full bg-neutral-900 px-2.5 py-2 text-white">{formatPrice(product.price)}</span>
        </div>
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: Product[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-flow-row gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.slug} className="animate-fade-in aspect-square">
          <ProductTile product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
