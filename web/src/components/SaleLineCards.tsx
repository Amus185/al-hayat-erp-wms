import { useEffect, useState } from 'react';
import { Minus, Plus, Store, Trash2, Truck } from 'lucide-react';

export interface SaleLineView {
  productId: string; name: string; sku: string; quantity: number; unitPrice: number; discount: number;
  fulfillmentType: 'DELIVERY' | 'PICKUP'; priceReason?: string; productType?: string;
  groupItems?: { quantity: number; component_name?: string; component_sku?: string }[];
}

/** True on phone-sized screens (the sale lines are then shown as cards, not a wide table). */
export function useNarrow(maxWidth = 760) {
  const query = `(max-width: ${maxWidth}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

/**
 * The lines of a sale on a phone: one card per product with everything visible at once
 * (quantity stepper, price and its adjustment, discount, delivery or on hand, line total).
 */
export function SaleLineCards({ lines, listPrice, onChange, onFulfillment, onRemove, onReason }: {
  lines: SaleLineView[];
  listPrice: (productId: string, fallback: number) => number;
  onChange: (idx: number, field: 'quantity' | 'unitPrice' | 'discount', value: number) => void;
  onFulfillment: (idx: number, type: 'DELIVERY' | 'PICKUP') => void;
  onRemove: (idx: number) => void;
  onReason: (idx: number, reason: string) => void;
}) {
  return (
    <div className="sale-cards" id="sale-line-cards">
      {lines.map((l, idx) => {
        const ref = listPrice(l.productId, l.unitPrice);
        const total = l.quantity * l.unitPrice - (l.discount || 0);
        return (
          <div className="sale-card" key={l.productId}>
            <div className="sale-card__head">
              <div style={{ minWidth: 0 }}>
                <div className="sale-card__name">{l.name}</div>
                <div className="sale-card__sku">SKU {l.sku}</div>
                {l.productType === 'GROUPED' && l.groupItems?.length ? (
                  <div className="sale-card__sku" style={{ color: '#047857' }}>
                    Bundle: {l.groupItems.map((g) => `${g.quantity}× ${g.component_name || g.component_sku || 'item'}`).join(', ')}
                  </div>
                ) : null}
              </div>
              <button type="button" className="sale-card__remove" aria-label={`Remove ${l.name}`} onClick={() => onRemove(idx)}><Trash2 size={18} /></button>
            </div>

            <div className="sale-card__row">
              <div className="sale-card__field">
                <span>Quantity</span>
                <div className="sale-card__stepper">
                  <button type="button" aria-label="One less" onClick={() => onChange(idx, 'quantity', Math.max(1, l.quantity - 1))}><Minus size={16} /></button>
                  <input type="number" inputMode="numeric" min={1} value={l.quantity} aria-label={`Quantity of ${l.name}`}
                    onChange={(e) => onChange(idx, 'quantity', parseInt(e.target.value) || 1)} />
                  <button type="button" aria-label="One more" onClick={() => onChange(idx, 'quantity', l.quantity + 1)}><Plus size={16} /></button>
                </div>
              </div>
              <div className="sale-card__field">
                <span>Unit price</span>
                {/* Set by the Owner in Products; not editable on a sale. */}
                <div className="sale-card__price" aria-label={`Price of ${l.name}`}>${ref.toFixed(2)}</div>
              </div>
            </div>

            <div className="sale-card__row">
              <label className="sale-card__field">
                <span>Discount ($)</span>
                <input type="number" inputMode="decimal" min={0} step={0.01} value={l.discount} aria-label={`Discount on ${l.name}`}
                  onChange={(e) => onChange(idx, 'discount', parseFloat(e.target.value) || 0)} />
              </label>
              <div className="sale-card__field">
                <span>Handover</span>
                <div className="sale-card__toggle" role="group" aria-label={`How ${l.name} is handed over`}>
                  <button type="button" className={l.fulfillmentType === 'PICKUP' ? 'is-on' : ''} onClick={() => onFulfillment(idx, 'PICKUP')}><Store size={14} /> On hand</button>
                  <button type="button" className={l.fulfillmentType === 'DELIVERY' ? 'is-on' : ''} onClick={() => onFulfillment(idx, 'DELIVERY')}><Truck size={14} /> Delivery</button>
                </div>
              </div>
            </div>

            <div className="sale-card__total"><span>Line total</span><strong>${total.toFixed(2)}</strong></div>
          </div>
        );
      })}
    </div>
  );
}
