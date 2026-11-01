// Product search for forms (New Sale, Purchase Order, Transfer, Adjust Stock).
// Products are searched on the server as the user types, so every product is
// reachable; everything found so far is kept, so lines already on the form
// never lose their product. With `withStock`, the stock rows of those
// products (and of bundle components) come along, so availability is computed
// from complete data.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../api/client';

const mergeById = <T extends { id: string }>(prev: T[], next: T[]): T[] => {
  if (!next.length) return prev;
  const map = new Map(prev.map((x) => [x.id, x]));
  for (const x of next) map.set(x.id, x);
  return Array.from(map.values());
};

export function useProductCatalog(opts: { withStock?: boolean; status?: 'active'; type?: 'STANDARD'; enabled?: boolean } = {}) {
  const [items, setItems] = useState<any[]>([]);
  const [stockRows, setStockRows] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  /** Searches the server, keeps what it finds, and returns this search's products. */
  const search = useCallback(async (q: string): Promise<any[]> => {
    const id = ++seq.current;
    setSearching(true);
    try {
      const res = await apiGet<{ items: any[]; stockRows?: any[] }>('/products', {
        page: 1,
        pageSize: 50,
        q: q.trim() || undefined,
        sort: 'name',
        dir: 'asc',
        status: opts.status,
        type: opts.type,
        withStock: opts.withStock ? 1 : undefined,
      });
      setItems((prev) => mergeById(prev, res.items || []));
      if (res.stockRows) setStockRows((prev) => mergeById(prev, res.stockRows || []));
      return res.items || [];
    } catch {
      return []; // the picker shows what it has
    } finally {
      if (id === seq.current) setSearching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A first page (alphabetical) so the picker is not empty before typing.
  const enabled = opts.enabled !== false;
  useEffect(() => { if (enabled) search(''); }, [search, enabled]);

  /** After stock changed (e.g. an order was saved): reload the stock of the products known so far. */
  const refreshStock = useCallback(async () => {
    if (!opts.withStock) return;
    setStockRows([]);
    await search('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return { items, stockRows, search, searching, refreshStock };
}
