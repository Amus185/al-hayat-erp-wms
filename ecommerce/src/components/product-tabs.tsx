"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { ProductGrid } from "./product-card";
import type { Product } from "@/lib/types";

export interface ProductTab {
  key: string;
  label: string;
  products: Product[];
  href: string; // "see all" link for this tab
}

// New arrivals / On sale / Featured, switched without reloading. Keyboard:
// arrow keys move between tabs (WAI-ARIA tabs pattern).
export function ProductTabs({ tabs }: { tabs: ProductTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!tabs.length) return null;
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActive(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Product lists" className="mb-6 flex justify-center gap-2 sm:gap-6">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={t.key === current.key}
            aria-controls={`panel-${t.key}`}
            tabIndex={t.key === current.key ? 0 : -1}
            onClick={() => setActive(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`border-b-2 px-2 pb-2 text-sm font-semibold transition sm:text-base ${
              t.key === current.key ? "border-brand text-brand-dark" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${current.key}`} aria-labelledby={`tab-${current.key}`}>
        <ProductGrid products={current.products} preloadCount={4} />
        <div className="mt-8 text-center">
          <Link href={current.href} className="inline-block rounded-full border-2 border-brand px-6 py-2.5 text-sm font-semibold text-brand hover:bg-brand hover:text-white">
            See all
          </Link>
        </div>
      </div>
    </div>
  );
}
