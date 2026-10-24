import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/cart/add-to-cart";
import { Gallery } from "@/components/gallery";
import { ProductGrid } from "@/components/product-tile";
import { getProduct, listProducts } from "@/lib/erp";
import { availabilityLabel, CURRENCY, formatPrice, SITE_NAME } from "@/lib/site";
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
        <p className="mt-2 text-neutral-600">Please try again in a moment.</p>
        <Link href="/search" className="mt-6 inline-block rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">Browse furniture</Link>
      </div>
    );
  }
  if (!product) notFound();

  let related: Product[] = [];
  try {
    const page = await listProducts({ category: product.category?.id, pageSize: 5 });
    related = page.items.filter((p) => p.slug !== product.slug).slice(0, 4);
  } catch { /* related items are optional */ }

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
    <div className="mx-auto max-w-(--breakpoint-2xl) px-4">
      {/* "<" is escaped so product text can never close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-neutral-500">
        <Link href="/search" className="hover:text-black hover:underline">All furniture</Link>
        {product.category && (
          <> / <Link href={`/search?category=${encodeURIComponent(product.category.id)}`} className="hover:text-black hover:underline">{product.category.name}</Link></>
        )}
      </nav>

      <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-6 md:p-10 lg:flex-row lg:gap-10">
        <div className="w-full basis-full lg:basis-4/6">
          <Gallery images={product.images} name={product.name} />
        </div>
        <div className="mt-8 basis-full lg:mt-0 lg:basis-2/6">
          <h1 className="text-3xl font-medium md:text-4xl">{product.name}</h1>
          <p className="mt-4 inline-block rounded-full bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">{formatPrice(product.price)}</p>
          <p className={`mt-4 text-sm font-medium ${product.availability === "OUT" ? "text-red-700" : product.availability === "LOW" ? "text-amber-700" : "text-green-700"}`}>
            {availabilityLabel(product.availability)}
          </p>
          {product.description && <p className="mt-6 whitespace-pre-line text-sm leading-6 text-neutral-700">{product.description}</p>}
          <div className="mt-8">
            <AddToCart slug={product.slug} availability={product.availability} />
          </div>
          <p className="mt-4 text-xs text-neutral-500">No payment online. Send a request and we will call you to confirm.</p>
        </div>
      </div>

      {related.length > 0 && (
        <section className="py-8" aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-2xl font-bold">You may also like</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
