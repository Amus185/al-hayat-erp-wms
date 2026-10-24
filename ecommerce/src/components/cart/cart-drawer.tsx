"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useCart } from "./cart-context";
import { ProductImage } from "../product-image";
import { availabilityLabel, formatPrice } from "@/lib/site";
import { MAX_QUANTITY_PER_ITEM } from "@/lib/types";

// Slide-over cart. No library: a labelled dialog, Escape to close, focus moved
// into it when it opens and back to the page when it closes.
export function CartDrawer() {
  const { isOpen, close, lines, missing, items, loading, setQuantity, remove } = useCart();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const anyOut = lines.some((l) => l.availability === "OUT");

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="cart-title">
      <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full flex-col border-l border-neutral-200 bg-white p-6 text-black outline-none md:w-[420px]"
      >
        <div className="flex items-center justify-between">
          <h2 id="cart-title" className="text-lg font-semibold">Your cart</h2>
          <button type="button" onClick={close} aria-label="Close cart" className="flex h-10 w-10 items-center justify-center rounded-md border border-neutral-200 hover:border-neutral-900">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="mt-20 flex flex-col items-center text-center text-neutral-500">
            <p className="text-lg font-semibold text-black">Your cart is empty</p>
            <p className="mt-2 text-sm">Add a piece you like and send us a request. We will call to confirm.</p>
            <Link href="/search" onClick={close} className="mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">Browse furniture</Link>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-between">
            <ul className="mt-6 flex-1 divide-y divide-neutral-200 overflow-y-auto">
              {lines.map((l) => (
                <li key={l.slug} className="flex gap-3 py-4">
                  <div className="relative h-16 w-16 flex-none overflow-hidden rounded-md border border-neutral-200 bg-neutral-100">
                    <ProductImage image={l.image} name={l.name} sizes="64px" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col text-sm">
                    <Link href={`/product/${l.slug}`} onClick={close} className="line-clamp-2 font-medium hover:underline">{l.name}</Link>
                    <span className="text-neutral-500">{formatPrice(l.price)}</span>
                    {l.availability !== "IN_STOCK" && (
                      <span className={l.availability === "OUT" ? "text-red-700" : "text-amber-700"}>{availabilityLabel(l.availability)}</span>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex h-9 items-center rounded-full border border-neutral-200">
                        <button type="button" aria-label={`Decrease quantity of ${l.name}`} onClick={() => setQuantity(l.slug, l.quantity - 1)} className="h-full px-3">−</button>
                        <span className="w-6 text-center" aria-live="polite">{l.quantity}</span>
                        <button type="button" aria-label={`Increase quantity of ${l.name}`} disabled={l.quantity >= MAX_QUANTITY_PER_ITEM} onClick={() => setQuantity(l.slug, l.quantity + 1)} className="h-full px-3 disabled:opacity-40">+</button>
                      </div>
                      <button type="button" onClick={() => remove(l.slug)} className="text-xs text-neutral-500 underline underline-offset-2 hover:text-black">Remove</button>
                    </div>
                  </div>
                  <span className="flex-none text-sm font-medium">{formatPrice(l.price * l.quantity)}</span>
                </li>
              ))}
              {missing.map((slug) => (
                <li key={slug} className="flex items-center justify-between py-4 text-sm text-neutral-500">
                  <span>This item is no longer available.</span>
                  <button type="button" onClick={() => remove(slug)} className="underline underline-offset-2">Remove</button>
                </li>
              ))}
              {loading && lines.length === 0 && <li className="py-6 text-sm text-neutral-500">Loading your items…</li>}
            </ul>

            <div className="border-t border-neutral-200 pt-4 text-sm">
              <div className="mb-3 flex items-center justify-between">
                <span>Estimated total</span>
                <span className="text-base font-semibold">{formatPrice(total)}</span>
              </div>
              <p className="mb-4 text-xs text-neutral-500">No payment now. Send a request and we will call you to confirm availability, delivery and payment.</p>
              {anyOut && <p className="mb-3 text-xs text-red-700">Remove the out-of-stock items to continue.</p>}
              <Link
                href="/checkout"
                onClick={close}
                aria-disabled={anyOut || lines.length === 0}
                className={`block w-full rounded-full bg-neutral-900 p-3 text-center text-sm font-medium text-white ${anyOut || lines.length === 0 ? "pointer-events-none opacity-50" : "hover:opacity-90"}`}
              >
                Send order request
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
