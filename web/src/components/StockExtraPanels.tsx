// Inventory upgrade (roadmap items 19-21): product variants, serial numbers / batches with
// traceability, and profit by location.
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { SearchableSelect } from './SearchableSelect';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

const money = (n: number) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const box: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' };
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 };
const Field = ({ label, children, min }: { label: string; children: React.ReactNode; min?: number }) => (
  <label className="form-field" style={{ margin: 0, minWidth: min }}><span className="form-field__label">{label}</span>{children}</label>
);
const Card = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div style={box}><div className="mm-sub" style={{ display: 'block' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#b91c1c' : '#0f172a' }}>{value}</div></div>
);
const TRACK_WORD: Record<string, string> = { NONE: 'No tracking', BATCH: 'Batches', SERIAL: 'Serial numbers' };

/** Products → edit: variants (size, colour…) and serial / batch tracking. */
export function ProductVariantsAndTracking({ productId, isOwner, tracking: initialTracking, onChanged }: { productId: string; isOwner: boolean; tracking?: string; onChanged?: () => void }) {
  const { addToast } = useToast();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ label: '', sku: '', sellingPrice: '' });
  const [tracking, setTracking] = useState(initialTracking || 'NONE');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiGet<any>(`/products/${productId}/variants`).then(setData).catch(() => setData({ variants: [] })), [productId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setTracking(initialTracking || 'NONE'); }, [initialTracking]);
  const add = async () => {
    if (!form.label.trim()) { addToast('error', 'Describe the variant, e.g. "Red / Large".'); return; }
    setBusy(true);
    try {
      const v: any = await apiPost(`/products/${productId}/variants`, { label: form.label.trim(), sku: form.sku.trim() || undefined, sellingPrice: form.sellingPrice === '' ? undefined : Number(form.sellingPrice) });
      addToast('success', `Variant ${v.name} added (${v.sku}).`); setForm({ label: '', sku: '', sellingPrice: '' }); load(); onChanged?.();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const saveTracking = async (v: string) => {
    const old = tracking; setTracking(v);
    try { await apiPut(`/products/${productId}/tracking`, { tracking: v }); addToast('success', `${TRACK_WORD[v]} for this product.`); onChanged?.(); }
    catch (e: any) { setTracking(old); addToast('error', e?.message); }
  };
  if (!data) return null;
  const isVariant = data.parent_id !== productId;
  return (
    <details id="variants-tracking" style={{ ...box, marginTop: 12 }} open={data.variants.length > 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Variants and serial numbers{data.variants.length ? ` · ${data.variants.length} variant${data.variants.length > 1 ? 's' : ''}` : ''}</summary>
      <div style={{ ...row, marginTop: 10 }}>
        <Field label="Track this product by"><select className="form-select" id="product-tracking" value={tracking} disabled={!isOwner} onChange={(e) => saveTracking(e.target.value)}>
          <option value="NONE">No tracking</option><option value="BATCH">Batches (one code per delivery)</option><option value="SERIAL">Serial numbers (one per unit)</option></select></Field>
        <span className="mm-sub" style={{ display: 'block', maxWidth: 360, paddingBottom: 6 }}>Codes are entered (or numbered automatically) when goods are received; sales take the oldest first.</span>
      </div>
      {isVariant ? (
        <p className="mm-sub" style={{ display: 'block', margin: 0 }}>This is a variant of <strong>{data.parent?.name}</strong>. Other variants: {data.variants.filter((v: any) => v.id !== productId).map((v: any) => v.variant_label).join(', ') || 'none'}.</p>
      ) : (<>
        {data.variants.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Variant</th><th style={{ textAlign: 'left' }}>SKU</th><th>Price</th><th>In stock</th></tr></thead>
              <tbody>{data.variants.map((v: any) => (
                <tr key={v.id} style={{ opacity: Number(v.is_active) === 1 ? 1 : 0.5 }}><td><strong>{v.variant_label}</strong></td><td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.sku}</td><td style={{ textAlign: 'right' }}>{money(v.selling_price)}</td><td style={{ textAlign: 'center' }}>{v.on_hand}</td></tr>))}
              </tbody>
            </table>
          </div>
        )}
        {isOwner && (
          <div style={{ ...row, marginTop: 10, marginBottom: 0 }}>
            <Field label="New variant" min={160}><input className="form-input" id="variant-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Brown / 3-seater" /></Field>
            <Field label="SKU (optional)"><input className="form-input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="automatic" style={{ width: 150 }} /></Field>
            <Field label="Selling price (optional)"><input className="form-input" type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} placeholder="same as main" style={{ width: 130 }} /></Field>
            <button type="button" className="btn btn--primary" id="variant-add" disabled={busy} onClick={add}>Add variant</button>
          </div>
        )}
        <p className="mm-sub" style={{ display: 'block', margin: '8px 0 0' }}>Each variant is its own product: own SKU, own stock, own price. It appears in the product list and sells like any product.</p>
      </>)}
    </details>
  );
}

/** Inventory → Serials & batches: what is in stock, register codes for stock on hand, and trace a code. */
export function LotsPanel() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const [lots, setLots] = useState<any[] | null>(null);
  const [code, setCode] = useState('');
  const [trace, setTrace] = useState<any[] | null>(null);
  const [reg, setReg] = useState({ productId: '', productLabel: '', tracking: '', code: '', quantity: '', serials: '' });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiGet<any>('/inventory/lots').then((d) => setLots(d.lots)).catch((e) => { addToast('error', e?.message); setLots([]); }), [addToast]);
  useEffect(() => { load(); }, [load]);
  const find = async () => {
    if (!code.trim()) return;
    try { setTrace((await apiGet<any>('/inventory/lots/trace', { code: code.trim() })).lots); } catch (e: any) { addToast('error', e?.message); }
  };
  const register = async () => {
    setBusy(true);
    try {
      const r: any = await apiPost('/inventory/lots', { productId: reg.productId, code: reg.code || undefined, quantity: reg.quantity ? Number(reg.quantity) : undefined, serials: reg.tracking === 'SERIAL' ? reg.serials.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) : undefined });
      addToast('success', `${r.added} unit${r.added > 1 ? 's' : ''} registered.`); setReg({ productId: '', productLabel: '', tracking: '', code: '', quantity: '', serials: '' }); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const cols: Column<any>[] = [
    { key: 'product_name', label: 'Product', render: (l) => <span><strong>{l.product_name}</strong><span className="mm-sub">{l.sku}</span></span> },
    { key: 'code', label: 'Serial / batch', render: (l) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{l.code}</span> },
    { key: 'kind', label: 'Kind', render: (l) => l.kind === 'SERIAL' ? 'Serial' : 'Batch' },
    { key: 'quantity_left', label: 'In stock', render: (l) => l.kind === 'SERIAL' ? '1' : `${l.quantity_left} of ${l.quantity_in}` },
    { key: 'received_at', label: 'Received', render: (l) => <span>{new Date(l.received_at).toLocaleDateString()}{l.receipt_number ? <span className="mm-sub">{l.receipt_number}</span> : l.source_type === 'EXISTING_STOCK' ? <span className="mm-sub">Stock on hand</span> : null}</span> },
  ];
  return (
    <div id="lots-panel">
      <h3 style={{ margin: '0 0 4px' }}>Serial numbers and batches</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>For products tracked by serial number or batch (set in Products → edit). Sales take the oldest first; a cancelled sale gives them back.</p>
      <div style={{ ...box, marginBottom: 14 }}>
        <div style={row}>
          <Field label="Find a serial number or batch" min={240}><input className="form-input" id="trace-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find(); }} placeholder="e.g. SN-A1" /></Field>
          <button className="btn btn--primary" id="trace-find" onClick={find} disabled={!code.trim()}>Trace</button>
        </div>
        {trace && (trace.length === 0 ? <p className="mm-sub" style={{ display: 'block', margin: 0 }}>Nothing found for "{code}".</p> : trace.map((l) => (
          <div key={l.id} className="trace-result" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 10, marginTop: 10, fontSize: 13 }}>
            <div><strong style={{ fontFamily: 'monospace' }}>{l.code}</strong> · {l.product_name} · {l.quantity_left > 0 ? <strong style={{ color: '#066006' }}>in stock ({l.quantity_left})</strong> : <strong style={{ color: '#475569' }}>sold</strong>}</div>
            <div className="mm-sub" style={{ display: 'block' }}>Received {new Date(l.received_at).toLocaleDateString()}{l.receipt_number ? ` on ${l.receipt_number}` : ''}{l.supplier_name ? ` from ${l.supplier_name}` : ''}{l.po_number ? ` (${l.po_number})` : ''}{l.warehouse_name ? ` into ${l.warehouse_name}` : ''}</div>
            {(l.moves || []).map((m: any, i: number) => (
              <div key={i} style={{ marginLeft: 12 }}>{m.quantity < 0 ? '→ Sold' : '← Returned (sale cancelled)'} {Math.abs(m.quantity)} on {new Date(m.created_at).toLocaleDateString()}{m.invoice_number ? ` · ${m.invoice_number}` : ''}{m.order_number ? ` (${m.order_number})` : ''}{m.customer_name ? ` · ${m.customer_name}` : ''}{m.customer_phone ? ` ${m.customer_phone}` : ''}{m.branch_name ? ` · ${m.branch_name}` : ''}</div>
            ))}
          </div>)))}
      </div>
      {hasPermission('manage_inventory') && (
        <details style={{ ...box, marginBottom: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Give codes to stock already on hand</summary>
          <div style={{ ...row, marginTop: 10, marginBottom: 0 }}>
            <Field label="Product" min={240}>
              <SearchableSelect id="lot-product" options={[]} value={reg.productId} selectedLabel={reg.productLabel} placeholder="Search a tracked product…"
                loadOptions={async (q) => { const r = await apiGet<{ items: any[] }>('/products', { page: 1, pageSize: 25, q: q || undefined, sort: 'name', dir: 'asc' }); return r.items.filter((p) => p.tracking && p.tracking !== 'NONE').map((p) => ({ value: `${p.id}|${p.tracking}|${p.name}`, label: p.name, sublabel: TRACK_WORD[p.tracking] })); }}
                onChange={(v) => { const [id, tr, ...n] = v.split('|'); setReg((p) => ({ ...p, productId: id, tracking: tr, productLabel: n.join('|') })); }} />
            </Field>
            {reg.tracking === 'BATCH' && (<>
              <Field label="Batch code"><input className="form-input" value={reg.code} onChange={(e) => setReg({ ...reg, code: e.target.value })} /></Field>
              <Field label="Quantity"><input className="form-input" type="number" min="1" value={reg.quantity} onChange={(e) => setReg({ ...reg, quantity: e.target.value })} style={{ width: 100 }} /></Field>
            </>)}
            {reg.tracking === 'SERIAL' && <Field label="Serial numbers (one per line)" min={240}><textarea className="form-input" rows={3} value={reg.serials} onChange={(e) => setReg({ ...reg, serials: e.target.value })} /></Field>}
            <button className="btn btn--primary" disabled={busy || !reg.productId} onClick={register}>Register</button>
          </div>
        </details>
      )}
      {!lots ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="lots-table" data={lots} columns={cols} keyExtractor={(l) => l.id} emptyMessage="No tracked stock yet. Switch on batches or serial numbers in Products → edit." />}
    </div>
  );
}

/** Reports → Profit by location (from the books). */
export function ProfitByLocation() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const canCosts = hasPermission('costs.view');
  const [from, setFrom] = useState(`${iso(new Date()).slice(0, 7)}-01`);
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    apiGet<any>('/reports/profit-by-location', { from, to }).then(setData).catch((e) => { addToast('error', e?.message); setData({ rows: [], totals: {}, stock: [] }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);
  const cols: Column<any>[] = [
    { key: 'location', label: 'Branch / location', render: (r) => <strong>{r.location}</strong> },
    { key: 'revenue', label: 'Revenue', render: (r) => money(r.revenue) },
    ...(canCosts ? [
      { key: 'cogs', label: 'Cost of goods', render: (r: any) => money(r.cogs) },
      { key: 'gross_profit', label: 'Gross profit', render: (r: any) => <strong>{money(r.gross_profit)}</strong> },
      { key: 'margin_pct', label: 'Margin', render: (r: any) => r.margin_pct === null ? '—' : `${r.margin_pct}%` },
    ] : []),
    { key: 'expenses', label: 'Expenses', render: (r) => money(r.expenses) },
    ...(canCosts ? [{ key: 'net', label: 'Net profit', render: (r: any) => <strong style={{ color: r.net < 0 ? '#b91c1c' : '#066006' }}>{money(r.net)}</strong> }] : []),
  ];
  const stockCols: Column<any>[] = [
    { key: 'location', label: 'Location', render: (s) => <span><strong>{s.location}</strong><span className="mm-sub">{s.kind}</span></span> },
    { key: 'units', label: 'Units in stock' },
    ...(canCosts ? [{ key: 'inventory_value', label: 'Stock value (cost)', render: (s: any) => money(s.inventory_value) }] : []),
  ];
  const t = data?.totals || {};
  return (
    <div id="profit-by-location">
      <h3 style={{ margin: '0 0 4px' }}>Profit by location</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>From the books: each branch's revenue, cost of goods sold and expenses in the period. Warehouses hold stock and do not sell; their stock is shown below.</p>
      <div style={row}>
        <Field label="From"><input className="form-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="form-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Revenue" value={money(t.revenue)} />
          {canCosts && <Card label="Gross profit" value={money(t.gross_profit)} />}
          <Card label="Expenses" value={money(t.expenses)} />
          {canCosts && <Card label="Net profit" value={money(t.net)} warn={t.net < 0} />}
        </div>
        <DataTable id="profit-location-table" data={data.rows} columns={cols} keyExtractor={(r) => r.branch_id || 'company'} emptyMessage="Nothing recorded in this period." />
        <h4 style={{ margin: '20px 0 8px' }}>Stock by location (now)</h4>
        <DataTable id="stock-location-table" data={data.stock} columns={stockCols} keyExtractor={(s) => `${s.owner_type}-${s.location}`} emptyMessage="No stock." />
      </>)}
    </div>
  );
}
