import type { ReactNode } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { SearchInput } from './SearchInput';
import { DateRangeFilter } from './DateRangeFilter';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import type { ServerList } from '../utils/serverList';

export interface ToolbarFilter {
  key: string;
  /** Shown as the "all" choice, e.g. "All statuses". */
  label: string;
  options: { value: string; label: string }[];
}

/**
 * The same search, filters, date range, result count, "Clear filters" and
 * Export on every list. Works with useServerList, so everything happens on
 * the server across all records.
 */
export function ListToolbar<T>({ list, searchPlaceholder = 'Search…', filters = [], dateRange = false, exportable = true, id, children }: {
  list: ServerList<T>;
  searchPlaceholder?: string;
  filters?: ToolbarFilter[];
  /** Adds a date range (dateFrom/dateTo filters). */
  dateRange?: boolean;
  exportable?: boolean;
  id: string;
  /** Extra controls (e.g. a button) on the right. */
  children?: ReactNode;
}) {
  const { hasPermission, isAdmin } = useAuth();
  const { addToast } = useToast();
  const canExport = exportable && (isAdmin || hasPermission('view_reports'));

  const doExport = async () => {
    try {
      await list.exportCsv();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not export the list');
    }
  };

  return (
    <div className="list-toolbar" id={id}>
      <div className="list-toolbar__row">
        <div className="list-toolbar__search">
          <SearchInput id={`${id}-search`} value={list.q} onChange={list.setQ} placeholder={searchPlaceholder} />
        </div>
        {filters.map((f) => (
          <select
            key={f.key}
            aria-label={f.label}
            className={`list-toolbar__select ${list.filters[f.key] ? 'list-toolbar__select--active' : ''}`}
            value={list.filters[f.key] ?? ''}
            onChange={(e) => list.setFilter(f.key, e.target.value)}
          >
            <option value="">{f.label}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {dateRange && (
          <DateRangeFilter
            id={`${id}-dates`}
            from={list.filters.dateFrom ?? ''}
            to={list.filters.dateTo ?? ''}
            onChange={(from, to) => list.setFilters({ dateFrom: from, dateTo: to })}
          />
        )}
        {children}
      </div>
      <div className="list-toolbar__meta">
        <span aria-live="polite">
          {list.initialLoading ? 'Loading…' : `${list.total.toLocaleString()} ${list.total === 1 ? 'result' : 'results'}`}
          {list.loading && !list.initialLoading && <Loader2 size={12} className="spin-icon" style={{ marginLeft: 6, verticalAlign: '-1px' }} />}
        </span>
        {list.activeFilters > 0 && (
          <button type="button" className="list-toolbar__clear" onClick={list.clear}>
            <X size={13} /> Clear filters
          </button>
        )}
        {canExport && (
          <button type="button" className="list-toolbar__export" onClick={doExport} disabled={list.exporting || list.total === 0}
            title="Download everything that matches these filters (all pages) as a CSV file for Excel">
            {list.exporting ? <Loader2 size={13} className="spin-icon" /> : <Download size={13} />} Export
          </button>
        )}
      </div>
      {list.error && <div role="alert" className="list-toolbar__error">{list.error}</div>}
    </div>
  );
}
