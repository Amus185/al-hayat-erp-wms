"use client";

import Link from "next/link";
import { TrashIcon } from "../icons";
import { ProductImage } from "../product-image";
import { QuantityStepper } from "./quantity-stepper";
import { useCart } from "./cart-context";
import { availabilityLabel, formatPrice } from "@/lib/site";
import { MAX_QUANTITY_PER_ITEM } from "@/lib/types";

/** The lines in the cart with quantity and remove controls. */
export function CartLines({ onNavigate, compact = false }: { onNavigate?: () => void; compact?: boolean }) {
  const { lines, missing, loading, failed, items, setQuantity, remove } = useCart();
  const img = compact ? "h-20 w-20" : "h-24 w-24 sm:h-28 sm:w-28";

  return (
    <ul className="divide-y divide-line">
      {lines.map((l) => (
        <li key={l.slug} className="flex gap-4 py-4">
          <Link href={`/product/${l.slug}`} onClick={onNavigate} className={`relative ${img} flex-none overflow-hidden rounded-md bg-canvas`} tabIndex={-1} aria-hidden="true">
            <ProductImage image={l.image} name={l.name} sizes="112px" />
          </Link>
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/product/${l.slug}`} onClick={onNavigate} className="line-clamp-2 font-semibold hover:text-brand-dark">{l.name}</Link>
              <span className="flex-none font-semibold">{formatPrice(l.price * l.quantity)}</span>
            </div>
            <span className="text-muted">
              {formatPrice(l.price)} each
              {l.compareAtPrice != null && l.compareAtPrice > l.price && <s className="ml-2">{formatPrice(l.compareAtPrice)}</s>}
            </span>
            {l.availability !== "IN_STOCK" && (
              <span className={`text-xs font-medium ${l.availability === "OUT" ? "text-sale" : "text-amber-700"}`}>{availabilityLabel(l.availability)}</span>
            )}
            <div className="mt-auto flex items-center gap-3 pt-2">
              <QuantityStepper value={l.quantity} max={MAX_QUANTITY_PER_ITEM} label={l.name} onChange={(n) => setQuantity(l.slug, n)} />
              <button type="button" onClick={() => remove(l.slug)} className="flex items-center gap-1 text-xs text-muted hover:text-sale">
                <TrashIcon className="h-4 w-4" /> Remove<span className="sr-only"> {l.name}</span>
              </button>
            </div>
          </div>
        </li>
      ))}
      {missing.map((slug) => (
        <li key={slug} className="flex items-center justify-between gap-3 py-4 text-sm text-muted">
          <span>An item in your cart is no longer sold.</span>
          <button type="button" onClick={() => remove(slug)} className="underline underline-offset-2 hover:text-sale">Remove</button>
        </li>
      ))}
      {loading && lines.length === 0 &&
        items.map((i) => (
          <li key={i.slug} className="flex gap-4 py-4" aria-hidden="true">
            <div className={`skeleton ${img} flex-none rounded-md`} />
            <div className="flex-1 space-y-2 pt-1">
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-3 w-1/3 rounded" />
            </div>
          </li>
        ))}
      {failed && lines.length === 0 && (
        <li className="py-4 text-sm text-sale" role="alert">We could not load your items. Check your connection and try again.</li>
      )}
    </ul>
  );
}

/** Problems that stop an order request from being sent, or null. */
export function useCartBlocker(): string | null {
  const { lines, missing, failed, loading } = useCart();
  if (loading) return null;
  if (failed && lines.length === 0) return "We could not load your items.";
  if (missing.length) return "Remove the items that are no longer sold to continue.";
  if (lines.some((l) => l.availability === "OUT")) return "Remove the out-of-stock items to continue.";
  return null;
}
