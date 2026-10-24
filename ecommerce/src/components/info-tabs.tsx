"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface InfoTab {
  key: string;
  label: string;
  content: ReactNode;
}

// Description / Details / How ordering works on the product page (WAI-ARIA tabs).
export function InfoTabs({ tabs }: { tabs: InfoTab[] }) {
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
      <div role="tablist" aria-label="Product information" className="flex gap-6 overflow-x-auto border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => { refs.current[i] = el; }}
            role="tab"
            id={`info-tab-${t.key}`}
            aria-selected={t.key === current.key}
            aria-controls={`info-panel-${t.key}`}
            tabIndex={t.key === current.key ? 0 : -1}
            onClick={() => setActive(t.key)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px whitespace-nowrap border-b-2 pb-3 pt-1 text-sm font-semibold transition sm:text-base ${
              t.key === current.key ? "border-gold text-brand-darker" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`info-panel-${current.key}`} aria-labelledby={`info-tab-${current.key}`} tabIndex={0} className="py-6 text-[15px] leading-7 text-ink/85">
        {current.content}
      </div>
    </div>
  );
}
