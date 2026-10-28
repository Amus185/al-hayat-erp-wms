"use client";

import Link from "next/link";
import { useRef, useState, type KeyboardEvent } from "react";
import { ProductGrid, type CardItem } from "./product-card";

export interface ProductTab {
  key: string;
  label: string;
  items: CardItem[];
  href: string; // "see all" link for this tab
}

// New arrivals / On sale / Featured, switched without reloading. Keyboard:
// arrow keys move between tabs (WAI-ARIA tabs pattern).
export function ProductTabs({ title, tabs }: { title: string; tabs: ProductTab[] }) {
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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="collection-heading" className="text-2xl font-semibold tracking-tight text-brand-darker md:text-3xl">{title}</h2>
        <div role="tablist" aria-labelledby="collection-heading" className="-mx-1 flex gap-1 overflow-x-auto px-1">
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
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                t.key === current.key ? "bg-brand-darker text-white" : "bg-canvas text-ink hover:bg-brand-light"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`panel-${current.key}`} aria-labelledby={`tab-${current.key}`}>
        <ProductGrid items={current.items} />
        <div className="mt-8 text-center">
          <Link href={current.href} className="btn btn-outline">
            See all {current.label.toLowerCase()} <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
