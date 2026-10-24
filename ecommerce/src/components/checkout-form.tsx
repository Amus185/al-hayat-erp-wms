"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useCart } from "./cart/cart-context";
import { formatPrice } from "@/lib/site";

const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm text-black placeholder:text-neutral-400";

export function CheckoutForm() {
  const router = useRouter();
  const { items, lines, missing, loading, clear, remove } = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const blocked = lines.some((l) => l.availability === "OUT") || missing.length > 0;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting || blocked || !items.length) return;
    setError(null);
    setSubmitting(true);
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
          address: data.get("address"),
          city: data.get("city"),
          notes: data.get("notes"),
          website: data.get("website"),
          lines: items,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { requestNumber?: string; message?: string };
      if (res.status === 201 && body.requestNumber) {
        clear();
        router.push(`/thank-you?ref=${encodeURIComponent(body.requestNumber)}`);
        return;
      }
      setError(body.message || "Something went wrong. Please try again or call us.");
    } catch {
      setError("We could not reach the shop. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!items.length) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center">
        <p className="text-lg font-semibold">Your cart is empty</p>
        <Link href="/search" className="mt-4 inline-block rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">Browse furniture</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-5">
      <form onSubmit={onSubmit} className="space-y-4 lg:col-span-3" noValidate>
        <h2 className="text-lg font-semibold">Your details</h2>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Full name</label>
          <input id="name" name="name" required maxLength={100} autoComplete="name" className={field} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium">Phone number</label>
            <input id="phone" name="phone" type="tel" required maxLength={30} autoComplete="tel" inputMode="tel" className={field} />
          </div>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">Email <span className="font-normal text-neutral-500">(optional)</span></label>
            <input id="email" name="email" type="email" maxLength={120} autoComplete="email" className={field} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label htmlFor="address" className="mb-1 block text-sm font-medium">Delivery address <span className="font-normal text-neutral-500">(optional)</span></label>
            <input id="address" name="address" maxLength={300} autoComplete="street-address" className={field} />
          </div>
          <div>
            <label htmlFor="city" className="mb-1 block text-sm font-medium">City</label>
            <input id="city" name="city" maxLength={100} autoComplete="address-level2" className={field} />
          </div>
        </div>
        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium">Notes <span className="font-normal text-neutral-500">(optional)</span></label>
          <textarea id="notes" name="notes" rows={3} maxLength={500} placeholder="Best time to call, floor, access…" className={field} />
        </div>

        {/* Honeypot: invisible to people; bots fill it and the shop quietly drops the request. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {blocked && !loading && (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Some items are out of stock or no longer sold. Remove them from the list to continue.
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || blocked || loading}
          className="w-full rounded-full bg-neutral-900 p-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send order request"}
        </button>
        <p className="text-xs text-neutral-500">No payment is taken. We will call you to confirm availability, delivery and payment.</p>
      </form>

      <aside className="lg:col-span-2" aria-label="Order summary">
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Your items</h2>
          <ul className="mt-4 divide-y divide-neutral-200 text-sm">
            {lines.map((l) => (
              <li key={l.slug} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">{l.name}</p>
                  <p className="text-neutral-500">{l.quantity} × {formatPrice(l.price)}</p>
                  {l.availability === "OUT" && (
                    <p className="text-red-700">Out of stock · <button type="button" onClick={() => remove(l.slug)} className="underline">remove</button></p>
                  )}
                </div>
                <span className="flex-none font-medium">{formatPrice(l.price * l.quantity)}</span>
              </li>
            ))}
            {missing.map((slug) => (
              <li key={slug} className="flex items-center justify-between py-3 text-neutral-500">
                <span>An item is no longer sold</span>
                <button type="button" onClick={() => remove(slug)} className="underline">remove</button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-neutral-200 pt-3">
            <span>Estimated total</span>
            <span className="text-base font-semibold">{formatPrice(total)}</span>
          </div>
          <p className="mt-2 text-xs text-neutral-500">The final prices are confirmed by the shop when we call.</p>
        </div>
      </aside>
    </div>
  );
}
