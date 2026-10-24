"use client";

import { useCart } from "./cart-context";

export function CartButton() {
  const { count, open } = useCart();
  return (
    <button
      type="button"
      onClick={open}
      aria-label={count ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart"}
      className="relative flex h-11 w-11 items-center justify-center rounded-md border border-neutral-200 bg-white text-black transition-colors hover:border-neutral-900"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386a.75.75 0 0 1 .726.564L4.9 6m0 0 1.5 6.75a.75.75 0 0 0 .73.585h9.87a.75.75 0 0 0 .73-.57l1.4-5.6A.75.75 0 0 0 18.4 6.2L4.9 6Zm2.6 12.75a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Zm9 0a1.125 1.125 0 1 0 0 2.25 1.125 1.125 0 0 0 0-2.25Z" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded bg-neutral-900 px-1 text-[11px] font-medium text-white">{count}</span>
      )}
    </button>
  );
}
