import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Percent } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { useToast } from '../contexts/ToastContext';

interface Row {
  order_id: string; order_number: string; created_at: string; order_status: string; invoice_number: string | null;
  branch_name: string | null; seller: string; customer_name: string; product_name: string; product_sku: string | null;
  quantity: number; unit_price: number; gross: number; discount: number; net: number; discount_pct: number;
}
interface Group { name: string; lines: number; orders: number; gross: number; discount: number; discount_pct: number }
interface Report { rows: Row[]; bySeller: Group[]; byBranch: Group[]; totals: { discount: number; gross: number; orders: number; lines: number; discount_pct: number }; limited: boolean }

const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d).toLocaleDateString();

/**
 * Every discount given on a sale, with who sold it (Owner request): prices are fixed, discounts are
 * allowed, and the Owner sees each one so the seller can be asked why. Click a line to open the sale.
 */
export function DiscountsReport({ days }: { days: number }) {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    setData(null);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    apiGet<Report>('/sales/discounts', { from })
      .then(setData)
      .catch((e) => { addToast('error', e?.message); setData({ rows: [], bySeller: [], byBranch: [], totals: { discount: 0, gross: 0, orders: 0, lines: 0, discount_pct: 0 }, limited: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const groupCols = (label: string): Column<Group>[] => [
    { key: 'name', label, render: (g) => <strong>{g.name}</strong> },
    { key: 'discount', label: 'Discount given', render: (g) => <strong style={{ color: '#b45309' }}>{money(g.discount)}</strong> },
    { key: 'discount_pct', label: '%', render: (g) => `${g.discount_pct}%` },
    { key: 'orders', label: 'Sales', render: (g) => g.orders },
    { key: 'gross', label: 'Before discount', render: (g) => money(g.gross) },
  ];
  const cols: Column<Row>[] = [
    { key: 'created_at', label: 'Date', render: (r) => day(r.created_at) },
    { key: 'order_number', label: 'Sale / invoice', render: (r) => <span><strong style={{ fontFamily: 'monospace' }}>{r.order_number}</strong><span className="mm-sub">{r.invoice_number || (r.order_status === 'DRAFT' ? 'Draft' : '—')}</span></span> },
    { key: 'seller', label: 'Sold by', render: (r) => <span><strong>{r.seller}</strong><span className="mm-sub">{r.branch_name || ''}</span></span> },
    { key: 'discount', label: 'Discount', render: (r) => <strong style={{ color: '#b45309' }}>−{money(r.discount)}</strong> },
    { key: 'discount_pct', label: '%', render: (r) => <span style={{ fontWeight: 700, color: r.discount_pct >= 20 ? '#b91c1c' : '#b45309' }}>{r.discount_pct}%</span> },
    { key: 'customer_name', label: 'Customer', render: (r) => r.customer_name },
    { key: 'product_name', label: 'Product', render: (r) => <span>{r.product_name}<span className="mm-sub">{r.quantity} × {money(r.unit_price)}</span></span> },
    { key: 'gross', label: 'Before', render: (r) => money(r.gross) },
    { key: 'net', label: 'Paid price', render: (r) => money(r.net) },
  ];

  const t = data?.totals;
  return (
    <div id="discounts-report">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Percent size={20} style={{ color: '#066006' }} />
        <h3 style={{ margin: 0 }}>Discounts given</h3>
      </div>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 16px' }}>
        Prices are fixed; sellers may give a discount on a line. Every discount from the last {days} days is listed here with who gave it. Click a line to open the sale.
      </p>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
            {[
              ['Discount given', money(t!.discount), '#b45309'],
              ['Sales with a discount', String(t!.orders), '#0f172a'],
              ['Value before discount', money(t!.gross), '#0f172a'],
              ['Average discount', `${t!.discount_pct}%`, '#b45309'],
            ].map(([label, value, color]) => (
              <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                <div className="mm-sub" style={{ display: 'block' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
              </div>
            ))}
          </div>
          {data.rows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 18 }}>
              <div><h4 style={{ margin: '0 0 8px' }}>By seller</h4>
                <DataTable id="discounts-by-seller" data={data.bySeller} columns={groupCols('Seller')} keyExtractor={(g) => g.name} pageSize={10} /></div>
              <div><h4 style={{ margin: '0 0 8px' }}>By branch</h4>
                <DataTable id="discounts-by-branch" data={data.byBranch} columns={groupCols('Branch')} keyExtractor={(g) => g.name} pageSize={10} /></div>
            </div>
          )}
          <h4 style={{ margin: '0 0 8px' }}>Every discounted line</h4>
          <DataTable id="discounts-lines" data={data.rows} columns={cols} keyExtractor={(r) => `${r.order_id}:${r.product_name}`} pageSize={25}
            onRowClick={(r) => navigate(`/sales?open=${encodeURIComponent(r.order_id)}`)}
            emptyMessage={`No discounts in the last ${days} days.`} />
          {data.limited && <p className="mm-sub" style={{ display: 'block' }}>Showing the newest 2,000 lines; choose a shorter period to see older ones.</p>}
        </>
      )}
    </div>
  );
}
