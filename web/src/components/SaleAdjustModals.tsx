import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { searchProducts } from '../utils/lookups';
import { useToast } from '../contexts/ToastContext';

interface Props { order: any; onClose: () => void; onDone: () => void }

/** Edit a DRAFT sale: quantities, prices, remove or add products. Nothing is invoiced or taken from stock yet. */
export function EditDraftModal({ order, onClose, onDone }: Props) {
  const { addToast } = useToast();
  const [rows, setRows] = useState<{ productId: string; name: string; quantity: string; unitPrice: string; discountAmount: number }[]>(
    (order.lines || []).map((l: any) => ({ productId: l.product_id, name: l.product_name, quantity: String(l.quantity), unitPrice: String(l.unit_price), discountAmount: Number(l.discount_amount || 0) })));
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<Record<string, any>>({});
  const set = (i: number, k: 'quantity' | 'unitPrice', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = rows.reduce((a, r) => a + Number(r.quantity || 0) * Number(r.unitPrice || 0) - r.discountAmount, 0);

  const save = async () => {
    const lines = rows.map((r) => ({ productId: r.productId, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), discountAmount: r.discountAmount }));
    if (!lines.length) { addToast('error', 'A sale needs at least one product.'); return; }
    if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity <= 0)) { addToast('error', 'Quantities must be whole numbers above 0.'); return; }
    if (lines.some((l) => !(l.unitPrice >= 0))) { addToast('error', 'A price cannot be negative.'); return; }
    setSaving(true);
    try { await apiPatch(`/sales/orders/${order.id}`, { lines }); addToast('success', 'Sale updated'); onDone(); }
    catch (e: any) { addToast('error', e?.message); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title={`Edit draft ${order.order_number}`} size="lg"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
        <strong>Total ${total.toLocaleString()}</strong>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Back</button>
          <button type="button" id="save-draft-edit" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </span>
      </div>}>
      <p className="mm-sub" style={{ marginTop: 0 }}>Only drafts can be edited. Once a sale is confirmed or invoiced, cancel it (before delivery) or record a Return.</p>
      <table className="table" style={{ width: '100%' }}>
        <thead><tr><th>Product</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Price</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.productId}>
              <td>{r.name}</td>
              <td><input className="form-input" type="number" min={1} value={r.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} aria-label={`Quantity of ${r.name}`} /></td>
              <td><input className="form-input" type="number" min={0} step="0.01" value={r.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} aria-label={`Price of ${r.name}`} /></td>
              <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <SearchableSelect options={[]} value="" placeholder="Add another product…"
          loadOptions={async (q) => { const items = await searchProducts(q); setAdded((p) => ({ ...p, ...Object.fromEntries(items.map((x: any) => [x.id, x])) })); return items.map((p: any) => ({ value: p.id, label: p.name, sublabel: p.sku })); }}
          onChange={(id) => {
            const p = added[id]; if (!p || rows.some((r) => r.productId === id)) return;
            setRows((r) => [...r, { productId: id, name: p.name, quantity: '1', unitPrice: String(p.selling_price ?? 0), discountAmount: 0 }]);
          }} />
      </div>
    </Modal>
  );
}

/** Record goods the customer brings back after an invoiced sale. */
export function ReturnModal({ order, onClose, onDone }: Props) {
  const { addToast } = useToast();
  const [info, setInfo] = useState<{ returnable: any[]; returns: any[] } | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState('CASH');
  const [saving, setSaving] = useState(false);
  useEffect(() => { apiGet<any>(`/sales/orders/${order.id}/returns`).then(setInfo).catch((e) => { addToast('error', e?.message); onClose(); }); /* eslint-disable-next-line */ }, []);

  const save = async () => {
    const lines = (info?.returnable || []).filter((r) => Number(qty[r.product_id]) > 0).map((r) => ({ productId: r.product_id, quantity: Number(qty[r.product_id]), condition: cond[r.product_id] || 'RESALEABLE' }));
    if (!lines.length) { addToast('error', 'Enter the quantity being returned.'); return; }
    if (reason.trim().length < 3) { addToast('error', 'Please write the reason for the return.'); return; }
    setSaving(true);
    try { const r: any = await apiPost(`/sales/orders/${order.id}/returns`, { reason, lines, refundMethod: method }); addToast('success', r?.message || 'Return recorded'); onDone(); }
    catch (e: any) { addToast('error', e?.message); } finally { setSaving(false); }
  };

  return (
    <Modal isOpen onClose={() => !saving && onClose()} title={`Return items — ${order.order_number}`} size="lg"
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Back</button>
        <button type="button" id="save-return" className="btn btn-primary" onClick={save} disabled={saving || !info}>{saving ? 'Saving…' : 'Record return'}</button>
      </div>}>
      {!info ? <p>Loading…</p> : (
        <>
          <p className="mm-sub" style={{ marginTop: 0 }}>Good items go back on the branch shelf; damaged ones do not. The customer's invoice is reduced, and anything they already paid beyond the new total is refunded.</p>
          <table className="table" style={{ width: '100%' }}>
            <thead><tr><th>Product</th><th>Sold</th><th>Returned before</th><th style={{ width: 90 }}>Return now</th><th style={{ width: 150 }}>Condition</th></tr></thead>
            <tbody>{info.returnable.map((r) => (
              <tr key={r.product_id}>
                <td>{r.product_name}</td><td>{r.sold}</td><td>{r.returned}</td>
                <td><input className="form-input" type="number" min={0} max={r.returnable} disabled={r.returnable <= 0} value={qty[r.product_id] ?? ''} onChange={(e) => setQty((p) => ({ ...p, [r.product_id]: e.target.value }))} aria-label={`Return quantity of ${r.product_name}`} /></td>
                <td><select className="form-select" value={cond[r.product_id] || 'RESALEABLE'} onChange={(e) => setCond((p) => ({ ...p, [r.product_id]: e.target.value }))}>
                  <option value="RESALEABLE">Good (back to stock)</option><option value="DAMAGED">Damaged (not restocked)</option></select></td>
              </tr>))}</tbody>
          </table>
          <label className="form-field" style={{ marginTop: 12 }}><span className="form-field__label">Reason *</span>
            <input className="form-input" id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. faulty, wrong size, customer changed mind" /></label>
          <label className="form-field"><span className="form-field__label">If money must be refunded, pay it by</span>
            <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Cash</option><option value="BANK">Bank</option><option value="MOBILE">Mobile money</option></select></label>
          {info.returns.length > 0 && (
            <div style={{ marginTop: 12 }}><strong>Earlier returns</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{info.returns.map((r) => (
                <li key={r.id}>{r.return_number} · {new Date(r.created_at).toLocaleDateString()} · ${Number(r.return_value).toLocaleString()}{Number(r.refund_amount) > 0 ? ` (refunded ${Number(r.refund_amount).toLocaleString()})` : ''} — {r.reason}</li>))}</ul></div>
          )}
        </>
      )}
    </Modal>
  );
}
