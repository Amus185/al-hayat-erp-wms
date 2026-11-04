import { confirmAction } from '../utils/swal';

export const PRICE_REASONS = ['Customer deal', 'Bulk / wholesale', 'Market price today', 'Old / damaged stock', 'Other'];

/**
 * Under the price box of a sale line: shows how the sold price differs from the product's
 * price (a discount when lower, a surcharge when higher) and asks why. The server keeps the
 * product's price, the sold price and the reason, and tells the Owner and accountants.
 */
export function PriceAdjustment({ name, reference, price, reason, onReason }: {
  name: string; reference: number; price: number; reason: string; onReason: (v: string) => void;
}) {
  const diff = Math.round((price - reference) * 100) / 100;
  if (Math.abs(diff) < 0.005) return null;
  return (
    <>
      <span style={{ fontSize: '11px', color: diff < 0 ? '#b45309' : '#047857' }}>
        List ${reference.toFixed(2)} → {diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)} price adjustment
      </span>
      <select
        aria-label={`Reason for the price change on ${name}`}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
        style={{ fontSize: '11px', padding: '2px 4px', borderRadius: '4px', border: `1px solid ${reason ? '#c8d8c8' : '#f87171'}`, maxWidth: '150px' }}
      >
        <option value="">Why? (required)</option>
        {PRICE_REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
    </>
  );
}

/** Typo guard: a price more than 30% away from the product's price must be confirmed. Returns false to undo it. */
export async function confirmFarPrice(reference: number, price: number): Promise<boolean> {
  if (reference <= 0 || Math.abs(price - reference) / reference <= 0.3) return true;
  return confirmAction('Check the price', `This product's price is $${reference.toFixed(2)} and you typed $${price.toFixed(2)}. Keep it?`, 'Yes, keep it');
}
