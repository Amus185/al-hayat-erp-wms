"use client";

import { useCart } from "./cart-context";
import type { Availability } from "@/lib/types";

export function AddToCart({ slug, availability }: { slug: string; availability: Availability }) {
  const { add, items } = useCart();
  const inCart = items.find((i) => i.slug === slug)?.quantity ?? 0;

  if (availability === "OUT") {
    return (
      <button type="button" disabled className="relative flex w-full items-center justify-center rounded-full bg-neutral-900 p-4 text-sm font-medium tracking-wide text-white opacity-60">
        Out of stock
      </button>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => add(slug, 1)}
        className="relative flex w-full items-center justify-center rounded-full bg-neutral-900 p-4 text-sm font-medium tracking-wide text-white hover:opacity-90"
      >
        {inCart ? "Add one more" : "Add to cart"}
      </button>
      {inCart > 0 && <p className="mt-2 text-center text-xs text-neutral-500" aria-live="polite">{inCart} in your cart</p>}
    </div>
  );
}
