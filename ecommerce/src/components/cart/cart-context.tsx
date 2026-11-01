"use client";

// The cart lives in the browser and holds only product slugs and quantities.
// Names, prices, photos and availability are always loaded fresh from the shop
// (through /api/cart), so a stale cart can never show or promise an old price.
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatPrice } from "@/lib/site";
import { useProductSummaries } from "@/lib/use-product-summaries";
import { MAX_CART_LINES, MAX_QUANTITY_PER_ITEM, type CartItem, type CartLine } from "@/lib/types";

const STORAGE_KEY = "ah_cart_v1";
const CHANGE_EVENT = "ah-cart-change";

interface CartContextValue {
  items: CartItem[];
  count: number;
  lines: CartLine[];
  missing: string[]; // slugs no longer sold
  loading: boolean;
  failed: boolean; // the shop could not be reached for fresh prices
  subtotal: number;
  /** The subtotal ready to show: a placeholder until fresh prices have loaded. */
  subtotalText: string;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Adds to the cart; opens the cart drawer unless `quiet`. Returns false when the cart is full. */
  add: (slug: string, quantity?: number, opts?: { quiet?: boolean }) => boolean;
  setQuantity: (slug: string, quantity: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  /** Reload names, prices and availability from the shop. */
  refresh: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

// ── localStorage as an external store ───────────────────────────────────────
// The snapshot is the raw JSON string, so React compares it by value.

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "[]";
  } catch {
    return "[]";
  }
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) onChange(); }; // other tabs
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange); // this tab
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function parseItems(raw: string): CartItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i): i is CartItem => !!i && typeof i.slug === "string" && Number.isInteger(i.quantity) && i.quantity > 0)
      .slice(0, MAX_CART_LINES)
      .map((i) => ({ slug: i.slug, quantity: Math.min(MAX_QUANTITY_PER_ITEM, i.quantity) }));
  } catch {
    return [];
  }
}

function writeItems(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* storage unavailable: the cart simply will not persist */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function CartProvider({ children }: { children: ReactNode }) {
  // "[]" on the server and during hydration, the real cart right after.
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const items = useMemo(() => parseItems(raw), [raw]);
  const slugs = useMemo(() => items.map((i) => i.slug), [items]);
  const fresh = useProductSummaries(slugs);
  const [isOpen, setIsOpen] = useState(false);

  // Everything shown is derived: no copies of cart data in state.
  const lines = useMemo<CartLine[]>(() => {
    const bySlug = new Map(fresh.products.map((p) => [p.slug, p]));
    return items.flatMap((i) => {
      const p = bySlug.get(i.slug);
      return p ? [{ ...p, quantity: i.quantity }] : [];
    });
  }, [items, fresh.products]);
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const add = useCallback((slug: string, quantity = 1, opts: { quiet?: boolean } = {}) => {
    const current = parseItems(readRaw());
    const existing = current.find((i) => i.slug === slug);
    if (existing) {
      writeItems(current.map((i) => (i.slug === slug ? { ...i, quantity: Math.min(MAX_QUANTITY_PER_ITEM, i.quantity + quantity) } : i)));
    } else if (current.length < MAX_CART_LINES) {
      writeItems([...current, { slug, quantity: Math.min(MAX_QUANTITY_PER_ITEM, Math.max(1, quantity)) }]);
    } else {
      return false;
    }
    if (!opts.quiet) setIsOpen(true);
    return true;
  }, []);

  const setQuantity = useCallback((slug: string, quantity: number) => {
    const current = parseItems(readRaw());
    writeItems(
      quantity <= 0
        ? current.filter((i) => i.slug !== slug)
        : current.map((i) => (i.slug === slug ? { ...i, quantity: Math.min(MAX_QUANTITY_PER_ITEM, quantity) } : i)),
    );
  }, []);

  const remove = useCallback((slug: string) => writeItems(parseItems(readRaw()).filter((i) => i.slug !== slug)), []);
  const clear = useCallback(() => writeItems([]), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      count: items.reduce((n, i) => n + i.quantity, 0),
      lines,
      missing: fresh.missing,
      loading: fresh.loading,
      failed: fresh.failed,
      subtotal,
      subtotalText: fresh.loading && lines.length < items.length ? "…" : formatPrice(subtotal),
      isOpen,
      open, close, add, setQuantity, remove, clear,
      refresh: fresh.refresh,
    }),
    [items, lines, fresh.missing, fresh.loading, fresh.failed, fresh.refresh, subtotal, isOpen, open, close, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
