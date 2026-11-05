// Price of a quantity when a product is sold by price levels (oldest first). Mirrors the server
// (backend services/price-levels.ts), which decides the price that is saved.
export interface PriceStep { left: number; price: number }

export function priceForQty(steps: PriceStep[] | undefined, base: number, qty: number): { unitPrice: number; note: string | null } {
  if (!steps || !steps.length || qty <= 0) return { unitPrice: base, note: null };
  let left = qty; let total = 0; const parts: string[] = [];
  for (const s of steps) {
    if (left <= 0) break;
    const q = Math.min(left, s.left);
    if (q <= 0) continue;
    total += q * s.price; left -= q; parts.push(`${q} × $${s.price.toFixed(2)}`);
  }
  if (left > 0) { const last = steps[steps.length - 1].price; total += left * last; parts.push(`${left} × $${last.toFixed(2)}`); }
  return { unitPrice: Math.round((total / qty) * 10000) / 10000, note: parts.length > 1 ? parts.join(' + ') : null };
}
