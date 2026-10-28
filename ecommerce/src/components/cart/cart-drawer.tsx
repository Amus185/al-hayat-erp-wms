"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CartIcon, CloseIcon } from "../icons";
import { CartLines, useCartBlocker } from "./cart-lines";
import { useCart } from "./cart-context";

// Slide-over cart. No library: a labelled dialog, Escape to close, focus moved
// into it when it opens and back to the page when it closes.
export function CartDrawer() {
  const { isOpen, close, items, count, subtotalText, loading } = useCart();
  const blocker = useCartBlocker();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [isOpen, close]);

  if (!isOpen) return null;
  const disabled = !!blocker || loading;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
      <div ref={panel} tabIndex={-1} className="animate-slide-in absolute right-0 top-0 flex h-full w-full flex-col bg-white outline-none sm:w-[440px]">
        <div className="flex items-center justify-between bg-brand-darker px-5 py-4 text-white">
          <h2 id="cart-title" className="text-lg font-semibold">Your cart{count > 0 && <span className="font-normal text-white/70"> ({count})</span>}</h2>
          <button type="button" onClick={close} aria-label="Close cart" className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-light text-brand-darker"><CartIcon className="h-8 w-8" /></span>
            <p className="mt-4 text-lg font-semibold">Your cart is empty</p>
            <p className="mt-1 text-sm text-muted">Add a piece you like and send us a request. We call you to confirm.</p>
            <Link href="/search" onClick={close} className="btn btn-gold mt-6">Browse furniture</Link>
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              <CartLines onNavigate={close} compact />
            </div>
            <div className="border-t border-line bg-cream px-5 py-4 text-sm">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="text-lg font-semibold">{subtotalText}</span>
              </div>
              <p className="mt-1 text-xs text-muted">No payment now. Delivery and final price are confirmed when we call.</p>
              {blocker && <p className="mt-2 text-xs font-medium text-sale" role="alert">{blocker}</p>}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link href="/cart" onClick={close} className="btn btn-outline">View cart</Link>
                <Link
                  href="/checkout"
                  onClick={(e) => { if (disabled) e.preventDefault(); else close(); }}
                  aria-disabled={disabled}
                  className={`btn btn-gold ${disabled ? "pointer-events-none" : ""}`}
                >
                  Checkout
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
