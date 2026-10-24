"use client";

import { CartIcon } from "../icons";
import { useCart } from "./cart-context";

export function CartButton() {
  const { count, open } = useCart();
  return (
    <button
      type="button"
      onClick={open}
      aria-label={count ? `Open cart, ${count} item${count === 1 ? "" : "s"}` : "Open cart"}
      className="relative flex h-11 items-center gap-2 rounded-md px-2.5 text-white hover:bg-white/10"
    >
      <CartIcon className="h-6 w-6" />
      <span className="hidden text-sm font-medium lg:inline">Cart</span>
      {count > 0 && (
        <span className="absolute left-6 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink">{count}</span>
      )}
    </button>
  );
}
