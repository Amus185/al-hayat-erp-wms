import { useEffect, useMemo, useRef, useState } from 'react';
import { Columns3 } from 'lucide-react';
import type { Column } from './DataTable';

const read = (key: string): string[] | null => {
  try {
    const raw = localStorage.getItem(`ah_cols_${key}`);
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
};

/**
 * Show/hide columns on wide tables, remembered per person and table on this
 * device. Returns the visible columns and the "Columns" button.
 * Columns with an empty label (actions) are always shown.
 */
export function useColumnChooser<T>(key: string, columns: Column<T>[], hiddenByDefault: string[] = []) {
  const [hidden, setHidden] = useState<string[]>(() => read(key) ?? hiddenByDefault);
  useEffect(() => {
    try { localStorage.setItem(`ah_cols_${key}`, JSON.stringify(hidden)); } catch { /* storage unavailable */ }
  }, [key, hidden]);
  const visible = useMemo(() => columns.filter((c) => !c.label || !hidden.includes(c.key)), [columns, hidden]);
  const chooser = <ColumnMenu columns={columns} hidden={hidden} setHidden={setHidden} reset={() => setHidden(hiddenByDefault)} />;
  return { columns: visible, chooser };
}

function ColumnMenu<T>({ columns, hidden, setHidden, reset }: {
  columns: Column<T>[]; hidden: string[]; setHidden: (h: string[]) => void; reset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const choosable = columns.filter((c) => c.label);
  const shown = choosable.filter((c) => !hidden.includes(c.key)).length;
  return (
    <div className="saved-views" ref={ref}>
      <button type="button" className="list-toolbar__views" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Columns3 size={13} /> Columns ({shown}/{choosable.length})
      </button>
      {open && (
        <div className="saved-views__menu" role="menu">
          {choosable.map((c) => {
            const on = !hidden.includes(c.key);
            return (
              <label key={c.key} className="column-chooser__item">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && shown === 1}
                  onChange={() => setHidden(on ? [...hidden, c.key] : hidden.filter((k) => k !== c.key))}
                />
                {c.label}
              </label>
            );
          })}
          <div className="saved-views__save">
            <button type="button" className="saved-views__new" onClick={reset}>Reset to default</button>
          </div>
        </div>
      )}
    </div>
  );
}
