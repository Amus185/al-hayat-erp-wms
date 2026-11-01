import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Trash2, X } from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '../api/client';
import { useToast } from '../contexts/ToastContext';
import type { ServerList } from '../utils/serverList';

interface View { id: string; name: string; query: string }

/**
 * A person's saved filter sets for a list ("Unpaid this month", "My branch
 * deliveries"…): one click applies one; the current filters can be saved
 * under a name. Kept on the server, so they follow the person to any device.
 */
export function SavedViews<T>({ list }: { list: ServerList<T> }) {
  const { addToast } = useToast();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<View[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = list.currentQuery();

  useEffect(() => {
    if (!open || views) return;
    apiGet<View[]>('/views', { list: list.key }).then(setViews).catch(() => setViews([]));
  }, [open, views, list.key]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setNaming(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const save = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const saved = await apiPost<View>('/views', { list: list.key, name: n, query: current });
      setViews((prev) => [...(prev ?? []).filter((v) => v.id !== saved.id && v.name.toLowerCase() !== n.toLowerCase()), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setNaming(false);
      setName('');
      addToast('success', `View “${n}” saved`);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save the view');
    }
  };

  const remove = async (v: View) => {
    try {
      await apiDelete(`/views/${v.id}`);
      setViews((prev) => (prev ?? []).filter((x) => x.id !== v.id));
    } catch (err: any) {
      addToast('error', err?.message || 'Could not delete the view');
    }
  };

  return (
    <div className="saved-views" ref={ref}>
      <button type="button" className="list-toolbar__views" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bookmark size={13} /> Views
      </button>
      {open && (
        <div className="saved-views__menu" role="menu">
          {views === null ? (
            <p className="saved-views__hint">Loading…</p>
          ) : views.length === 0 ? (
            <p className="saved-views__hint">No saved views yet. Set the filters you use often, then save them here.</p>
          ) : (
            views.map((v) => (
              <div key={v.id} className="saved-views__item">
                <button type="button" role="menuitem" onClick={() => { list.applyQuery(v.query); setOpen(false); }}>
                  {v.query === current && <Check size={13} />} {v.name}
                </button>
                <button type="button" aria-label={`Delete view ${v.name}`} className="saved-views__delete" onClick={() => remove(v)}><Trash2 size={13} /></button>
              </div>
            ))
          )}
          <div className="saved-views__save">
            {naming ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Name, e.g. Unpaid this month"
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setNaming(false); }} />
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!name.trim()}>Save</button>
                <button type="button" aria-label="Cancel" className="saved-views__delete" onClick={() => setNaming(false)}><X size={13} /></button>
              </div>
            ) : (
              <button type="button" className="saved-views__new" onClick={() => setNaming(true)} disabled={!current}
                title={current ? 'Save the current search, filters and sort' : 'Set some filters first'}>
                + Save current filters as a view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
