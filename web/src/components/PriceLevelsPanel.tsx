import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { useToast } from '../contexts/ToastContext';

interface Level {
  id: string; level_no: number; cost_price?: number; selling_price: number; quantity_in: number; quantity_left: number;
  status: 'SELLING' | 'WAITING' | 'SOLD_OUT'; created_at: string; note?: string | null; source: string;
}

const STATUS: Record<Level['status'], { label: string; color: string; bg: string }> = {
  SELLING: { label: 'Selling now', color: '#15803d', bg: '#dcfce7' },
  WAITING: { label: 'Next', color: '#1d4ed8', bg: '#dbeafe' },
  SOLD_OUT: { label: 'Sold out', color: '#64748b', bg: '#f1f5f9' },
};

/**
 * Price levels of one product (Edit Product). The oldest level with stock is sold first; when it
 * runs out the next one's prices switch on. The Owner adds a level when the same product arrives
 * at new prices: the stock is added and the books are posted.
 */
export function PriceLevelsPanel({ productId, isOwner, canCosts, warehouses, branches, onLoaded, onChanged }: {
  productId: string; isOwner: boolean; canCosts: boolean;
  warehouses: { id: string; name: string }[]; branches: { id: string; name: string }[];
  onLoaded: (hasLevels: boolean) => void; onChanged: () => void;
}) {
  const { addToast } = useToast();
  const [levels, setLevels] = useState<Level[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ costPrice: '', sellingPrice: '', quantity: '', where: '', payment: 'PAID', note: '' });
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});

  const [loadError, setLoadError] = useState<string | null>(null);
  const load = () => apiGet<Level[]>(`/products/${productId}/price-levels`)
    .then((l) => { setLoadError(null); setLevels(l || []); onLoaded((l || []).length > 0); })
    // Never show an empty list when the levels could not be read: say so.
    .catch((e) => { setLevels([]); setLoadError(e?.message || 'The price levels could not be loaded.'); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [productId]);

  const add = async () => {
    const [kind, id] = form.where.split(':');
    if (!(Number(form.costPrice) >= 0) || form.costPrice === '') { addToast('error', 'Enter the new cost price.'); return; }
    if (!(Number(form.sellingPrice) > 0)) { addToast('error', 'Enter the new selling price.'); return; }
    if (!Number.isInteger(Number(form.quantity)) || Number(form.quantity) <= 0) { addToast('error', 'Enter the quantity received.'); return; }
    if (!id) { addToast('error', 'Choose where the goods are kept.'); return; }
    setSaving(true);
    try {
      await apiPost(`/products/${productId}/price-levels`, {
        costPrice: Number(form.costPrice), sellingPrice: Number(form.sellingPrice), quantity: Number(form.quantity),
        ownerType: kind === 'B' ? 'BRANCH' : 'WAREHOUSE', branchId: kind === 'B' ? id : undefined, warehouseId: kind === 'W' ? id : undefined,
        payment: form.payment, note: form.note || undefined,
      });
      addToast('success', `New price level added: ${form.quantity} at $${Number(form.sellingPrice).toFixed(2)}. The current stock sells first.`);
      setAdding(false); setForm({ costPrice: '', sellingPrice: '', quantity: '', where: '', payment: 'PAID', note: '' });
      load(); onChanged();
    } catch (e: any) { addToast('error', e?.message); } finally { setSaving(false); }
  };

  const savePrice = async (l: Level) => {
    const v = Number(editPrice[l.id]);
    if (!(v > 0)) { addToast('error', 'Enter the selling price.'); return; }
    try { await apiPatch(`/products/${productId}/price-levels/${l.id}`, { sellingPrice: v }); addToast('success', `Level ${l.level_no}: price $${v.toFixed(2)}`); setEditPrice((p) => { const n = { ...p }; delete n[l.id]; return n; }); load(); onChanged(); }
    catch (e: any) { addToast('error', e?.message); }
  };

  if (levels === null) return null;
  return (
    <div id="price-levels" style={{ marginTop: 14, padding: 14, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1e293b' }}>Price levels</div>
          <div className="mm-sub" style={{ fontSize: 12 }}>
            {levels.length ? 'The oldest level with stock is sold first; when it runs out, the next prices switch on.' : 'Same product arriving at new prices? Add a level: today’s stock keeps selling at today’s price first.'}
          </div>
        </div>
        {isOwner && !adding && (
          <button type="button" id="add-price-level" className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => setAdding(true)}>
            <Plus size={14} /> Add New Price Level
          </button>
        )}
      </div>

      {loadError && (
        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', fontSize: 12 }}>
          Price levels could not be loaded ({loadError}). If this keeps happening, the server is not up to date: deploy the backend.
        </div>
      )}
      {levels.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table className="table" style={{ width: '100%', fontSize: 12, whiteSpace: 'nowrap' }}>
            <thead><tr><th>Level</th>{canCosts && <th>Cost</th>}<th>Selling price</th><th>Received</th><th>Left</th><th>Status</th><th>Added</th></tr></thead>
            <tbody>{levels.map((l) => (
              <tr key={l.id}>
                <td>#{l.level_no}</td>
                {canCosts && <td>${Number(l.cost_price ?? 0).toFixed(2)}</td>}
                <td>
                  {isOwner && l.status !== 'SOLD_OUT' && editPrice[l.id] !== undefined ? (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <input className="form-input" type="number" min={0} step="0.01" style={{ width: 90, minHeight: 30, padding: '2px 6px' }}
                        value={editPrice[l.id]} onChange={(e) => setEditPrice((p) => ({ ...p, [l.id]: e.target.value }))} aria-label={`Selling price of level ${l.level_no}`} />
                      <button type="button" className="btn btn-primary btn-sm" style={{ width: 'auto' }} onClick={() => savePrice(l)}>Save</button>
                    </span>
                  ) : (
                    <span>
                      ${Number(l.selling_price).toFixed(2)}
                      {isOwner && l.status !== 'SOLD_OUT' && (
                        <button type="button" style={{ border: 'none', background: 'none', color: '#0284c7', cursor: 'pointer', fontSize: 11, marginLeft: 6 }}
                          onClick={() => setEditPrice((p) => ({ ...p, [l.id]: String(l.selling_price) }))}>change</button>
                      )}
                    </span>
                  )}
                </td>
                <td>{l.quantity_in}</td>
                <td><strong>{l.quantity_left}</strong></td>
                <td><span style={{ padding: '2px 8px', borderRadius: 10, fontWeight: 600, color: STATUS[l.status].color, background: STATUS[l.status].bg }}>{STATUS[l.status].label}</span></td>
                <td>{new Date(l.created_at).toLocaleDateString()}{l.note ? ` · ${l.note}` : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {adding && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
          <label className="form-field"><span className="form-field__label">New cost price ($)</span>
            <input className="form-input" id="level-cost" type="number" min={0} step="0.01" value={form.costPrice} onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))} /></label>
          <label className="form-field"><span className="form-field__label">New selling price ($)</span>
            <input className="form-input" id="level-price" type="number" min={0} step="0.01" value={form.sellingPrice} onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} /></label>
          <label className="form-field"><span className="form-field__label">Quantity received</span>
            <input className="form-input" id="level-qty" type="number" min={1} step="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} /></label>
          <label className="form-field"><span className="form-field__label">Kept at</span>
            <select className="form-select" id="level-where" value={form.where} onChange={(e) => setForm((f) => ({ ...f, where: e.target.value }))}>
              <option value="">Choose…</option>
              {warehouses.length > 0 && <optgroup label="Warehouses">{warehouses.map((w) => <option key={w.id} value={`W:${w.id}`}>{w.name}</option>)}</optgroup>}
              {branches.length > 0 && <optgroup label="Branches">{branches.map((b) => <option key={b.id} value={`B:${b.id}`}>{b.name}</option>)}</optgroup>}
            </select></label>
          <label className="form-field"><span className="form-field__label">Supplier</span>
            <select className="form-select" id="level-payment" value={form.payment} onChange={(e) => setForm((f) => ({ ...f, payment: e.target.value }))}>
              <option value="PAID">Paid (cash)</option><option value="OWED">Not paid yet (owed)</option>
            </select></label>
          <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Note (optional)</span>
            <input className="form-input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. supplier, invoice number" /></label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => setAdding(false)} disabled={saving}>Cancel</button>
            <button type="button" id="save-price-level" className="btn btn-primary" style={{ width: 'auto' }} onClick={add} disabled={saving}>{saving ? 'Saving…' : 'Add level'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
