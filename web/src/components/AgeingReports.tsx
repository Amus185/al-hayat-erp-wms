import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { useToast } from '../contexts/ToastContext';

const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const Card = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
    <div className="mm-sub" style={{ display: 'block' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#b91c1c' : '#0f172a' }}>{value}</div>
  </div>
);
const amt = (n: number, red = false) => n > 0 ? <strong style={{ color: red ? '#b91c1c' : undefined }}>{money(n)}</strong> : <span style={{ color: '#94a3b8' }}>—</span>;

/** Accounts payable ageing: what is owed to each supplier, by how long it is overdue. */
export function PayablesAgeing() {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState('');
  const [data, setData] = useState<any>(null);
  const [all, setAll] = useState<{ supplier_id: string; supplier_name: string }[]>([]);
  useEffect(() => {
    setData(null);
    apiGet<any>('/purchasing/payables-ageing', { asOf, supplierId: supplierId || undefined })
      .then((d) => { setData(d); if (!supplierId) setAll(d.suppliers); })
      .catch((e) => { addToast('error', e?.message); setData({ suppliers: [], invoices: [], totals: {} }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asOf, supplierId]);
  const cols: Column<any>[] = [
    { key: 'supplier_name', label: 'Supplier', render: (r) => <strong>{r.supplier_name}</strong> },
    { key: 'total', label: 'Total owed', render: (r) => <strong>{money(r.total)}</strong> },
    { key: 'current', label: 'Not yet due', render: (r) => amt(r.current) },
    { key: 'd1_30', label: '1–30 days', render: (r) => amt(r.d1_30) },
    { key: 'd31_60', label: '31–60 days', render: (r) => amt(r.d31_60) },
    { key: 'd61_90', label: '61–90 days', render: (r) => amt(r.d61_90, true) },
    { key: 'd90_plus', label: 'Over 90 days', render: (r) => amt(r.d90_plus, true) },
  ];
  const invCols: Column<any>[] = [
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'invoice_number', label: 'Invoice', render: (r) => <span><strong style={{ fontFamily: 'monospace' }}>{r.invoice_number}</strong><span className="mm-sub">{r.po_number}{r.branch_name ? ` · ${r.branch_name}` : ''}</span></span> },
    { key: 'balance', label: 'Still owed', render: (r) => <strong>{money(r.balance)}</strong> },
    { key: 'due_date', label: 'Due', render: (r) => new Date(r.due_date).toLocaleDateString() },
    { key: 'days_overdue', label: 'Overdue', render: (r) => r.days_overdue > 0 ? <strong style={{ color: r.days_overdue > 60 ? '#b91c1c' : '#b45309' }}>{r.days_overdue} days</strong> : 'Not yet due' },
    { key: 'issued_at', label: 'Invoice date', render: (r) => new Date(r.issued_at).toLocaleDateString() },
  ];
  const t = data?.totals || {};
  return (
    <div id="payables-ageing">
      <h3 style={{ margin: '0 0 4px' }}>Payables ageing (suppliers)</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>What we owe suppliers and how long it is overdue. Due date = invoice date + the supplier's payment terms (30 days unless set).</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">As of</span><input className="form-input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className="form-field" style={{ margin: 0, minWidth: 200 }}><span className="form-field__label">Supplier</span>
          <select className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">All suppliers</option>{all.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}</select></label>
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Total owed" value={money(t.total)} /><Card label="Not yet due" value={money(t.current)} /><Card label="1–30 days" value={money(t.d1_30)} />
          <Card label="31–60 days" value={money(t.d31_60)} /><Card label="61–90 days" value={money(t.d61_90)} warn={t.d61_90 > 0} /><Card label="Over 90 days" value={money(t.d90_plus)} warn={t.d90_plus > 0} />
        </div>
        <DataTable id="payables-by-supplier" data={data.suppliers} columns={cols} keyExtractor={(r) => r.supplier_id} pageSize={25} emptyMessage="Nothing is owed to suppliers." />
        {data.invoices.length > 0 && (<><h4 style={{ margin: '16px 0 8px' }}>Unpaid invoices</h4>
          <DataTable id="payables-invoices" data={data.invoices} columns={invCols} keyExtractor={(r) => r.id} pageSize={25} onRowClick={(r) => navigate(`/purchasing?open=${encodeURIComponent(r.po_id)}`)} /></>)}
      </>)}
    </div>
  );
}

/** Stock ageing: how long the units on hand have been in the warehouse or branch. */
export function StockAgeing({ warehouseId, categoryId }: { warehouseId?: string; categoryId?: string }) {
  const { addToast } = useToast();
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    apiGet<any>('/reports/stock-ageing', { warehouseId: warehouseId || undefined, categoryId: categoryId || undefined })
      .then(setData).catch((e) => { addToast('error', e?.message); setData({ rows: [], totals: {} }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseId, categoryId]);
  const q = (n: number, red = false) => n > 0 ? <strong style={{ color: red ? '#b91c1c' : undefined }}>{n}</strong> : <span style={{ color: '#94a3b8' }}>—</span>;
  const cols: Column<any>[] = [
    { key: 'product_name', label: 'Product', render: (r) => <span><strong>{r.product_name}</strong><span className="mm-sub">{r.sku}</span></span> },
    { key: 'location_name', label: 'Where', render: (r) => <span>{r.location_name}<span className="mm-sub">{r.location_type}</span></span> },
    { key: 'quantity', label: 'On hand', render: (r) => <strong>{r.quantity}</strong> },
    { key: 'oldest_receipt', label: 'Oldest receipt', render: (r) => r.oldest_receipt ? new Date(r.oldest_receipt).toLocaleDateString() : '—' },
    { key: 'days_in_stock', label: 'Days in stock', render: (r) => r.days_in_stock === null ? '—' : <strong style={{ color: r.days_in_stock > 180 ? '#b91c1c' : r.days_in_stock > 90 ? '#b45309' : undefined }}>{r.days_in_stock}</strong> },
    { key: 'category', label: 'Age', render: (r) => r.category },
    { key: 'd0_30', label: '0–30', render: (r) => q(r.d0_30) },
    { key: 'd31_60', label: '31–60', render: (r) => q(r.d31_60) },
    { key: 'd61_90', label: '61–90', render: (r) => q(r.d61_90) },
    { key: 'd91_180', label: '91–180', render: (r) => q(r.d91_180, true) },
    { key: 'd180_plus', label: '180+', render: (r) => q(r.d180_plus, true) },
    { key: 'unknown', label: 'No record', render: (r) => q(r.unknown) },
  ];
  const t = data?.totals || {};
  return (
    <div id="stock-ageing">
      <h3 style={{ margin: '0 0 4px' }}>Stock ageing</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>How long the units on hand have been in stock, from the real receipt dates (oldest stock is counted as sold first). Oldest products first.</p>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Units on hand" value={String(t.quantity || 0)} /><Card label="0–30 days" value={String(t.d0_30 || 0)} /><Card label="31–60 days" value={String(t.d31_60 || 0)} />
          <Card label="61–90 days" value={String(t.d61_90 || 0)} /><Card label="91–180 days" value={String(t.d91_180 || 0)} warn={t.d91_180 > 0} /><Card label="Over 180 days" value={String(t.d180_plus || 0)} warn={t.d180_plus > 0} />
        </div>
        <DataTable id="stock-ageing-table" data={data.rows} columns={cols} keyExtractor={(r) => `${r.product_id}:${r.location_name}`} pageSize={25} emptyMessage="No stock on hand." />
      </>)}
    </div>
  );
}
