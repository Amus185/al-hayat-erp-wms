// Dashboard blocks added by the roadmap (item 26) and the per-person "Customize" chooser.
// Each block loads its own data through endpoints that already apply permissions and branch.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { apiGet, apiPut } from '../api/client';
import { Modal } from './Modal';
import { useToast } from '../contexts/ToastContext';

const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const today = () => new Date().toISOString().slice(0, 10);

export interface WidgetDef { id: string; label: string; perm?: (has: (p: string) => boolean) => boolean }
export const WIDGETS: WidgetDef[] = [
  { id: 'inventory-cards', label: 'Stock figures' },
  { id: 'finance-cards', label: 'Customer and supplier balances' },
  { id: 'sales-today', label: 'Sales today and this month', perm: (h) => h('manage_sales') },
  { id: 'targets', label: 'Sales targets', perm: (h) => h('manage_sales') },
  { id: 'credit-watch', label: 'Customers over their limit or overdue', perm: (h) => h('manage_sales') },
  { id: 'attendance-today', label: 'Attendance today', perm: (h) => h('manage_users') || h('employees.manage') || h('payroll.manage') },
  { id: 'low-stock', label: 'Low stock' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'transfers', label: 'Transfers queue' },
];
export const DEFAULT_WIDGETS = ['inventory-cards', 'finance-cards', 'sales-today', 'targets', 'low-stock', 'alerts', 'transfers'];

const Panel = ({ kicker, title, action, children }: { kicker: string; title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <div className="panel" style={{ gridColumn: '1 / -1' }}>
    <div className="panel__header"><div><p>{kicker}</p><h2>{title}</h2></div>{action}</div>
    {children}
  </div>
);
const Stat = ({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) => (
  <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#fff' }}>
    <div className="mm-sub" style={{ display: 'block' }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, color: warn ? '#b91c1c' : '#0f172a' }}>{value}</div>
    {sub && <div className="mm-sub" style={{ display: 'block' }}>{sub}</div>}
  </div>
);
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 };

export function SalesTodayWidget() {
  const navigate = useNavigate();
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const t = today();
    Promise.all([
      apiGet<any>('/sales/sales-report', { group: 'day', from: t, to: t }),
      apiGet<any>('/sales/sales-report', { group: 'month', from: `${t.slice(0, 7)}-01`, to: t }),
    ]).then(([a, b]) => setD({ day: a.totals, month: b.totals })).catch(() => setD({ day: {}, month: {} }));
  }, []);
  return (
    <Panel kicker="Sales" title="Today and this month" action={<button type="button" className="btn btn-secondary" onClick={() => navigate('/reports')}>Sales report</button>}>
      {!d ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (
        <div style={grid}>
          <Stat label="Net sales today" value={money(d.day.net)} sub={`${d.day.sales || 0} sales`} />
          <Stat label="Discounts today" value={money(d.day.discounts)} />
          <Stat label="Net sales this month" value={money(d.month.net)} sub={`${d.month.sales || 0} sales`} />
          <Stat label="Returns this month" value={money(d.month.returns)} warn={Number(d.month.returns) > 0} />
        </div>
      )}
    </Panel>
  );
}

export function TargetsWidget() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { apiGet<any>('/sales/targets').then((d) => setRows(d.targets)).catch(() => setRows([])); }, []);
  return (
    <Panel kicker="Targets" title="This month's sales targets">
      {!rows ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : !rows.length ? <p className="mm-sub" style={{ display: 'block' }}>No targets set for this month (Reports → Sales Targets).</p> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.slice(0, 6).map((r) => (
            <div key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><strong>{r.scope_name}</strong><span>{money(r.actual)} of {money(r.amount)} · <strong>{r.percent}%</strong></span></div>
              <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8, overflow: 'hidden', marginTop: 4 }}><div style={{ width: `${Math.min(100, r.percent)}%`, height: '100%', background: r.percent >= 100 ? '#066006' : '#0d9488' }} /></div>
            </div>))}
        </div>
      )}
    </Panel>
  );
}

export function CreditWatchWidget() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { apiGet<any>('/sales/credit-watch').then((d) => setRows(d.customers)).catch(() => setRows([])); }, []);
  return (
    <Panel kicker="Credit control" title="Customers to follow up" action={<button type="button" className="btn btn-secondary" onClick={() => navigate('/customers')}>Customers</button>}>
      {!rows ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : !rows.length ? <p className="mm-sub" style={{ display: 'block' }}>Nobody is over their limit or overdue.</p> : (
        <ul className="alert-list">
          {rows.slice(0, 8).map((r) => (
            <li key={r.customer_id}><strong>{r.customer_name}</strong><span>owes {money(r.outstanding)}{r.over_limit ? ` · over the ${money(r.credit_limit)} limit` : ''}{r.overdue_invoices ? ` · ${money(r.overdue_amount)} overdue (${r.oldest_overdue_days} days)` : ''}</span></li>))}
        </ul>
      )}
    </Panel>
  );
}

export function AttendanceWidget() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { apiGet<any>('/hr/attendance', { date: today() }).then((d) => setRows(d.rows)).catch(() => setRows([])); }, []);
  const n = (s: string | null) => (rows || []).filter((r) => (r.status || null) === s).length;
  return (
    <Panel kicker="People" title="Attendance today" action={<button type="button" className="btn btn-secondary" onClick={() => navigate('/employees')}>Mark attendance</button>}>
      {!rows ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (
        <div style={grid}>
          <Stat label="Present" value={String(n('PRESENT'))} /><Stat label="Late" value={String(n('LATE'))} warn={n('LATE') > 0} />
          <Stat label="Absent" value={String(n('ABSENT'))} warn={n('ABSENT') > 0} /><Stat label="On leave" value={String(n('LEAVE'))} />
          <Stat label="Not marked yet" value={String(n(null))} />
        </div>
      )}
    </Panel>
  );
}

/** Choose and order the blocks of your own dashboard. */
export function CustomizeDashboard({ open, onClose, available, value, onSaved }: { open: boolean; onClose: () => void; available: WidgetDef[]; value: string[]; onSaved: (w: string[]) => void }) {
  const { addToast } = useToast();
  const [list, setList] = useState<string[]>(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setList(value); }, [open, value]);
  const hidden = available.filter((w) => !list.includes(w.id));
  const label = (id: string) => available.find((w) => w.id === id)?.label || id;
  const move = (i: number, d: number) => setList((p) => { const c = [...p]; const j = i + d; if (j < 0 || j >= c.length) return c; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const save = async () => {
    setBusy(true);
    try { await apiPut('/settings/preferences/dashboard', { value: { widgets: list } }); onSaved(list); addToast('success', 'Your dashboard is saved.'); onClose(); }
    catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Customize your dashboard"
      footer={<><button className="btn btn--secondary" onClick={() => setList(DEFAULT_WIDGETS.filter((id) => available.some((w) => w.id === id)))}>Standard</button><button className="btn btn--primary" id="dash-save" disabled={busy} onClick={save}>Save</button></>}>
      <p className="mm-sub" style={{ display: 'block', marginTop: 0 }}>Only you see this arrangement. Blocks show what your access and branch allow.</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {list.filter((id) => available.some((w) => w.id === id)).map((id, i) => (
          <div key={id} className="dash-widget-row" style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px' }}>
            <input type="checkbox" checked onChange={() => setList((p) => p.filter((x) => x !== id))} aria-label={`Hide ${label(id)}`} />
            <span style={{ flex: 1 }}>{label(id)}</span>
            <button type="button" className="mm-icon" aria-label="Up" onClick={() => move(list.indexOf(id), -1)} disabled={i === 0}><ArrowUp size={14} /></button>
            <button type="button" className="mm-icon" aria-label="Down" onClick={() => move(list.indexOf(id), 1)}><ArrowDown size={14} /></button>
          </div>))}
        {hidden.map((w) => (
          <label key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px dashed #cbd5e1', borderRadius: 8, padding: '6px 10px', color: '#64748b' }}>
            <input type="checkbox" className="dash-add" data-widget={w.id} checked={false} onChange={() => setList((p) => [...p, w.id])} /> {w.label}
          </label>))}
      </div>
    </Modal>
  );
}
