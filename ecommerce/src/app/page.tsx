import Image from "next/image";
import Link from "next/link";
import { CategoryCards } from "@/components/category-cards";
import { PriceTag } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";
import { ProductTabs, type ProductTab } from "@/components/product-tabs";
import { listCategories, listProducts } from "@/lib/erp";
import type { Category, Product } from "@/lib/types";

// Rendered on request: the page must not depend on the ERP being reachable at build time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let newest: Product[] = [];
  let onSale: Product[] = [];
  let featured: Product[] = [];
  let categories: Category[] = [];
  let unavailable = false;
  try {
    const [n, s, f, c] = await Promise.all([
      listProducts({ sort: "new", pageSize: 8 }),
      listProducts({ sale: true, pageSize: 8 }),
      listProducts({ featured: true, pageSize: 8 }),
      listCategories(),
    ]);
    [newest, onSale, featured, categories] = [n.items, s.items, f.items, c];
  } catch {
    unavailable = true;
  }

  const hero = featured[0] ?? newest[0];
  const topCategories = categories.filter((c) => !c.parentId).sort((a, b) => b.productCount - a.productCount).slice(0, 6);
  const tabs: ProductTab[] = [
    { key: "new", label: "New arrivals", products: newest, href: "/search?sort=new" },
    { key: "sale", label: "On sale", products: onSale, href: "/search?sale=1" },
    { key: "featured", label: "Featured", products: featured, href: "/search?featured=1" },
  ].filter((t) => t.products.length > 0);

  return (
    <div className="mx-auto max-w-7xl px-4">
      {/* Hero */}
      <section className="mt-6 grid overflow-hidden rounded-2xl bg-brand-lighter md:grid-cols-2">
        <div className="flex flex-col justify-center gap-5 p-8 md:p-14">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Al Hayat Furniture Group</p>
          <h1 className="text-4xl font-extrabold uppercase leading-[1.05] tracking-tight md:text-5xl lg:text-6xl">
            Furniture that <span className="text-brand">feels like</span> home
          </h1>
          <p className="max-w-md text-muted">
            Sofas, beds, dining and more from our showroom. Pick what you love, send a request, and we call you to confirm. No payment online.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/search" className="inline-flex items-center gap-2 rounded-md bg-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-brand-dark">
              Shop now <span aria-hidden="true">→</span>
            </Link>
            {onSale.length > 0 && (
              <Link href="/search?sale=1" className="inline-flex items-center rounded-md border-2 border-brand px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand hover:bg-brand hover:text-white">
                See the sale
              </Link>
            )}
          </div>
        </div>
        <div className="relative min-h-[300px] md:min-h-[480px]">
          {hero?.images[0] ? (
            <Link href={`/product/${hero.slug}`} className="group absolute inset-0 block" aria-label={hero.name}>
              <ProductImage image={hero.images[0]} name={hero.name} sizes="(min-width: 768px) 50vw, 100vw" preload className="transition duration-700 group-hover:scale-105" />
              <span className="absolute bottom-5 left-5 rounded-xl bg-white/90 px-4 py-3 shadow-lg backdrop-blur">
                <span className="block text-sm font-semibold">{hero.name}</span>
                <PriceTag product={hero} />
              </span>
            </Link>
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <Image src="/logo.png" alt="Al Hayat Furniture Group" width={260} height={260} className="h-56 w-56 opacity-90" />
            </div>
          )}
        </div>
      </section>

      {unavailable && (
        <p className="mt-8 rounded-xl border border-line bg-canvas p-6 text-muted">Our catalog is temporarily unavailable. Please try again in a moment.</p>
      )}

      {topCategories.length > 0 && (
        <section className="mt-14 scroll-mt-32" aria-labelledby="rooms-heading">
          <h2 id="rooms-heading" className="mb-6 text-center text-2xl font-extrabold uppercase tracking-tight">Shop by room</h2>
          <CategoryCards categories={topCategories} />
        </section>
      )}

      <section className="mt-14 scroll-mt-32" aria-labelledby="collection-heading">
        <h2 id="collection-heading" className="mb-2 text-center text-2xl font-extrabold uppercase tracking-tight">Our collection</h2>
        {tabs.length > 0 ? (
          <div className="mt-4"><ProductTabs tabs={tabs} /></div>
        ) : (
          !unavailable && <p className="mt-4 text-center text-muted">New pieces are on their way. Please check back soon.</p>
        )}
      </section>

      <section className="mt-16 grid gap-4 rounded-2xl bg-canvas p-6 sm:grid-cols-3 md:p-8" aria-label="How ordering works">
        {[
          { title: "Live showroom stock", text: "What you see is what we have, updated every minute.", icon: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Zm9 4.5 9-4.5M12 12 3 7.5M12 12v9" },
          { title: "Send a request", text: "No payment online. Add to cart and send us your details.", icon: "M4 6h16v12H4zM4 7l8 6 8-6" },
          { title: "We call to confirm", text: "We confirm stock, delivery and payment with you by phone.", icon: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" },
        ].map((f) => (
          <div key={f.title} className="flex gap-4">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-light text-brand-dark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true"><path d={f.icon} /></svg>
            </span>
            <div>
              <h3 className="font-bold">{f.title}</h3>
              <p className="text-sm text-muted">{f.text}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
