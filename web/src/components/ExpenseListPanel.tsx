// Expenses → Expense list (Owner / accountant): the company's list of expenses, and which of them
// each branch or warehouse may record. Staff then choose from their own list only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { useToast } from '../contexts/ToastContext';

interface ExpenseType { id: string; name: string; category: string; expense_account_id: string | null; expense_account_code?: string; expense_account_name?: string; class_id: string | null; class_name?: string; is_active: number; locations: number }
const box: React.CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, background: '#fff' };
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 };
const EMPTY = { id: '', name: '', category: '', expenseAccountId: '', classId: '' };

export function ExpenseListPanel({ categories, accounts, classes, onChanged }: {
  categories: string[]; accounts: { id: string; code: string; name: string }[]; classes: { id: string; name: string }[]; onChanged: () => void;
}) {
  const { addToast } = useToast();
  const [types, setTypes] = useState<ExpenseType[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<{ value: string; label: string; group: string }[]>([]);
  const [place, setPlace] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState('');
  const load = useCallback(() => apiGet<any>('/expenses/types', { all: 1 }).then((d) => setTypes(d.types || [])).catch((e) => { addToast('error', e?.message); setTypes([]); }), [addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    Promise.all([apiGet<any[]>('/branches').catch(() => []), apiGet<any>('/warehouses').catch(() => [])]).then(([b, w]) => {
      const whs = Array.isArray(w) ? w : (w?.items || []);
      setPlaces([...(b || []).map((x: any) => ({ value: `b:${x.id}`, label: x.name, group: 'Branches' })), ...whs.map((x: any) => ({ value: `w:${x.id}`, label: x.name, group: 'Warehouses' }))]);
    });
  }, []);
  // The ticks of the chosen branch / warehouse.
  useEffect(() => {
    setChecked(new Set()); setLoadedFor('');
    if (!place) return;
    const [k, id] = place.split(':');
    apiGet<any>('/expenses/types/assignments', k === 'w' ? { warehouseId: id } : { branchId: id })
      .then((d) => { setChecked(new Set(d.typeIds || [])); setLoadedFor(place); }).catch((e) => addToast('error', e?.message));
  }, [place, addToast]);

  const save = async () => {
    if (!form.name.trim() || !form.category) { addToast('error', 'Enter the name and choose the category.'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), category: form.category, expenseAccountId: form.expenseAccountId || '', classId: form.classId || '' };
      if (form.id) await apiPatch(`/expenses/types/${form.id}`, body); else await apiPost('/expenses/types', body);
      addToast('success', form.id ? 'Expense updated.' : `"${body.name}" added to the list.`);
      setForm(EMPTY); load(); onChanged();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const toggleActive = async (t: ExpenseType) => {
    try { await apiPatch(`/expenses/types/${t.id}`, { is_active: Number(t.is_active) !== 1 }); load(); onChanged(); } catch (e: any) { addToast('error', e?.message); }
  };
  const assign = async () => {
    const [k, id] = place.split(':');
    setBusy(true);
    try {
      const r: any = await apiPut('/expenses/types/assignments', { ...(k === 'w' ? { warehouseId: id } : { branchId: id }), typeIds: [...checked] });
      addToast('success', `${places.find((p) => p.value === place)?.label}: ${r.saved} expense${r.saved === 1 ? '' : 's'} saved.`); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const active = useMemo(() => (types || []).filter((t) => Number(t.is_active) === 1), [types]);
  const allChecked = active.length > 0 && active.every((t) => checked.has(t.id));

  return (
    <div id="expense-list-panel" style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
      {/* 1. The company list */}
      <div style={box}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>1. Company expense list</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>Every expense the company may have. Staff choose from it; the category, account and class come with each one.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
          <div><span style={label}>Expense name *</span><input className="form-input" id="et-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Fuel for delivery motorbike" /></div>
          <div><span style={label}>Category *</span><select className="form-select" id="et-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="">— choose —</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><span style={label}>Expense account</span><select className="form-select" value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })}><option value="">Automatic (from the category)</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></div>
          {classes.length > 0 && <div><span style={label}>Class</span><select className="form-select" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}><option value="">No class</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" id="et-save" disabled={busy} onClick={save}>{form.id ? 'Save changes' : 'Add to list'}</button>
            {form.id && <button className="btn btn-secondary" onClick={() => setForm(EMPTY)}>Cancel</button>}
          </div>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} id="et-table">
            <thead><tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e5e7eb' }}><th style={{ padding: 6 }}>Expense</th><th style={{ padding: 6 }}>Category</th><th style={{ padding: 6 }}>Account</th><th style={{ padding: 6 }}>Class</th><th style={{ padding: 6 }}>Used by</th><th /></tr></thead>
            <tbody>
              {(types || []).map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #f3f4f6', opacity: Number(t.is_active) === 1 ? 1 : 0.5 }}>
                  <td style={{ padding: 6 }}><strong>{t.name}</strong>{Number(t.is_active) !== 1 && ' (stopped)'}</td>
                  <td style={{ padding: 6 }}>{t.category}</td>
                  <td style={{ padding: 6 }}>{t.expense_account_code ? `${t.expense_account_code} ${t.expense_account_name}` : 'Automatic'}</td>
                  <td style={{ padding: 6 }}>{t.class_name || '—'}</td>
                  <td style={{ padding: 6 }}>{t.locations ? `${t.locations} place${t.locations > 1 ? 's' : ''}` : <span style={{ color: '#b45309' }}>nobody yet</span>}</td>
                  <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setForm({ id: t.id, name: t.name, category: t.category, expenseAccountId: t.expense_account_id || '', classId: t.class_id || '' })}>Edit</button>{' '}
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(t)}>{Number(t.is_active) === 1 ? 'Stop' : 'Use again'}</button>
                  </td>
                </tr>))}
              {types && !types.length && <tr><td colSpan={6} style={{ padding: 12, color: '#6b7280' }}>The list is empty. Add the first expense above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Who uses what */}
      <div style={box}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>2. Give expenses to a branch or warehouse</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>Choose the branch or warehouse, tick the expenses its staff may record, then Save.</p>
        <select className="form-select" id="et-place" value={place} onChange={(e) => setPlace(e.target.value)} style={{ maxWidth: 360 }}>
          <option value="">— choose a branch or warehouse —</option>
          {['Branches', 'Warehouses'].map((g) => places.some((p) => p.group === g) && (
            <optgroup key={g} label={g}>{places.filter((p) => p.group === g).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</optgroup>))}
        </select>
        {place && loadedFor === place && (<>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 6px', fontWeight: 600 }}>
            <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(active.map((t) => t.id)))} /> All expenses
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
            {active.map((t) => (
              <label key={t.id} className="et-check" style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', background: checked.has(t.id) ? '#f0fdf4' : '#fff' }}>
                <input type="checkbox" data-name={t.name} checked={checked.has(t.id)} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} />
                <span>{t.name}<span style={{ display: 'block', fontSize: 11, color: '#6b7280' }}>{t.category}</span></span>
              </label>))}
          </div>
          {!active.length && <p style={{ fontSize: 13, color: '#6b7280' }}>Add expenses to the list first (part 1).</p>}
          <button className="btn btn-primary" id="et-assign" style={{ marginTop: 12 }} disabled={busy} onClick={assign}>Save for {places.find((p) => p.value === place)?.label} ({checked.size})</button>
        </>)}
      </div>
    </div>
  );
}
