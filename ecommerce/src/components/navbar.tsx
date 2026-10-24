import Link from "next/link";
import { CartButton } from "./cart/cart-button";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { listCategories, listProducts } from "@/lib/erp";
import { CONTACT_PHONE } from "@/lib/site";
import type { Category } from "@/lib/types";

/** Top-level categories for the menu, most stocked first (at most six). */
export async function menuCategories(): Promise<Category[]> {
  try {
    const all = await listCategories();
    return all.filter((c) => !c.parentId).sort((a, b) => b.productCount - a.productCount).slice(0, 6);
  } catch {
    return [];
  }
}

async function hasSale(): Promise<boolean> {
  try {
    return (await listProducts({ sale: true, pageSize: 1 })).total > 0;
  } catch {
    return false;
  }
}

export async function Navbar() {
  const [categories, sale] = await Promise.all([menuCategories(), hasSale()]);
  const links = [
    ...categories.map((c) => ({ href: `/search?category=${encodeURIComponent(c.id)}`, label: c.name })),
    { href: "/search", label: "All furniture" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="bg-brand-darker text-xs text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
          <p>Order online, pay on confirmation. <span className="hidden sm:inline">We call you to confirm stock and delivery.</span></p>
          {CONTACT_PHONE && (
            <a href={`tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}`} className="font-semibold text-accent hover:underline">{CONTACT_PHONE}</a>
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <MobileMenu links={links} sale={sale} />
        <Logo />

        <nav aria-label="Categories" className="hidden flex-1 justify-center lg:flex">
          <ul className="flex items-center gap-5 whitespace-nowrap text-[13px] font-semibold uppercase tracking-wide text-ink xl:gap-7">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="py-2 hover:text-brand">{l.label}</Link>
              </li>
            ))}
            {sale && (
              <li>
                <Link href="/search?sale=1" className="rounded bg-brand px-2.5 py-1 text-white hover:bg-brand-dark">Sale</Link>
              </li>
            )}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-3 lg:ml-0">
          {/* Full search box on wide screens; on medium screens a search icon (the search page has its own box). */}
          <form action="/search" role="search" className="hidden xl:block">
            <label htmlFor="site-search" className="sr-only">Search furniture</label>
            <input
              id="site-search"
              name="q"
              type="search"
              placeholder="Search furniture…"
              autoComplete="off"
              className="w-52 rounded-full border border-line bg-canvas px-4 py-2 text-sm placeholder:text-muted focus:bg-white"
            />
          </form>
          <Link href="/search" aria-label="Search furniture" className="hidden h-11 w-11 items-center justify-center rounded-md border border-line hover:border-brand md:flex xl:hidden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path strokeLinecap="round" d="m20 20-3.5-3.5" /></svg>
          </Link>
          <CartButton />
        </div>
      </div>
    </header>
  );
}
