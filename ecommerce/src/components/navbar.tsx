import Link from "next/link";
import { CartButton } from "./cart/cart-button";
import { SearchIcon } from "./icons";
import { Logo } from "./logo";
import { MobileMenu, type MenuLink } from "./mobile-menu";
import { NavLinks } from "./nav-links";
import { SavedLink } from "./saved/saved-link";
import { listCategories, listProducts } from "@/lib/erp";
import { CONTACT_PHONE, PHONE_HREF } from "@/lib/site";
import type { Category } from "@/lib/types";

/** Top-level categories for the menu, most stocked first (at most six). */
export async function menuCategories(): Promise<Category[]> {
  try {
    const all = await listCategories();
    return all.filter((c) => !c.parentId && c.productCount > 0).sort((a, b) => b.productCount - a.productCount).slice(0, 6);
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

function SearchForm({ id, className = "" }: { id: string; className?: string }) {
  return (
    <form action="/search" role="search" className={`flex w-full ${className}`}>
      <label htmlFor={id} className="sr-only">Search furniture</label>
      <input
        id={id}
        name="q"
        type="search"
        maxLength={80}
        placeholder="Search sofas, beds, tables…"
        autoComplete="off"
        className="h-11 min-w-0 flex-1 rounded-l-md border-0 bg-white px-4 text-sm text-ink placeholder:text-muted"
      />
      <button type="submit" aria-label="Search" className="flex h-11 w-12 flex-none items-center justify-center rounded-r-md bg-gold text-ink hover:bg-gold-dark">
        <SearchIcon />
      </button>
    </form>
  );
}

export async function Navbar() {
  const [categories, sale] = await Promise.all([menuCategories(), hasSale()]);
  const shop: MenuLink[] = [
    ...categories.map((c) => ({ href: `/search?category=${encodeURIComponent(c.id)}`, label: c.name })),
    { href: "/search", label: "All furniture" },
    ...(sale ? [{ href: "/search?sale=1", label: "Sale", tone: "sale" as const }] : []),
  ];
  const help: MenuLink[] = [
    { href: "/how-to-order", label: "How to order" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <>
      <div className="bg-brand-deep text-xs text-white/85">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2">
          <p>No payment online. <span className="hidden sm:inline">Send a request and we call you to confirm stock and delivery.</span></p>
          {PHONE_HREF && (
            <a href={PHONE_HREF} className="whitespace-nowrap font-semibold text-gold hover:underline">Call {CONTACT_PHONE}</a>
          )}
        </div>
      </div>

      <header className="sticky top-0 z-40 shadow-sm">
        <div className="bg-brand-darker">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:gap-6">
            <MobileMenu shop={shop} help={help} />
            <Logo inverted />
            <SearchForm id="site-search" className="mx-auto hidden max-w-xl md:flex" />
            <div className="ml-auto flex items-center gap-1 md:ml-0">
              <SavedLink />
              <CartButton />
            </div>
          </div>
          <div className="px-4 pb-3 md:hidden">
            <SearchForm id="mobile-search" />
          </div>
        </div>

        <nav aria-label="Main" className="hidden border-b border-line bg-white lg:block">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4">
            <NavLinks links={shop} />
            <ul className="flex items-center gap-6 text-sm text-muted">
              {help.map((l) => (
                <li key={l.href}><Link href={l.href} className="py-3 hover:text-brand-darker">{l.label}</Link></li>
              ))}
            </ul>
          </div>
        </nav>
      </header>
    </>
  );
}
