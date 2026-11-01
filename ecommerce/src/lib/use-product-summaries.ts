"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductSummary } from "./types";

interface State {
  key: string;
  products: Record<string, ProductSummary>;
  missing: string[];
  failed: boolean;
}

/**
 * Fresh card data (through /api/cart) for products known only by slug. Returns
 * the products in the order of `slugs`, the slugs no longer sold, and whether
 * the shop could not be reached.
 */
export function useProductSummaries(slugs: string[]) {
  const key = slugs.join(",");
  const [state, setState] = useState<State>({ key: "", products: {}, missing: [], failed: false });
  const [version, setVersion] = useState(0);
  /** Load fresh availability again (e.g. after the shop refused an order). */
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs: key.split(",") }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("summaries"))))
      .then((data: { products: ProductSummary[]; missing: string[] }) => {
        if (!cancelled) setState({ key, products: Object.fromEntries(data.products.map((p) => [p.slug, p])), missing: data.missing, failed: false });
      })
      .catch(() => { if (!cancelled) setState((s) => ({ ...s, key, failed: true })); });
    return () => { cancelled = true; };
  }, [key, version]);

  return useMemo(() => {
    const products = slugs.flatMap((s) => (state.products[s] ? [state.products[s]] : []));
    const missing = slugs.filter((s) => state.missing.includes(s));
    // Loading until this exact list has been answered (a failed answer counts).
    const loading = !!key && state.key !== key;
    return { products, missing, loading, failed: state.key === key && state.failed, refresh };
  }, [slugs, state, key, refresh]);
}
