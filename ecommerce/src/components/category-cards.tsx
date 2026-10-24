import Link from "next/link";
import { ProductImage } from "./product-image";
import type { Category } from "@/lib/types";

// Picture cards for shopping by room or type (the photo is the category's own,
// or one of its products' photos, as chosen by the ERP).
export function CategoryCards({ categories }: { categories: Category[] }) {
  if (!categories.length) return null;
  return (
    // Four categories sit in one row; otherwise rows of three.
    <ul className={`grid grid-cols-2 gap-3 sm:gap-5 ${categories.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
      {categories.map((c) => (
        <li key={c.id}>
          <Link href={`/search?category=${encodeURIComponent(c.id)}`} className="group block overflow-hidden rounded-xl border border-line bg-white transition hover:shadow-lg hover:shadow-brand-darker/5">
            <div className="relative aspect-[4/3] overflow-hidden bg-canvas">
              <div className="absolute inset-0 transition duration-500 group-hover:scale-105">
                <ProductImage image={c.image} name={c.name} sizes="(min-width: 768px) 33vw, 50vw" />
              </div>
            </div>
            <div className="px-4 py-3 text-center">
              <p className="text-sm font-bold uppercase tracking-wide group-hover:text-brand">{c.name}</p>
              <p className="text-xs text-muted">{c.productCount} piece{c.productCount === 1 ? "" : "s"}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
