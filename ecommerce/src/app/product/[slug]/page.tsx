import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCart } from "@/components/cart/add-to-cart";
import { FeaturesRow } from "@/components/features-row";
import { Gallery } from "@/components/gallery";
import { CheckIcon, PhoneIcon } from "@/components/icons";
import { InfoTabs } from "@/components/info-tabs";
import { Breadcrumbs } from "@/components/page-header";
import { PriceTag, ProductGrid, toCardItem } from "@/components/product-card";
import { RecentlyViewed } from "@/components/recently-viewed";
import { SaveButton } from "@/components/saved/save-button";
import { getProduct, listProducts } from "@/lib/erp";
import { availabilityLabel, CONTACT_PHONE, CURRENCY, discountPercent, formatPrice, PHONE_HREF, SITE_NAME } from "@/lib/site";
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

const ORDER_STEPS = [
  "Choose the quantity and add the piece to your cart, or press Buy now.",
  "Send your request with your name and phone number. Nothing is charged.",
  "We call you to confirm stock, the final price and a delivery date.",
  "You pay once everything is agreed, and we deliver.",
];

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  let product: Product | null;
  try {
    product = await getProduct(slug);
  } catch {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold">We could not load this product</h1>
        <p className="mt-2 text-muted">Please try again in a moment.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/product/${slug}`} className="btn btn-green">Try again</Link>
          <Link href="/search" className="btn btn-outline">Browse furniture</Link>
        </div>
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
  const [summary] = (product.description || "").split(/\n\s*\n|\n/);

  return (
    <>
      <div className="mx-auto max-w-7xl px-4">
        {/* "<" is escaped so product text can never close the script tag. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />

        <div className="py-5">
          <Breadcrumbs
            crumbs={[
              { href: "/", label: "Home" },
              { href: "/search", label: "Shop" },
              ...(product.category?.name ? [{ href: `/search?category=${encodeURIComponent(product.category.id)}`, label: product.category.name }] : []),
              { label: product.name },
            ]}
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
          <Gallery images={product.images} name={product.name} />

          <div>
            <div className="flex flex-wrap items-center gap-2">
              {product.category?.name && <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-dark">{product.category.name}</span>}
              {product.isNew && <span className="rounded bg-brand-darker px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">New</span>}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-brand-darker md:text-4xl">{product.name}</h1>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <PriceTag price={product.price} compareAtPrice={product.compareAtPrice} large />
              {pct && <span className="rounded-full bg-sale/10 px-3 py-1 text-sm font-semibold text-sale">Save {pct}%</span>}
            </div>
            {pct && product.compareAtPrice != null && (
              <p className="mt-1 text-sm text-sale">You save {formatPrice(product.compareAtPrice - product.price)}</p>
            )}

            <p className="mt-4 flex items-center gap-2 text-sm font-semibold">
              <span className={`h-2.5 w-2.5 rounded-full ${stockTone}`} aria-hidden="true" />
              {availabilityLabel(product.availability)}
              {product.availability !== "OUT" && <span className="font-normal text-muted">· in our showroom</span>}
            </p>

            {summary && <p className="mt-5 leading-7 text-ink/80">{summary}</p>}

            <div className="mt-6 border-t border-line pt-6">
              <AddToCart slug={product.slug} name={product.name} availability={product.availability} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-3">
              <SaveButton slug={product.slug} name={product.name} variant="full" />
              {PHONE_HREF && (
                <a href={PHONE_HREF} className="btn border-[1.5px] border-line text-ink hover:border-brand-darker">
                  <PhoneIcon /> Ask about this piece
                </a>
              )}
            </div>

            <ul className="mt-7 space-y-2.5 rounded-lg bg-cream p-5 text-sm">
              {["No payment online: send a request first.", "We call you to confirm stock, delivery and payment.", "Availability comes live from our showroom."].map((t) => (
                <li key={t} className="flex gap-3"><CheckIcon className="h-5 w-5 flex-none text-brand" />{t}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-14">
          <InfoTabs
            tabs={[
              {
                key: "description",
                label: "Description",
                content: product.description
                  ? <p className="max-w-3xl whitespace-pre-line">{product.description}</p>
                  : <p className="text-muted">Call us for the full details of this piece{CONTACT_PHONE ? ` on ${CONTACT_PHONE}` : ""}.</p>,
              },
              {
                key: "details",
                label: "Details",
                content: (
                  <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-sm">
                    {product.category?.name && <><dt className="text-muted">Category</dt><dd>{product.category.name}</dd></>}
                    <dt className="text-muted">Price</dt><dd>{formatPrice(product.price)}{pct ? ` (was ${formatPrice(product.compareAtPrice!)})` : ""}</dd>
                    <dt className="text-muted">Availability</dt><dd>{availabilityLabel(product.availability)}</dd>
                    <dt className="text-muted">Delivery</dt><dd>Arranged with you by phone</dd>
                    <dt className="text-muted">Payment</dt><dd>After we confirm your order</dd>
                  </dl>
                ),
              },
              {
                key: "ordering",
                label: "How ordering works",
                content: (
                  <ol className="max-w-2xl space-y-3">
                    {ORDER_STEPS.map((s, n) => (
                      <li key={s} className="flex gap-4">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gold-light text-sm font-semibold text-gold-dark">{n + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                ),
              },
            ]}
          />
        </div>

        {related.length > 0 && (
          <section className="mt-12" aria-labelledby="related-heading">
            <div className="mb-6 flex items-end justify-between gap-4">
              <h2 id="related-heading" className="text-2xl font-semibold tracking-tight text-brand-darker">Similar items</h2>
              {product.category && (
                <Link href={`/search?category=${encodeURIComponent(product.category.id)}`} className="text-sm font-medium text-brand-dark hover:underline">See all →</Link>
              )}
            </div>
            <ProductGrid items={related.map(toCardItem)} />
          </section>
        )}

        <RecentlyViewed slug={product.slug} />
      </div>

      <div data-flush-footer className="mt-16 border-t border-line">
        <FeaturesRow />
      </div>
    </>
  );
}
