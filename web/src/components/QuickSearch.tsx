import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, ShoppingCart, FileText, Truck, User, Package, ArrowLeftRight, ClipboardList, Globe, Loader2, CornerDownLeft } from 'lucide-react';
import { apiGet } from '../api/client';

interface Hit { kind: string; id: string; title: string; subtitle: string; url: string }

const ICONS: Record<string, typeof Search> = {
  order: ShoppingCart, invoice: FileText, delivery: Truck, customer: User, product: Package,
  transfer: ArrowLeftRight, purchase: ClipboardList, web_order: Globe,
};
const LABELS: Record<string, string> = {
  order: 'Sales orders', invoice: 'Invoices', web_order: 'Online orders', delivery: 'Deliveries', customer: 'Customers',
  product: 'Products', transfer: 'Transfers', purchase: 'Purchase orders',
};
const ORDER = ['order', 'invoice', 'web_order', 'customer', 'product', 'delivery', 'transfer', 'purchase'];

/**
 * Search the whole ERP from anywhere: Ctrl+K (⌘K on Mac) or "/" opens it;
 * type an order, invoice, delivery, transfer or PO number, a customer name or
 * phone, or a product name/SKU; Enter opens the record.
 */
export function QuickSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else { setQ(''); setHits([]); setActive(0); }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setBusy(false); return; }
    let stale = false;
    setBusy(true);
    const t = setTimeout(() => {
      apiGet<{ results: Hit[] }>('/search', { q: term })
        .then((r) => {
          if (stale) return;
          const sorted = [...(r.results || [])].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
          setHits(sorted);
          setActive(0);
        })
        .catch(() => { if (!stale) setHits([]); })
        .finally(() => { if (!stale) setBusy(false); });
    }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [q]);

  const go = (h: Hit) => { setOpen(false); navigate(h.url); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]); }
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  return (
    <>
      <button type="button" className="quick-search-trigger" onClick={() => setOpen(true)} aria-label="Search everything (Ctrl+K)" id="quick-search-button">
        <Search size={16} />
        <span className="quick-search-trigger__text">Search orders, customers, products…</span>
        <kbd className="quick-search-trigger__kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && createPortal(
        <div className="quick-search-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="quick-search" role="dialog" aria-label="Search everything" onKeyDown={onKeyDown}>
            <div className="quick-search__input-row">
              {busy ? <Loader2 size={18} className="spin-icon" /> : <Search size={18} />}
              <input
                ref={inputRef}
                id="quick-search-input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Order, invoice or delivery number, customer name or phone, product…"
                autoComplete="off"
                aria-controls="quick-search-results"
              />
              <kbd className="quick-search-trigger__kbd">Esc</kbd>
            </div>
            <div className="quick-search__results" id="quick-search-results" role="listbox">
              {q.trim().length < 2 ? (
                <p className="quick-search__hint">Type at least 2 characters. Use ↑ ↓ to move and Enter to open.</p>
              ) : !busy && hits.length === 0 ? (
                <p className="quick-search__hint">Nothing found for “{q.trim()}”.</p>
              ) : (
                hits.map((h, i) => {
                  const Icon = ICONS[h.kind] ?? Search;
                  const header = i === 0 || hits[i - 1].kind !== h.kind;
                  return (
                    <div key={`${h.kind}-${h.id}-${i}`}>
                      {header && <div className="quick-search__group">{LABELS[h.kind] ?? h.kind}</div>}
                      <button
                        type="button"
                        role="option"
                        aria-selected={i === active}
                        className={`quick-search__hit${i === active ? ' quick-search__hit--active' : ''}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h)}
                      >
                        <Icon size={16} />
                        <span className="quick-search__hit-text">
                          <strong>{h.title}</strong>
                          <span>{h.subtitle}</span>
                        </span>
                        {i === active && <CornerDownLeft size={14} className="quick-search__enter" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
