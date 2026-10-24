import Link from "next/link";
import { CartButton } from "./cart/cart-button";
import { CONTACT_PHONE, SITE_NAME } from "@/lib/site";

// Layout from Next.js Commerce (MIT). The search box is a plain GET form, so
// it works without JavaScript.
export function Navbar() {
  return (
    <nav className="relative flex items-center justify-between gap-3 p-4 lg:px-6" aria-label="Main">
      <Link href="/" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-900 text-sm text-white" aria-hidden="true">{SITE_NAME.charAt(0)}</span>
        <span className="hidden sm:block">{SITE_NAME}</span>
      </Link>
      <form action="/search" role="search" className="relative w-full max-w-md">
        <label htmlFor="site-search" className="sr-only">Search furniture</label>
        <input
          id="site-search"
          name="q"
          type="search"
          placeholder="Search furniture…"
          autoComplete="off"
          className="w-full rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm text-black placeholder:text-neutral-500"
        />
      </form>
      <div className="flex items-center gap-4">
        {CONTACT_PHONE && (
          <a href={`tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}`} className="hidden text-sm text-neutral-600 hover:text-black lg:block">
            {CONTACT_PHONE}
          </a>
        )}
        <CartButton />
      </div>
    </nav>
  );
}
