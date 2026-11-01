import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Rows ticked for a bulk action. The selection is cleared whenever the list's
 * filters or page change (`resetKey`), so an action never applies to rows the
 * person can no longer see.
 */
export function useSelection(resetKey: string) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { setSelected(new Set()); }, [resetKey]);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const setPage = (ids: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  return { selected, ids: Array.from(selected), count: selected.size, toggle, setPage, clear: () => setSelected(new Set()) };
}

/** The checkbox column for DataTable (rowPrefix / headPrefix). */
export function selectionColumn<T extends { id: string }>(sel: ReturnType<typeof useSelection>, rows: T[], selectable: (r: T) => boolean = () => true) {
  const ids = rows.filter(selectable).map((r) => r.id);
  const all = ids.length > 0 && ids.every((id) => sel.selected.has(id));
  return {
    headPrefix: (
      <input type="checkbox" aria-label="Select all on this page" checked={all} disabled={!ids.length}
        onChange={() => sel.setPage(ids, !all)} />
    ),
    rowPrefix: (r: T) => selectable(r)
      ? <input type="checkbox" aria-label="Select row" checked={sel.selected.has(r.id)} onChange={() => sel.toggle(r.id)} />
      : null,
  };
}

/** Shown while rows are ticked: how many, the actions, and Clear. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{count} selected</strong>
      <div className="bulk-bar__actions">{children}</div>
      <button type="button" className="bulk-bar__clear" onClick={onClear}><X size={14} /> Clear</button>
    </div>
  );
}
