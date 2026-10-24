"use client";

// The cart lives in the browser and holds only product slugs and quantities.
// Names, prices, photos and availability are always loaded fresh from the shop
// (through /api/cart), so a stale cart can never show or promise an old price.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { MAX_CART_LINES, MAX_QUANTITY_PER_ITEM, type CartItem, type CartLine } from "@/lib/types";

const STORAGE_KEY = "ah_cart_v1";
const CHANGE_EVENT = "ah-cart-change";

type Fresh = Omit<CartLine, "quantity">;

interface CartContextValue {
  items: CartItem[];
  count: number;
  lines: CartLine[];
  missing: string[]; // slugs no longer sold
  loading: boolean;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  add: (slug: string, quantity?: number) => void;
  setQuantity: (slug: string, quantity: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
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

  const [isOpen, setIsOpen] = useState(false);
  const [fresh, setFresh] = useState<Record<string, Fresh>>({});
  const [gone, setGone] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  // Fetch current product data whenever the set of products changes (not quantities).
  const slugsKey = items.map((i) => i.slug).join(",");
  useEffect(() => {
    if (!slugsKey) return;
    let cancelled = false;
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs: slugsKey.split(",") }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("cart"))))
      .then((data: { products: Fresh[]; missing: string[] }) => {
        if (cancelled) return;
        setFresh(Object.fromEntries(data.products.map((p) => [p.slug, p])));
        setGone(data.missing);
        setFailed(false);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [slugsKey]);

  // Everything shown is derived: no copies of cart data in state.
  const lines = useMemo<CartLine[]>(
    () => items.flatMap((i) => (fresh[i.slug] ? [{ ...fresh[i.slug], quantity: i.quantity }] : [])),
    [items, fresh],
  );
  const missing = useMemo(() => items.filter((i) => gone.includes(i.slug)).map((i) => i.slug), [items, gone]);
  const loading = !failed && items.some((i) => !fresh[i.slug] && !gone.includes(i.slug));

  const add = useCallback((slug: string, quantity = 1) => {
    const current = parseItems(readRaw());
    const existing = current.find((i) => i.slug === slug);
    if (existing) {
      writeItems(current.map((i) => (i.slug === slug ? { ...i, quantity: Math.min(MAX_QUANTITY_PER_ITEM, i.quantity + quantity) } : i)));
    } else if (current.length < MAX_CART_LINES) {
      writeItems([...current, { slug, quantity: Math.min(MAX_QUANTITY_PER_ITEM, quantity) }]);
    }
    setIsOpen(true);
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

  const value = useMemo<CartContextValue>(
    () => ({
      items, count: items.reduce((n, i) => n + i.quantity, 0), lines, missing, loading, isOpen,
      open: () => setIsOpen(true), close: () => setIsOpen(false), add, setQuantity, remove, clear,
    }),
    [items, lines, missing, loading, isOpen, add, setQuantity, remove, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
