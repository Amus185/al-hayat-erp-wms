// The chosen customer's price level and credit, for the sale screens.
import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';

export function useCustomerTerms(customerId: string) {
  const [credit, setCredit] = useState<any>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    setCredit(null); setPrices({});
    if (!customerId) return;
    let live = true;
    apiGet<any>(`/sales/customers/${customerId}/credit`).then(async (c) => {
      if (!live) return;
      setCredit(c);
      if (c.price_level_id) { const d = await apiGet<any>(`/sales/price-levels/${c.price_level_id}/prices`); if (live) setPrices(d.prices || {}); }
    }).catch(() => {});
    return () => { live = false; };
  }, [customerId]);
  return { credit, prices };
}
