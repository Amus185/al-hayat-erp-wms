import { Calendar } from 'lucide-react';

/** YYYY-MM-DD in the user's own time zone. */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function datePreset(key: string, now = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return d; };
  switch (key) {
    case 'today': return { from: iso(now), to: iso(now) };
    case 'yesterday': return { from: iso(day(-1)), to: iso(day(-1)) };
    case 'last7': return { from: iso(day(-6)), to: iso(now) };
    case 'last30': return { from: iso(day(-29)), to: iso(now) };
    case 'thisWeek': { const back = (now.getDay() + 6) % 7; return { from: iso(day(-back)), to: iso(now) }; } // week starts Monday
    case 'thisMonth': return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case 'lastMonth': return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'thisYear': return { from: iso(new Date(y, 0, 1)), to: iso(now) };
    case 'lastYear': return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y - 1, 11, 31)) };
    default: return null;
  }
}

const PRESETS: Array<[string, string]> = [
  ['', 'Any date'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['thisWeek', 'This week'], ['last7', 'Last 7 days'],
  ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['last30', 'Last 30 days'], ['thisYear', 'This year'], ['lastYear', 'Last year'],
];

/** The preset that matches the current range exactly, or 'custom'. */
function currentPreset(from: string, to: string): string {
  if (!from && !to) return '';
  for (const [key] of PRESETS) {
    const r = key ? datePreset(key) : null;
    if (r && r.from === from && r.to === to) return key;
  }
  return 'custom';
}

/**
 * A date range with quick choices (Today, This month, Last month, …) and
 * custom From/To dates.
 */
export function DateRangeFilter({ from, to, onChange, id = 'date-range' }: {
  from: string; to: string; onChange: (from: string, to: string) => void; id?: string;
}) {
  const preset = currentPreset(from, to);
  return (
    <div className="date-range" id={id}>
      <Calendar size={15} className="date-range__icon" aria-hidden="true" />
      <select
        aria-label="Date range"
        className={`date-range__preset${from || to ? ' date-range__preset--active' : ''}`}
        value={preset}
        onChange={(e) => {
          const r = datePreset(e.target.value);
          if (e.target.value === 'custom') onChange(from || iso(new Date()), to || iso(new Date()));
          else onChange(r?.from ?? '', r?.to ?? '');
        }}
      >
        {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        <option value="custom">Custom dates…</option>
      </select>
      {preset === 'custom' && (
        <>
          <input type="date" aria-label="From date" className="date-range__date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} />
          <span className="date-range__sep">to</span>
          <input type="date" aria-label="To date" className="date-range__date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} />
        </>
      )}
    </div>
  );
}
