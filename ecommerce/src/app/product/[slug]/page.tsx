import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/cart/add-to-cart";
import { Gallery } from "@/components/gallery";
import { PriceTag, ProductGrid } from "@/components/product-card";
import { getProduct, listProducts } from "@/lib/erp";
import { availabilityLabel, CURRENCY, discountPercent, formatPrice, SITE_NAME } from "@/lib/site";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  let product: Product | null = null;
  try { product = await getProduct(slug); } catch { /* the page itself shows the error state */ }
  if (!product) return { title: "Product not found", robots: { index: false } };
  const description = (product.description || `${product.name} at ${SITE_NAME}`).slice(0, 200);
  return {
    title: product.name,
    description,
    openGraph: product.images[0] ? { title: product.name, description, images: [{ url: product.images[0].url }] } : undefined,
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  let product: Product | null;
  try {
    product = await getProduct(slug);
  } catch {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">We could not load this product</h1>
        <p className="mt-2 text-muted">Please try again in a moment.</p>
        <Link href="/search" className="mt-6 inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-brand-dark">Browse furniture</Link>
      </div>
    );
  }
  if (!product) notFound();

  let related: Product[] = [];
  try {
    const page = await listProducts({ category: product.category?.id, pageSize: 5 });
    related = page.items.filter((p) => p.slug !== product.slug).slice(0, 4);
  } catch { /* related items are optional */ }

  const pct = discountPercent(product.price, product.compareAtPrice);
  const stockTone = product.availability === "OUT" ? "bg-sale" : product.availability === "LOW" ? "bg-amber-500" : "bg-brand";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.images.map((i) => i.url),
    offers: {
      "@type": "Offer",
      price: product.price.toFixed(2),
      priceCurrency: CURRENCY,
      availability: product.availability === "OUT" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    },
  };

  return (
    <div className="mx-auto max-w-7xl px-4">
      {/* "<" is escaped so product text can never close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <nav aria-label="Breadcrumb" className="my-5 text-sm text-muted">
        <Link href="/" className="hover:text-brand">Home</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/search" className="hover:text-brand">All furniture</Link>
        {product.category && (
          <>
            <span aria-hidden="true"> / </span>
            <Link href={`/search?category=${encodeURIComponent(product.category.id)}`} className="hover:text-brand">{product.category.name}</Link>
          </>
        )}
      </nav>

      <div className="grid gap-8 lg:grid-cols-5 lg:gap-12">
        <div className="lg:col-span-3">
          <Gallery images={product.images} name={product.name} />
        </div>
        <div className="lg:col-span-2">
          {product.category?.name && <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{product.category.name}</p>}
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">{product.name}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PriceTag product={product} large />
            {pct && <span className="rounded bg-sale px-2 py-1 text-xs font-bold text-white">Save {pct}%</span>}
          </div>
          {pct && product.compareAtPrice != null && (
            <p className="mt-1 text-sm text-sale">You save {formatPrice(product.compareAtPrice - product.price)}</p>
          )}
          <p className="mt-4 flex items-center gap-2 text-sm font-semibold">
            <span className={`h-2.5 w-2.5 rounded-full ${stockTone}`} aria-hidden="true" />
            {availabilityLabel(product.availability)}
          </p>

          {product.description && <p className="mt-6 whitespace-pre-line text-sm leading-7 text-ink/80">{product.description}</p>}

          <div className="mt-8"><AddToCart slug={product.slug} availability={product.availability} /></div>

          <ul className="mt-8 space-y-3 rounded-xl bg-brand-lighter p-5 text-sm">
            <li className="flex gap-3"><span className="font-bold text-brand" aria-hidden="true">✓</span> No payment online: send a request first.</li>
            <li className="flex gap-3"><span className="font-bold text-brand" aria-hidden="true">✓</span> We call you to confirm stock, delivery and payment.</li>
            <li className="flex gap-3"><span className="font-bold text-brand" aria-hidden="true">✓</span> Stock shown live from our showroom.</li>
          </ul>
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16" aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-6 text-2xl font-extrabold uppercase tracking-tight">You may also like</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
