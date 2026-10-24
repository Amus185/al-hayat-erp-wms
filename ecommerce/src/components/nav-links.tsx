"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { MenuLink } from "./mobile-menu";

/** True when the link points at the page being shown (same path and the same filter). */
export function useIsCurrent() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (href: string) => {
    const url = new URL(href, "http://x");
    if (url.pathname !== pathname) return false;
    if (pathname !== "/search") return true;
    const key = (p: URLSearchParams) => `${p.get("category") ?? ""}|${p.get("sale") ?? ""}`;
    return key(url.searchParams) === key(params) && !params.get("q");
  };
}

export function NavLinks({ links }: { links: MenuLink[] }) {
  const isCurrent = useIsCurrent();
  return (
    <ul className="flex items-center gap-1 whitespace-nowrap text-sm font-medium">
      {links.map((l) => {
        const current = isCurrent(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`relative block px-3 py-3 transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full ${
                l.tone === "sale" ? "text-sale hover:text-sale" : "hover:text-brand-dark"
              } ${current ? "font-semibold text-brand-darker after:bg-gold" : "after:bg-transparent"}`}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
