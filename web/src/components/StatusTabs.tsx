/**
 * Status filter as tabs with counts from the server (across all records that
 * match the other filters), e.g. All (120) · Drafts (4) · Paid (80).
 */
export function StatusTabs({ tabs, value, counts, onChange, id }: {
  tabs: { key: string; label: string }[];
  value: string;
  counts?: Record<string, number>;
  onChange: (key: string) => void;
  id: string;
}) {
  const active = value || 'ALL';
  return (
    <div className="status-tabs" role="tablist" id={id}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`status-tab${active === t.key ? ' status-tab--active' : ''}`}
          onClick={() => onChange(t.key === 'ALL' ? '' : t.key)}
        >
          {t.label}
          {counts && <span className="status-tab__count">{(counts[t.key] ?? 0).toLocaleString()}</span>}
        </button>
      ))}
    </div>
  );
}
