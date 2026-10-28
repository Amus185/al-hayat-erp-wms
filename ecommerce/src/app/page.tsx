import Image from "next/image";
import Link from "next/link";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { CategoryCards } from "@/components/category-cards";
import { FeaturesRow } from "@/components/features-row";
import { PhoneIcon } from "@/components/icons";
import { toCardItem } from "@/components/product-card";
import { ProductTabs, type ProductTab } from "@/components/product-tabs";
import { devErrorDetail, listCategories, listProducts } from "@/lib/erp";
import { PHOTOS, roomPhotoFor } from "@/lib/photos";
import { CONTACT_PHONE, PHONE_HREF, SITE_NAME } from "@/lib/site";
import type { Category, Product } from "@/lib/types";

// Rendered on request: the page must not depend on the ERP being reachable at build time.
export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Choose your pieces", text: "Browse the collection and add what you like to your cart." },
  { title: "Send a request", text: "Leave your name and phone number. No payment, no account." },
  { title: "We call you", text: "We confirm stock, the final price and a delivery date." },
  { title: "Pay and receive", text: "Pay once everything is agreed, then we deliver." },
];

export default async function HomePage() {
  let newest: Product[] = [];
  let onSale: Product[] = [];
  let featured: Product[] = [];
  let categories: Category[] = [];
  let failure: unknown = null;
  try {
    const [n, s, f, c] = await Promise.all([
      listProducts({ sort: "new", pageSize: 8 }),
      listProducts({ sale: true, pageSize: 8 }),
      listProducts({ featured: true, pageSize: 8 }),
      listCategories(),
    ]);
    [newest, onSale, featured, categories] = [n.items, s.items, f.items, c];
  } catch (err) {
    failure = err;
  }

  const unavailable = failure !== null;
  const topCategories = categories.filter((c) => !c.parentId && c.productCount > 0).sort((a, b) => b.productCount - a.productCount).slice(0, 8);
  const tabs: ProductTab[] = [
    { key: "featured", label: "Featured", items: featured.map(toCardItem), href: "/search?featured=1" },
    { key: "new", label: "New arrivals", items: newest.map(toCardItem), href: "/search?sort=new" },
    { key: "sale", label: "On sale", items: onSale.map(toCardItem), href: "/search?sale=1" },
  ].filter((t) => t.items.length > 0);
  const banners = topCategories.slice(0, 2);

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden bg-brand-deep">
        <Image src={PHOTOS.hero.src} alt="" fill preload sizes="100vw" className="-z-10 object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-deep/95 via-brand-deep/70 to-brand-deep/25 md:bg-gradient-to-r md:from-brand-deep/95 md:via-brand-deep/75 md:to-brand-deep/10" aria-hidden="true" />
        <div className="mx-auto flex min-h-[460px] max-w-7xl flex-col justify-center px-4 py-16 md:min-h-[560px]">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold">{SITE_NAME}</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Furniture made for the way you live
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80 md:text-lg">
            Sofas, beds, dining and more from our showroom. Choose what you love, send a request, and we call you to confirm. No payment online.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/search" className="btn btn-gold px-7 py-3.5 text-[15px]">Shop the collection</Link>
            <Link href="/how-to-order" className="btn border-[1.5px] border-white/70 px-7 py-3.5 text-[15px] text-white hover:bg-white hover:text-brand-darker">
              How ordering works
            </Link>
          </div>
        </div>
      </section>

      <FeaturesRow tone="cream" />

      <div className="mx-auto max-w-7xl px-4">
        {unavailable && (
          <div className="mt-10"><CatalogUnavailable detail={devErrorDetail(failure)} /></div>
        )}

        {topCategories.length > 0 && (
          <section className="mt-16" aria-labelledby="rooms-heading">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-dark">Collections</p>
                <h2 id="rooms-heading" className="mt-1 text-2xl font-semibold tracking-tight text-brand-darker md:text-3xl">Shop by room</h2>
              </div>
              <Link href="/search" className="hidden text-sm font-medium text-brand-dark hover:underline sm:block">All furniture →</Link>
            </div>
            <CategoryCards categories={topCategories} />
          </section>
        )}

        <section className="mt-16" aria-labelledby="collection-heading">
          {tabs.length > 0 ? (
            <ProductTabs title="Our collection" tabs={tabs} />
          ) : (
            !unavailable && (
              <div className="rounded-lg border border-line bg-canvas p-10 text-center">
                <h2 id="collection-heading" className="text-xl font-semibold">New pieces are on their way</h2>
                <p className="mt-2 text-muted">Please check back soon{PHONE_HREF ? `, or call us on ${CONTACT_PHONE}` : ""}.</p>
              </div>
            )
          )}
        </section>

        {banners.length > 0 && (
          <section className={`mt-16 grid gap-5 ${banners.length > 1 ? "md:grid-cols-2" : ""}`} aria-label="Featured collections">
            {banners.map((c) => {
              const photo = roomPhotoFor(c.name);
              return (
                <Link key={c.id} href={`/search?category=${encodeURIComponent(c.id)}`} className="group relative isolate block min-h-[260px] overflow-hidden rounded-lg md:min-h-[320px]">
                  <Image src={photo.src} alt={photo.alt} fill sizes="(min-width: 768px) 50vw, 100vw" className="-z-10 object-cover transition duration-700 group-hover:scale-105" />
                  <span className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-deep/85 to-brand-deep/20" aria-hidden="true" />
                  <span className="flex h-full min-h-[inherit] flex-col justify-end p-6 text-white md:p-8">
                    <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">The collection</span>
                    <span className="mt-2 font-display text-2xl font-semibold md:text-3xl">{c.name}</span>
                    <span className="mt-4 inline-flex w-fit items-center gap-2 rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition group-hover:bg-gold-dark">
                      Explore {c.productCount} piece{c.productCount === 1 ? "" : "s"} <span aria-hidden="true">→</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </section>
        )}

        {/* How ordering works */}
        <section className="mt-16" aria-labelledby="steps-heading">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-dark">Simple and safe</p>
            <h2 id="steps-heading" className="mt-1 text-2xl font-semibold tracking-tight text-brand-darker md:text-3xl">How ordering works</h2>
          </div>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-lg border border-line bg-white p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-light font-display text-lg font-semibold text-gold-dark">{i + 1}</span>
                <h3 className="mt-4 font-sans text-base font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {/* Promo */}
      <section data-flush-footer className="relative isolate mt-16 overflow-hidden bg-brand-darker">
        <Image src={PHOTOS.promo.src} alt="" fill sizes="100vw" className="-z-10 object-cover opacity-40" />
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-5 px-4 py-14 md:flex-row md:items-center md:justify-between md:py-20">
          <div className="max-w-xl text-white">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Not sure what fits your space?</h2>
            <p className="mt-3 text-white/80">Tell us about your room. We will help you choose sizes, colours and pieces that work together.</p>
          </div>
          {PHONE_HREF ? (
            <a href={PHONE_HREF} className="btn btn-gold px-7 py-3.5 text-[15px]"><PhoneIcon /> Call {CONTACT_PHONE}</a>
          ) : (
            <Link href="/contact" className="btn btn-gold px-7 py-3.5 text-[15px]">Contact us</Link>
          )}
        </div>
      </section>
    </>
  );
}
