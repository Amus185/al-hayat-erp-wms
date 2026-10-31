"use client";

import { useState, type FormEvent } from "react";
import { formatPrice } from "@/lib/site";

type Stage = "NEW" | "ORDERED" | "INVOICED" | "PAID" | "DELIVERY_SCHEDULED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
interface Order { requestNumber: string; stage: Stage; placedAt: string; total: number; items: { name: string; quantity: number; unitPrice: number }[] }

// The customer's view of the order's life (the ERP's stages, grouped into four steps).
const STEPS = [
  { key: "received", label: "Order received", hint: "We have your order and are checking your items." },
  { key: "confirmed", label: "Confirmed", hint: "We called you and your order is confirmed." },
  { key: "on-the-way", label: "On the way", hint: "Your delivery is scheduled or on its way." },
  { key: "delivered", label: "Delivered", hint: "Delivered. Thank you for shopping with us." },
] as const;

function stepOf(stage: Stage): number {
  if (stage === "DELIVERED") return 3;
  if (stage === "DELIVERY_SCHEDULED" || stage === "OUT_FOR_DELIVERY") return 2;
  if (stage === "ORDERED" || stage === "INVOICED" || stage === "PAID") return 1;
  return 0;
}

const fieldClass = "w-full rounded-md border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 hover:border-muted/50";

export function TrackForm({ initialReference }: { initialReference: string }) {
  const [reference, setReference] = useState(initialReference);
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOrder(null);
    if (!reference.trim() || phone.replace(/\D/g, "").length < 7) {
      setError("Enter your order number and the phone number you ordered with.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestNumber: reference.trim(), phone: phone.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message || "We could not find that order.");
      else setOrder(body as Order);
    } catch {
      setError("We could not reach the shop. Please try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  const current = order ? stepOf(order.stage) : 0;
  return (
    <div className="space-y-8">
      <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border border-line bg-white p-6 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
        <label className="grid gap-1.5 text-sm font-medium">
          Order number
          <input className={fieldClass} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="WR-20261031-AB12CD" autoComplete="off" maxLength={40} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Phone number
          <input className={fieldClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+252 63 …" type="tel" autoComplete="tel" maxLength={30} />
        </label>
        <button type="submit" className="btn btn-gold" disabled={loading}>{loading ? "Checking…" : "Track"}</button>
      </form>

      {error && <p role="alert" className="rounded-md border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">{error}</p>}

      {order && (
        <section aria-live="polite" className="rounded-lg border border-line bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-brand-darker">Order <span className="font-mono">{order.requestNumber}</span></h2>
            <p className="text-sm text-muted">Placed {new Date(order.placedAt).toLocaleDateString()}</p>
          </div>

          {order.stage === "CANCELLED" ? (
            <p className="mt-5 rounded-md bg-sale/5 px-4 py-3 text-sm font-medium text-sale">This order was cancelled. Please call us if you have questions.</p>
          ) : (
            <ol className="mt-6 grid gap-4 sm:grid-cols-4">
              {STEPS.map((s, i) => {
                const done = i <= current;
                return (
                  <li key={s.key} className="flex gap-3 sm:flex-col sm:gap-2" aria-current={i === current ? "step" : undefined}>
                    <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-brand-darker text-gold" : "bg-cream text-muted"}`}>{i + 1}</span>
                    <span>
                      <span className={`block text-sm font-semibold ${done ? "text-brand-darker" : "text-muted"}`}>{s.label}</span>
                      {i === current && <span className="mt-0.5 block text-xs text-muted">{s.hint}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          <ul className="mt-6 divide-y divide-line border-t border-line text-sm">
            {order.items.map((it) => (
              <li key={it.name} className="flex justify-between gap-4 py-2.5">
                <span>{it.quantity} × {it.name}</span>
                <span className="font-medium">{formatPrice(it.unitPrice * it.quantity)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-4 py-2.5 font-semibold">
              <span>Total</span><span>{formatPrice(order.total)}</span>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
