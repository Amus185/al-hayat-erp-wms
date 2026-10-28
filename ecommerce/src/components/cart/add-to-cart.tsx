"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CartIcon } from "../icons";
import { QuantityStepper } from "./quantity-stepper";
import { useCart } from "./cart-context";
import { MAX_CART_LINES, MAX_QUANTITY_PER_ITEM, type Availability } from "@/lib/types";

// "compact": the button on product cards (adds one and opens the cart).
// "full": the product page: quantity, Buy now (add, then go to checkout) and Add to cart.
export function AddToCart({ slug, name, availability, variant = "full" }: { slug: string; name: string; availability: Availability; variant?: "full" | "compact" }) {
  const router = useRouter();
  const { add, items } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const inCart = items.find((i) => i.slug === slug)?.quantity ?? 0;
  const out = availability === "OUT";
  const room = MAX_QUANTITY_PER_ITEM - inCart; // how many more of this item fit
  const cartFull = inCart === 0 && items.length >= MAX_CART_LINES;

  const tryAdd = (qty: number, quiet = false) => {
    if (cartFull) { setNotice(`Your cart holds up to ${MAX_CART_LINES} different items.`); return false; }
    if (room <= 0) { setNotice(`You can request up to ${MAX_QUANTITY_PER_ITEM} of one item. For more, please call us.`); return false; }
    setNotice(null);
    return add(slug, Math.min(qty, room), { quiet });
  };

  if (variant === "compact") {
    return (
      <button
        type="button"
        disabled={out}
        onClick={() => tryAdd(1)}
        aria-label={out ? `${name} is sold out` : `Add ${name} to cart`}
        className="btn w-full border-[1.5px] border-brand-darker px-3 py-2 text-xs text-brand-darker hover:bg-brand-darker hover:text-white disabled:border-line disabled:text-muted"
      >
        {out ? "Sold out" : <><CartIcon className="h-4 w-4" /> {inCart ? `In cart (${inCart})` : "Add to cart"}</>}
      </button>
    );
  }

  if (out) {
    return (
      <div>
        <button type="button" disabled className="btn w-full bg-line py-4 text-muted">Sold out</button>
        <p className="mt-2 text-sm text-muted">Save it, or call us to ask when it is back.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <QuantityStepper value={quantity} onChange={setQuantity} max={Math.max(1, room)} label={name} size="lg" />
        <button
          type="button"
          // Already at the per-item limit: it is in the cart, so go straight to checkout.
          onClick={() => { if ((inCart > 0 && room <= 0) || tryAdd(quantity, true)) router.push("/checkout"); }}
          className="btn btn-gold flex-1 basis-32 whitespace-nowrap px-4 py-3.5 text-[15px]"
        >
          Buy now
        </button>
        <button
          type="button"
          onClick={() => tryAdd(quantity)}
          className="btn btn-outline flex-1 basis-36 whitespace-nowrap px-4 py-3.5 text-[15px]"
        >
          <CartIcon /> Add to cart
        </button>
      </div>
      <p className="min-h-5 text-sm" aria-live="polite">
        {notice ? <span className="text-sale">{notice}</span> : inCart > 0 ? <span className="text-muted">{inCart} already in your cart.</span> : null}
      </p>
    </div>
  );
}
