"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Category menu for small screens: a button that opens a panel with the
// same links as the desktop menu, plus search.
export function MobileMenu({ links, sale }: { links: { href: string; label: string }[]; sale: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close after navigating.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-line text-ink"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
          {open ? <path strokeLinecap="round" d="M6 18 18 6M6 6l12 12" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div id="mobile-menu" key={pathname} className="absolute inset-x-0 top-full z-50 border-b border-line bg-white px-4 pb-6 pt-3 shadow-lg">
          <form action="/search" role="search" className="mb-4" onSubmit={() => setOpen(false)}>
            <label htmlFor="mobile-search" className="sr-only">Search furniture</label>
            <input id="mobile-search" name="q" type="search" placeholder="Search furniture…" className="w-full rounded-full border border-line bg-canvas px-4 py-2.5 text-sm" />
          </form>
          <ul className="divide-y divide-line text-sm font-semibold uppercase tracking-wide">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="block py-3 hover:text-brand">{l.label}</Link>
              </li>
            ))}
            {sale && (
              <li>
                <Link href="/search?sale=1" onClick={() => setOpen(false)} className="block py-3 text-brand">Sale</Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
