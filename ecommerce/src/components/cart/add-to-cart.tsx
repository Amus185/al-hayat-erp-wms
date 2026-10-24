"use client";

import { useCart } from "./cart-context";
import type { Availability } from "@/lib/types";

// "full": the big button on the product page. "compact": the outlined button on product cards.
export function AddToCart({ slug, availability, variant = "full" }: { slug: string; availability: Availability; variant?: "full" | "compact" }) {
  const { add, items } = useCart();
  const inCart = items.find((i) => i.slug === slug)?.quantity ?? 0;
  const out = availability === "OUT";

  if (variant === "compact") {
    return (
      <button
        type="button"
        disabled={out}
        onClick={() => add(slug, 1)}
        className="w-full rounded-md border border-brand px-3 py-2 text-xs font-bold uppercase tracking-wide text-brand transition hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
      >
        {out ? "Sold out" : inCart ? `In cart (${inCart}) · add one` : "Add to cart"}
      </button>
    );
  }

  if (out) {
    return (
      <button type="button" disabled className="flex w-full items-center justify-center rounded-full bg-line p-4 text-sm font-bold uppercase tracking-wide text-muted">
        Sold out
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => add(slug, 1)}
        className="flex w-full items-center justify-center rounded-full bg-brand p-4 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-brand-dark"
      >
        {inCart ? "Add one more" : "Add to cart"}
      </button>
      {inCart > 0 && <p className="mt-2 text-center text-xs text-muted" aria-live="polite">{inCart} in your cart</p>}
    </div>
  );
}
