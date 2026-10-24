// Shop identity and display settings, all overridable from the environment.
// NEXT_PUBLIC_* values are visible in the browser by design (they are not secrets).

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Al Hayat Furniture";
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "USD";
export const CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE || "";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/$/, "");

export function formatPrice(amount: number): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${CURRENCY}`;
  }
}

export function availabilityLabel(a: "IN_STOCK" | "LOW" | "OUT"): string {
  return a === "IN_STOCK" ? "In stock" : a === "LOW" ? "Only a few left" : "Out of stock";
}

/** Whole-percent saving for a sale badge, e.g. 15 for "-15%". */
export function discountPercent(price: number, compareAt: number | null): number | null {
  if (compareAt == null || compareAt <= price || compareAt <= 0) return null;
  const pct = Math.round((1 - price / compareAt) * 100);
  return pct >= 1 ? pct : null;
}
