// Shop identity and display settings, all overridable from the environment.
// NEXT_PUBLIC_* values are visible in the browser by design (they are not secrets).
// Contact details are only shown when they are set: the site never invents them.

export const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Al Hayat Furniture";
export const CURRENCY = process.env.NEXT_PUBLIC_CURRENCY || "USD";
export const CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE || "";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "";
export const SHOWROOM_ADDRESS = process.env.NEXT_PUBLIC_SHOWROOM_ADDRESS || "";
export const OPENING_HOURS = process.env.NEXT_PUBLIC_OPENING_HOURS || "";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/$/, "");

/** tel: link for the shop phone, or null when no phone is configured. */
export const PHONE_HREF = CONTACT_PHONE ? `tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}` : null;

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
