// Sales & customers upgrade (roadmap items 9, 11, 13-16): quotations, sales report, sales performance,
// sales targets, selling price levels and customer credit terms.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPatch, apiPost, apiPut, getViewBranch } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';
import { DownloadDocButton } from './DownloadDocButton';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { downloadDocument, money as pdfMoney, dateOnly, safeName } from '../utils/documentPdf';

const money = (n: number) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const thisMonth = () => iso(new Date()).slice(0, 7);
const box: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 };
const Card = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div style={box}><div className="mm-sub" style={{ display: 'block' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#b91c1c' : '#0f172a' }}>{value}</div></div>
);
const Field = ({ label, children, min }: { label: string; children: React.ReactNode; min?: number }) => (
  <label className="form-field" style={{ margin: 0, minWidth: min }}><span className="form-field__label">{label}</span>{children}</label>
);
const Head = ({ title, sub }: { title: string; sub: string }) => (<>
  <h3 style={{ margin: '0 0 4px' }}>{title}</h3>
  <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>{sub}</p>
</>);
const Bar = ({ percent }: { percent: number }) => (
  <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8, minWidth: 90, overflow: 'hidden' }} title={`${percent}%`}>
    <div style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: '100%', background: percent >= 100 ? '#066006' : percent >= 60 ? '#0d9488' : '#d97706' }} />
  </div>
);
const QUOTE_COLOR: Record<string, string> = { SENT: '#0369a1', DRAFT: '#64748b', CONVERTED: '#066006', EXPIRED: '#b45309', CANCELLED: '#b91c1c' };
const QUOTE_WORD: Record<string, string> = { SENT: 'Open', DRAFT: 'Open', CONVERTED: 'Sold', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

function downloadQuotation(q: any) {
  return downloadDocument({
    title: 'QUOTATION',
    numberLine: `Quotation # ${q.quotation_number}`,
    issuer: [q.branch_name],
    left: [['Date', dateOnly(q.created_at)], ['Valid Until', dateOnly(q.valid_until)], ['Customer', q.customer], ['Phone', q.customer_phone], ['Prepared By', q.created_by_name]],
    right: [['Status', QUOTE_WORD[q.status] || q.status], ['Price Level', q.price_level_name || 'Retail'], ['Total', pdfMoney(q.total_amount)]],
    table: {
      head: ['PRODUCT', 'SKU', 'QTY', 'UNIT PRICE', 'DISCOUNT', 'SUB TOTAL'],
      rows: (q.lines || []).map((l: any) => [l.product_name, l.sku || '', String(l.quantity), pdfMoney(l.unit_price), l.discount_amount > 0.004 ? `-${pdfMoney(l.discount_amount)}` : pdfMoney(0), pdfMoney(l.line_total)]),
      align: ['left', 'left', 'center', 'right', 'right', 'right'], widths: [0, 28, 12, 25, 24, 27],
    },
    totals: [
      { label: 'Before Discount', value: pdfMoney(Number(q.total_amount) + Number(q.discount_amount || 0)) },
      ...(Number(q.discount_amount) > 0 ? [{ label: 'Discount', value: `-${pdfMoney(q.discount_amount)}` }] : []),
      { label: 'TOTAL', value: pdfMoney(q.total_amount), strong: true },
    ],
    ...(q.notes ? { extra: { title: 'Notes', rows: [['', q.notes]] as [string, string][] } } : {}),
    footer: `These prices are valid until ${dateOnly(q.valid_until)}.`,
    fileName: `Quotation-${safeName(q.quotation_number)}`,
  });
}

/** Quotations: make one, give it to the customer as a PDF, and turn it into a sale later. */
export function QuotationsPanel() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const { branchId: myBranch } = useAuth();
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ customerId: '', customerLabel: '', customerName: '', branchId: myBranch || getViewBranch() || '', validDays: '14', notes: '' });
  const [lines, setLines] = useState<{ productId: string; name: string; price: number; quantity: string; discount: string }[]>([]);
  const [levelPrices, setLevelPrices] = useState<Record<string, number>>({});
  const load = useCallback(() => apiGet<any>('/sales/quotations').then((d) => setList(d.quotations)).catch((e) => { addToast('error', e?.message); setList([]); }), [addToast]);
  useEffect(() => { load(); apiGet<any[]>('/branches').then((b) => setBranches(b || [])).catch(() => {}); }, [load]);
  useEffect(() => {
    setLevelPrices({});
    if (!form.customerId) return;
    apiGet<any>(`/sales/customers/${form.customerId}/credit`).then((c) => c.price_level_id ? apiGet<any>(`/sales/price-levels/${c.price_level_id}/prices`).then((d) => setLevelPrices(d.prices || {})) : null).catch(() => {});
  }, [form.customerId]);
  const priceOf = (l: { productId: string; price: number }) => levelPrices[l.productId] ?? l.price;
  const total = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * priceOf(l) - (Number(l.discount) || 0), 0);
  const save = async () => {
    if (!form.branchId) { addToast('error', 'Choose the branch of the quotation.'); return; }
    if (!lines.length) { addToast('error', 'Add at least one product.'); return; }
    setBusy(true);
    try {
      const q: any = await apiPost('/sales/quotations', {
        branchId: form.branchId, customerId: form.customerId || undefined, customerName: form.customerName || undefined, validDays: Number(form.validDays), notes: form.notes,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), discountAmount: Number(l.discount || 0) })),
      });
      addToast('success', `Quotation ${q.quotation_number} saved: ${money(q.total_amount)}.`);
      setOpen(false); setLines([]); setForm((p) => ({ ...p, customerId: '', customerLabel: '', customerName: '', notes: '' })); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const pdf = async (id: string) => downloadQuotation(await apiGet<any>(`/sales/quotations/${id}`));
  const cancel = async (q: any) => {
    if (!window.confirm(`Cancel quotation ${q.quotation_number}?`)) return;
    try { await apiPatch(`/sales/quotations/${q.id}`, { status: 'CANCELLED' }); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const extend = async (q: any) => {
    try { await apiPatch(`/sales/quotations/${q.id}`, { validDays: 14 }); addToast('success', 'Valid for 14 more days from today.'); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const cols: Column<any>[] = [
    { key: 'quotation_number', label: 'Quotation', render: (q) => <span><strong style={{ fontFamily: 'monospace' }}>{q.quotation_number}</strong><span className="mm-sub">{new Date(q.created_at).toLocaleDateString()}{q.branch_name ? ` · ${q.branch_name}` : ''}</span></span> },
    { key: 'customer', label: 'Customer', render: (q) => <span>{q.customer}{q.price_level_name ? <span className="mm-sub">{q.price_level_name} prices</span> : null}</span> },
    { key: 'total_amount', label: 'Total', render: (q) => <strong>{money(q.total_amount)}</strong> },
    { key: 'valid_until', label: 'Valid until', render: (q) => new Date(q.valid_until).toLocaleDateString() },
    { key: 'status', label: 'Status', render: (q) => <span><strong style={{ color: QUOTE_COLOR[q.status] || '#334155' }}>{QUOTE_WORD[q.status] || q.status}</strong>{q.converted_order_number ? <span className="mm-sub">{q.converted_order_number}</span> : null}</span> },
    { key: 'actions', label: '', render: (q) => (
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <DownloadDocButton small label="PDF" make={() => pdf(q.id)} />
        {(q.status === 'SENT' || q.status === 'DRAFT') && <button className="btn btn--primary btn--sm quote-convert" onClick={() => navigate(`/sales/new?quotation=${q.id}`)}>Make it a sale</button>}
        {q.status === 'EXPIRED' && <button className="btn btn--secondary btn--sm" onClick={() => extend(q)}>Extend</button>}
        {(q.status === 'SENT' || q.status === 'DRAFT' || q.status === 'EXPIRED') && <button className="btn btn--secondary btn--sm" onClick={() => cancel(q)}>Cancel</button>}
      </span>) },
  ];
  return (
    <div id="quotations-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Head title="Quotations" sub="A price offer for a customer. It keeps its prices until it expires, and becomes a sale with one click. The quotation itself is kept." />
        <button className="btn btn--primary" id="new-quotation" onClick={() => setOpen(true)}>New quotation</button>
      </div>
      {!list ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="quotations-table" data={list} columns={cols} keyExtractor={(q) => q.id} emptyMessage="No quotations yet." />}
      <Modal open={open} onClose={() => setOpen(false)} title="New quotation" size="lg"
        footer={<><button className="btn btn--secondary" onClick={() => setOpen(false)}>Close</button><button className="btn btn--primary" id="save-quotation" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Save quotation · ${money(total)}`}</button></>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <label className="form-field"><span className="form-field__label">Customer</span>
            <SearchableSelect id="quote-customer" options={[]} value={form.customerId} selectedLabel={form.customerLabel} placeholder="Search customer…"
              loadOptions={async (q) => { const r = await apiGet<{ items: any[] }>('/sales/customers', { page: 1, pageSize: 25, q: q || undefined, sort: 'name', dir: 'asc' }); return r.items.map((c) => ({ value: c.id, label: c.name, sublabel: c.phone || undefined })); }}
              onChange={(v) => setForm((p) => ({ ...p, customerId: v, customerLabel: '' }))} /></label>
          {!form.customerId && <Field label="Or a name (not registered)"><input className="form-input" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Walk-in customer" /></Field>}
          {!myBranch && <Field label="Branch *"><select className="form-select" id="quote-branch" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}><option value="">— choose —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          <Field label="Valid for (days)"><input className="form-input" type="number" min="1" max="365" value={form.validDays} onChange={(e) => setForm({ ...form, validDays: e.target.value })} /></Field>
        </div>
        <label className="form-field" style={{ marginTop: 12 }}><span className="form-field__label">Add a product</span>
          <SearchableSelect id="quote-product" options={[]} value="" placeholder="Search product by name or SKU…"
            loadOptions={async (q) => {
              const r = await apiGet<{ items: any[] }>('/products', { page: 1, pageSize: 25, q: q || undefined, sort: 'name', dir: 'asc', status: 'active' });
              return r.items.map((p) => ({ value: `${p.id}|${Number(p.selling_price) || 0}|${p.name}`, label: p.name, sublabel: `${p.sku} · ${money(Number(p.selling_price) || 0)}` }));
            }}
            onChange={(v) => {
              const [id, price, ...name] = v.split('|');
              if (!id || lines.some((l) => l.productId === id)) return;
              setLines((p) => [...p, { productId: id, name: name.join('|'), price: Number(price), quantity: '1', discount: '' }]);
            }} /></label>
        {lines.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Product</th><th>Qty</th><th>Price</th><th>Discount</th><th>Total</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={l.productId}>
                  <td>{l.name}</td>
                  <td><input className="form-input quote-qty" style={{ width: 70 }} type="number" min="1" step="1" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></td>
                  <td style={{ textAlign: 'right' }}>{money(priceOf(l))}</td>
                  <td><input className="form-input" style={{ width: 90 }} type="number" min="0" step="0.01" value={l.discount} placeholder="0.00" onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, discount: e.target.value } : x))} /></td>
                  <td style={{ textAlign: 'right' }}><strong>{money((Number(l.quantity) || 0) * priceOf(l) - (Number(l.discount) || 0))}</strong></td>
                  <td><button className="btn btn--secondary btn--sm" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <label className="form-field" style={{ marginTop: 12 }}><span className="form-field__label">Notes for the customer</span>
          <input className="form-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <p className="mm-sub" style={{ display: 'block', margin: '8px 0 0' }}>Prices are the product's price (or the customer's price level) at the moment of saving.</p>
      </Modal>
    </div>
  );
}

/** Sales per day, month or year: gross, discounts, returns and net. */
export function SalesReport() {
  const { addToast } = useToast();
  const [group, setGroup] = useState<'day' | 'month' | 'year'>('day');
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [sellerId, setSellerId] = useState('');
  const [sellers, setSellers] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  useEffect(() => { apiGet<any>('/sales/sellers').then((d) => setSellers(d.sellers || [])).catch(() => {}); }, []);
  useEffect(() => {
    setData(null);
    apiGet<any>('/sales/sales-report', { group, from, to, sellerId: sellerId || undefined }).then(setData).catch((e) => { addToast('error', e?.message); setData({ rows: [], totals: {} }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, from, to, sellerId]);
  const pick = (g: 'day' | 'month' | 'year') => {
    const y = new Date().getFullYear();
    setGroup(g); setTo(iso(new Date()));
    setFrom(g === 'day' ? `${thisMonth()}-01` : g === 'month' ? `${y}-01-01` : `${y - 4}-01-01`);
  };
  const label = (p: string) => group === 'day' ? new Date(`${p}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : group === 'month' ? new Date(`${p}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : p;
  const cols: Column<any>[] = [
    { key: 'period', label: group === 'day' ? 'Day' : group === 'month' ? 'Month' : 'Year', render: (r) => <strong>{label(r.period)}</strong> },
    { key: 'sales', label: 'Sales' },
    { key: 'gross', label: 'Gross sales', render: (r) => money(r.gross) },
    { key: 'discounts', label: 'Discounts', render: (r) => r.discounts > 0 ? <span style={{ color: '#b45309' }}>-{money(r.discounts)}</span> : '—' },
    { key: 'returns', label: 'Returns', render: (r) => r.returns > 0 ? <span style={{ color: '#b91c1c' }}>-{money(r.returns)}{r.return_count ? ` (${r.return_count})` : ''}</span> : '—' },
    { key: 'net', label: 'Net sales', render: (r) => <strong>{money(r.net)}</strong> },
  ];
  const t = data?.totals || {};
  return (
    <div id="sales-report">
      <Head title="Sales report" sub="Sales by the day they were invoiced. Net sales = gross sales − discounts − returns. Cancelled sales are not counted." />
      <div style={row}>
        {(['day', 'month', 'year'] as const).map((g) => <button key={g} className={`btn btn--sm ${group === g ? 'btn--primary' : 'btn--secondary'}`} onClick={() => pick(g)}>{g === 'day' ? 'Daily' : g === 'month' ? 'Monthly' : 'Yearly'}</button>)}
        <Field label="From"><input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {sellers.length > 1 && <Field label="Sold by" min={180}><select className="form-select" value={sellerId} onChange={(e) => setSellerId(e.target.value)}><option value="">Everyone</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.branch_name ? ` · ${s.branch_name}` : ''}</option>)}</select></Field>}
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Sales" value={String(t.sales || 0)} /><Card label="Gross sales" value={money(t.gross)} /><Card label="Discounts" value={money(t.discounts)} />
          <Card label="Returns" value={money(t.returns)} warn={t.returns > 0} /><Card label="Net sales" value={money(t.net)} />
        </div>
        <DataTable id="sales-report-table" data={data.rows} columns={cols} keyExtractor={(r) => r.period} emptyMessage="No sales in this period." />
      </>)}
    </div>
  );
}

/** Who sold how much. */
export function SalesPerformance() {
  const { addToast } = useToast();
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    apiGet<any>('/sales/performance', { from, to }).then(setData).catch((e) => { addToast('error', e?.message); setData({ rows: [], totals: {} }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const cols: Column<any>[] = [
    { key: 'rank', label: '#', render: (r) => r.rank },
    { key: 'full_name', label: 'Employee', render: (r) => <span><strong>{r.full_name}</strong>{r.branch_name ? <span className="mm-sub">{r.branch_name}</span> : null}</span> },
    { key: 'sales', label: 'Sales' },
    { key: 'gross', label: 'Gross', render: (r) => money(r.gross) },
    { key: 'discounts', label: 'Discounts given', render: (r) => r.discounts > 0 ? <span style={{ color: '#b45309' }}>{money(r.discounts)}</span> : '—' },
    { key: 'returns', label: 'Returns', render: (r) => r.returns > 0 ? <span style={{ color: '#b91c1c' }}>{money(r.returns)}</span> : '—' },
    { key: 'net', label: 'Net sales', render: (r) => <strong>{money(r.net)}</strong> },
    { key: 'average', label: 'Average sale', render: (r) => money(r.average) },
    { key: 'share', label: 'Share', render: (r) => <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Bar percent={r.share} />{r.share}%</span> },
  ];
  const t = data?.totals || {};
  return (
    <div id="sales-performance">
      <Head title="Sales by employee" sub="Each seller's invoiced sales in the period, less discounts and returns. Cancelled sales are not counted." />
      <div style={row}>
        <Field label="From"><input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Sellers" value={String(data.rows.length)} /><Card label="Sales" value={String(t.sales || 0)} /><Card label="Net sales" value={money(t.net)} /><Card label="Discounts given" value={money(t.discounts)} />
        </div>
        <DataTable id="performance-table" data={data.rows} columns={cols} keyExtractor={(r) => r.user_id || 'x'} emptyMessage="No sales in this period." />
      </>)}
    </div>
  );
}

/** Monthly sales targets for employees, branches and the company, with progress. */
export function SalesTargets() {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState(thisMonth());
  const [data, setData] = useState<any[] | null>(null);
  const [sellers, setSellers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [form, setForm] = useState({ scopeType: 'EMPLOYEE', scopeId: '', amount: '' });
  const load = useCallback(() => { setData(null); apiGet<any>('/sales/targets', { period }).then((d) => setData(d.targets)).catch((e) => { addToast('error', e?.message); setData([]); }); }, [period, addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!isAdmin) return; apiGet<any>('/sales/sellers').then((d) => setSellers(d.sellers || [])).catch(() => {}); apiGet<any[]>('/branches').then((b) => setBranches(b || [])).catch(() => {}); }, [isAdmin]);
  const save = async (body: any, done: string) => { try { await apiPut('/sales/targets', body); addToast('success', done); load(); } catch (e: any) { addToast('error', e?.message); } };
  const add = () => {
    if (form.scopeType !== 'COMPANY' && !form.scopeId) { addToast('error', form.scopeType === 'EMPLOYEE' ? 'Choose the employee.' : 'Choose the branch.'); return; }
    if (!(Number(form.amount) > 0)) { addToast('error', 'Enter the target amount.'); return; }
    save({ ...form, amount: Number(form.amount), period }, 'Target saved.').then(() => setForm((p) => ({ ...p, scopeId: '', amount: '' })));
  };
  const cols: Column<any>[] = [
    { key: 'scope_name', label: 'Target for', render: (r) => <span><strong>{r.scope_name}</strong><span className="mm-sub">{r.scope_type === 'EMPLOYEE' ? 'Employee' : r.scope_type === 'BRANCH' ? 'Branch' : 'Company'}</span></span> },
    { key: 'amount', label: 'Target', render: (r) => money(r.amount) },
    { key: 'actual', label: 'Sold so far', render: (r) => <strong>{money(r.actual)}</strong> },
    { key: 'remaining', label: 'Still to sell', render: (r) => r.remaining > 0 ? money(r.remaining) : <strong style={{ color: '#066006' }}>Reached</strong> },
    { key: 'percent', label: 'Progress', render: (r) => <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Bar percent={r.percent} /><strong>{r.percent}%</strong></span> },
    ...(isAdmin ? [{ key: 'actions', label: '', render: (r: any) => <span style={{ display: 'flex', gap: 6 }}>
      <button className="btn btn--secondary btn--sm" onClick={() => { const v = window.prompt(`New target for ${r.scope_name}`, String(r.amount)); if (v && Number(v) > 0) save({ scopeType: r.scope_type, scopeId: r.scope_id, period, amount: Number(v) }, 'Target changed.'); }}>Change</button>
      <button className="btn btn--secondary btn--sm" onClick={() => { if (window.confirm(`Remove the target of ${r.scope_name}?`)) save({ scopeType: r.scope_type, scopeId: r.scope_id, period, amount: 0 }, 'Target removed.'); }}>Remove</button></span> }] : []),
  ];
  return (
    <div id="sales-targets">
      <Head title="Sales targets" sub="A target is an amount of net sales for one month. Progress counts invoiced sales less discounts and returns." />
      <div style={row}>
        <Field label="Month"><input className="form-input" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></Field>
        {isAdmin && (<>
          <Field label="New target for"><select className="form-select" id="target-type" value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value, scopeId: '' })}><option value="EMPLOYEE">An employee</option><option value="BRANCH">A branch</option><option value="COMPANY">The whole company</option></select></Field>
          {form.scopeType === 'EMPLOYEE' && <Field label="Employee" min={180}><select className="form-select" id="target-who" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}><option value="">— choose —</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.branch_name ? ` · ${s.branch_name}` : ''}</option>)}</select></Field>}
          {form.scopeType === 'BRANCH' && <Field label="Branch" min={180}><select className="form-select" id="target-who" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}><option value="">— choose —</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          <Field label="Amount ($)"><input className="form-input" id="target-amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <button className="btn btn--primary" id="target-save" onClick={add}>Set target</button>
        </>)}
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="targets-table" data={data} columns={cols} keyExtractor={(r) => r.id} emptyMessage="No targets for this month yet." />}
    </div>
  );
}

/** Products → edit: what this product costs at each selling price level (Wholesale, Employee…). */
export function ProductLevelPrices({ productId, regularPrice, isOwner }: { productId: string; regularPrice: number; isOwner: boolean }) {
  const { addToast } = useToast();
  const [levels, setLevels] = useState<any[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const load = useCallback(() => apiGet<any>(`/sales/products/${productId}/level-prices`).then((d) => { setLevels(d.levels); setVals(Object.fromEntries(d.levels.map((l: any) => [l.level_id, l.price === null ? '' : String(l.price)]))); }).catch(() => setLevels([])), [productId]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/sales/products/${productId}/level-prices`, { prices: (levels || []).filter((l) => Number(l.is_default) !== 1).map((l) => ({ levelId: l.level_id, price: vals[l.level_id] === '' ? null : Number(vals[l.level_id]) })) });
      addToast('success', 'Level prices saved.'); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const addLevel = async () => {
    if (!newName.trim()) return;
    try { await apiPost('/sales/price-levels', { name: newName.trim() }); setNewName(''); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  if (!levels || levels.length < 2) return null;
  return (
    <details id="level-prices" style={{ ...box, marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Prices by customer level</summary>
      <p className="mm-sub" style={{ display: 'block', margin: '8px 0' }}>A customer's level is set on the customer. Leave a level empty to use the regular price ({money(regularPrice)}).</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {levels.map((l) => (
          <label key={l.level_id} className="form-field" style={{ margin: 0 }}><span className="form-field__label">{l.name}</span>
            {Number(l.is_default) === 1
              ? <input className="form-input" value={regularPrice.toFixed(2)} disabled title="The product's regular price" />
              : <input className="form-input level-price" data-level={l.name} type="number" min="0" step="0.01" disabled={!isOwner} value={vals[l.level_id] ?? ''} placeholder={regularPrice.toFixed(2)} onChange={(e) => setVals((p) => ({ ...p, [l.level_id]: e.target.value }))} />}
          </label>))}
      </div>
      {isOwner && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          <button type="button" className="btn btn--primary btn--sm" id="save-level-prices" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save level prices'}</button>
          <input className="form-input" style={{ width: 170 }} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Another level, e.g. VIP" />
          <button type="button" className="btn btn--secondary btn--sm" disabled={!newName.trim()} onClick={addLevel}>Add level</button>
        </div>
      )}
    </details>
  );
}

/** Customer → statement: credit limit, days to pay, price level, and what is overdue. */
export function CustomerCreditBox({ customerId }: { customerId: string }) {
  const { addToast } = useToast();
  const { isAdmin } = useAuth();
  const [cr, setCr] = useState<any>(null);
  const [levels, setLevels] = useState<any[]>([]);
  const [form, setForm] = useState({ creditLimit: '', creditDays: '', priceLevelId: '' });
  const [busy, setBusy] = useState(false);
  const apply = (d: any) => { setCr(d); setForm({ creditLimit: d.credit_limit ? String(d.credit_limit) : '', creditDays: String(d.credit_days), priceLevelId: d.price_level_id || '' }); };
  useEffect(() => {
    setCr(null);
    apiGet<any>(`/sales/customers/${customerId}/credit`).then(apply).catch(() => {});
    apiGet<any>('/sales/price-levels').then((d) => setLevels((d.levels || []).filter((l: any) => Number(l.is_active) === 1))).catch(() => {});
  }, [customerId]);
  const save = async () => {
    setBusy(true);
    try { apply(await apiPut(`/sales/customers/${customerId}/credit`, { creditLimit: Number(form.creditLimit || 0), creditDays: Number(form.creditDays || 30), priceLevelId: form.priceLevelId || null })); addToast('success', 'Customer terms saved.'); }
    catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  if (!cr) return null;
  const levelName = levels.find((l) => l.id === cr.price_level_id)?.name || 'Retail';
  return (
    <div id="customer-credit" style={{ ...box, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, marginBottom: isAdmin ? 10 : 0 }}>
        <span>Price level: <strong>{levelName}</strong></span>
        <span>Credit limit: <strong>{cr.credit_limit > 0 ? money(cr.credit_limit) : 'No limit set'}</strong></span>
        {cr.credit_limit > 0 && <span style={{ color: cr.over_limit ? '#b91c1c' : undefined }}>Available: <strong>{money(Math.max(0, cr.available))}</strong>{cr.over_limit ? ' (over the limit)' : ''}</span>}
        <span>Days to pay: <strong>{cr.credit_days}</strong></span>
        {cr.overdue_invoices > 0 && <strong style={{ color: '#b91c1c' }}>Overdue: {money(cr.overdue_amount)} on {cr.overdue_invoices} invoice{cr.overdue_invoices > 1 ? 's' : ''}, up to {cr.oldest_overdue_days} days late</strong>}
      </div>
      {isAdmin && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Credit limit ($, 0 = none)"><input className="form-input" id="credit-limit" type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} placeholder="0" style={{ width: 150 }} /></Field>
          <Field label="Days to pay"><input className="form-input" id="credit-days" type="number" min="1" max="365" value={form.creditDays} onChange={(e) => setForm({ ...form, creditDays: e.target.value })} style={{ width: 100 }} /></Field>
          <Field label="Price level"><select className="form-select" id="credit-level" value={form.priceLevelId} onChange={(e) => setForm({ ...form, priceLevelId: e.target.value })}><option value="">Retail (regular price)</option>{levels.filter((l) => Number(l.is_default) !== 1).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <button className="btn btn--primary" id="credit-save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save terms'}</button>
        </div>
      )}
    </div>
  );
}
