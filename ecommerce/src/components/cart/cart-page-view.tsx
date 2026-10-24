"use client";

import Link from "next/link";
import { CartIcon } from "../icons";
import { CartLines, useCartBlocker } from "./cart-lines";
import { useCart } from "./cart-context";

export function CartPageView() {
  const { items, count, subtotalText, loading, clear } = useCart();
  const blocker = useCartBlocker();

  if (!items.length) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-light text-brand-darker"><CartIcon className="h-8 w-8" /></span>
        <h2 className="mt-4 text-2xl font-semibold">Your cart is empty</h2>
        <p className="mt-2 text-muted">Browse the collection and add the pieces you like.</p>
        <Link href="/search" className="btn btn-gold mt-6">Browse furniture</Link>
      </div>
    );
  }

  const disabled = !!blocker || loading;
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <section className="lg:col-span-2" aria-labelledby="cart-items-heading">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h2 id="cart-items-heading" className="text-lg font-semibold">{count} item{count === 1 ? "" : "s"}</h2>
          <button type="button" onClick={() => { if (window.confirm("Remove all items from your cart?")) clear(); }} className="text-sm text-muted underline-offset-2 hover:text-sale hover:underline">Empty cart</button>
        </div>
        <CartLines />
        <Link href="/search" className="mt-4 inline-block text-sm font-medium text-brand-dark hover:underline">← Continue shopping</Link>
      </section>

      <aside aria-labelledby="summary-heading" className="h-fit rounded-lg border border-line bg-cream p-6 lg:sticky lg:top-40">
        <h2 id="summary-heading" className="text-lg font-semibold">Summary</h2>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-semibold">{subtotalText}</dd></div>
          <div className="flex justify-between text-muted"><dt>Delivery</dt><dd>Agreed by phone</dd></div>
        </dl>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <span className="font-semibold">Estimated total</span>
          <span className="text-xl font-semibold text-brand-darker">{subtotalText}</span>
        </div>
        {blocker && <p className="mt-3 text-sm font-medium text-sale" role="alert">{blocker}</p>}
        <Link
          href="/checkout"
          aria-disabled={disabled}
          className={`btn btn-gold mt-5 w-full py-3.5 ${disabled ? "pointer-events-none" : ""}`}
        >
          Continue to checkout
        </Link>
        <p className="mt-3 text-xs text-muted">No payment is taken online. We call you to confirm stock, delivery and payment.</p>
      </aside>
    </div>
  );
}
