// One hook for every list that pages, searches, filters and sorts on the
// server. The list's state lives in the page address (?q=…&status=…&page=2),
// so Back returns to the same view, a link can be shared, and a refresh keeps
// it. The page size is remembered per person and list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiDownload, apiGet } from '../api/client';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  counts?: Record<string, number>;
  totals?: Record<string, number>;
}

export interface ServerListOptions {
  /** Identifies the list (page-size memory, export file). */
  key: string;
  /** Filter names this list uses, besides q/page/pageSize/sort/dir (e.g. ['status', 'dateFrom', 'dateTo']). */
  filters?: string[];
  defaultSort?: string;
  defaultDir?: 'asc' | 'desc';
  /** Address-bar prefix when one page has several lists (e.g. 'tx' -> ?txq=…). */
  prefix?: string;
  /** Always sent, not shown in the address (e.g. a fixed customer id). */
  fixed?: Record<string, string | undefined>;
  /** Set false to pause loading (e.g. a tab that is not visible). */
  enabled?: boolean;
}

export const PAGE_SIZES = [25, 50, 100];

const readSize = (key: string) => {
  try {
    const n = Number(localStorage.getItem(`ah_pagesize_${key}`));
    return PAGE_SIZES.includes(n) ? n : PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
};

export function useServerList<T>(endpoint: string, opts: ServerListOptions) {
  const [params, setParams] = useSearchParams();
  const pre = opts.prefix ?? '';
  const filterNames = opts.filters ?? [];
  const get = (k: string) => params.get(pre + k) ?? '';

  const q = get('q');
  const page = Math.max(1, Number(get('page')) || 1);
  const pageSize = PAGE_SIZES.includes(Number(get('pageSize'))) ? Number(get('pageSize')) : readSize(opts.key);
  const sort = get('sort') || opts.defaultSort || '';
  const dir = (get('dir') as 'asc' | 'desc') || opts.defaultDir || 'desc';
  const filterKey = filterNames.map((f) => `${f}=${get(f)}`).join('&');
  const filters = useMemo(
    () => Object.fromEntries(filterNames.map((f) => [f, get(f)])) as Record<string, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterKey],
  );
  const fixedKey = JSON.stringify(opts.fixed ?? {});

  /** Changes address parameters; any change other than the page goes back to page 1. */
  const update = useCallback((changes: Record<string, string | number | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '' || v === undefined) next.delete(pre + k);
        else next.set(pre + k, String(v));
      }
      if (!('page' in changes)) next.delete(pre + 'page');
      return next;
    }, { replace: true });
  }, [setParams, pre]);

  const query = useMemo(() => {
    const out: Record<string, string | number> = { page, pageSize };
    if (q) out.q = q;
    if (sort) { out.sort = sort; out.dir = dir; }
    for (const [k, v] of Object.entries(filters)) if (v) out[k] = v;
    for (const [k, v] of Object.entries(opts.fixed ?? {})) if (v) out[k] = v;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, q, sort, dir, filters, fixedKey]);

  const [data, setData] = useState<Paged<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    setLoading(true);
    apiGet<Paged<T>>(endpoint, query)
      .then((res) => {
        if (id !== seq.current) return; // a newer search replaced this one
        setData(res);
        setError(null);
        // Past the last page (e.g. after deleting the last row there): go to the last page.
        const last = Math.max(1, Math.ceil(res.total / res.pageSize));
        if (res.items.length === 0 && res.total > 0 && page > last) update({ page: last });
      })
      .catch((err) => { if (id === seq.current) setError(err?.message || 'Could not load the list'); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, JSON.stringify(query), tick, enabled]);

  const [exporting, setExporting] = useState(false);
  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const { page: _p, pageSize: _s, ...rest } = query;
      await apiDownload(endpoint, { ...rest, format: 'csv' });
    } finally {
      setExporting(false);
    }
  }, [endpoint, query]);

  const activeFilters = (q ? 1 : 0) + Object.values(filters).filter(Boolean).length;

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    counts: data?.counts,
    totals: data?.totals,
    /** true until the first answer; later loads keep showing the current rows */
    initialLoading: loading && !data,
    loading,
    error,
    page, pageSize, q, sort, dir, filters, activeFilters,
    setQ: (v: string) => update({ q: v }),
    setFilter: (k: string, v: string) => update({ [k]: v }),
    setFilters: (changes: Record<string, string>) => update(changes),
    setPage: (p: number) => update({ page: p > 1 ? p : null }),
    setPageSize: (n: number) => {
      try { localStorage.setItem(`ah_pagesize_${opts.key}`, String(n)); } catch { /* ignore */ }
      update({ pageSize: n });
    },
    /** Click on a column heading: sort by it; again: reverse. */
    toggleSort: (key: string) => update(sort === key ? { sort: key, dir: dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' }),
    clear: () => update(Object.fromEntries(['q', ...filterNames].map((k) => [k, null]))),
    refresh: () => setTick((n) => n + 1),
    exportCsv,
    exporting,
  };
}

export type ServerList<T> = ReturnType<typeof useServerList<T>>;
