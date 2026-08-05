import { useState, useEffect, useCallback } from 'react';
import { Receipt, Plus, Search, X, Edit2, Trash2, DollarSign, TrendingDown, Filter } from 'lucide-react';
import { apiRequest } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  branch_id?: string;
  branch_name?: string;
  payment_method: string;
  notes?: string;
  recorded_by_name?: string;
  created_at: string;
}

interface Branch {
  id: string;
  name: string;
}

const CATEGORIES = [
  'Rent', 'Utilities', 'Salaries', 'Transport', 'Maintenance',
  'Marketing', 'Office Supplies', 'Insurance', 'Taxes & Fees', 'Other'
];

const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD'];

const CAT_COLORS: Record<string, string> = {
  Rent: '#7c3aed', Utilities: '#2563eb', Salaries: '#0b8f08',
  Transport: '#d97706', Maintenance: '#dc2626', Marketing: '#db2777',
  'Office Supplies': '#0891b2', Insurance: '#65a30d', 'Taxes & Fees': '#9333ea', Other: '#6b7280',
};

const emptyForm = { title: '', amount: '', category: 'Other', expense_date: new Date().toISOString().slice(0, 10), branch_id: '', payment_method: 'CASH', notes: '' };

export function ExpensesPage() {
  const { isAdmin } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterBranch, setFilterBranch] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory !== 'ALL') params.set('category', filterCategory);
      if (filterBranch !== 'ALL') params.set('branch_id', filterBranch);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const data = await apiRequest(`/expenses?${params.toString()}`);
      setExpenses(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [filterCategory, filterBranch, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    apiRequest('/branches').then((data: any) => setBranches(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const filtered = expenses.filter(e =>
    e.title.toLowerCase().includes(search.toLowerCase()) ||
    (e.branch_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (e.notes || '').toLowerCase().includes(search.toLowerCase())
  );

  const totalAmount = filtered.reduce((s, e) => s + e.amount, 0);
  const byCat = filtered.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount;
    return acc;
  }, {});
  const topCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];

  const openCreate = () => {
    setEditExpense(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (e: Expense) => {
    setEditExpense(e);
    setForm({
      title: e.title, amount: String(e.amount), category: e.category,
      expense_date: e.expense_date, branch_id: e.branch_id || '',
      payment_method: e.payment_method, notes: e.notes || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.amount || !form.category) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        branch_id: form.branch_id || undefined,
        notes: form.notes || undefined,
      };
      if (editExpense) {
        await apiRequest(`/expenses/${editExpense.id}`, { method: 'PATCH', body: payload });
      } else {
        await apiRequest('/expenses', { method: 'POST', body: payload });
      }
      setShowModal(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiRequest(`/expenses/${id}`, { method: 'DELETE' });
    setDeleteConfirm(null);
    load();
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Expenses</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>{filtered.length} records · ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</p>
        </div>
        <button
          onClick={openCreate}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
        >
          <Plus size={16} /> Record Expense
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '8px' }}><TrendingDown size={20} color="#dc2626" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Expenses</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '8px' }}><Receipt size={20} color="#0b8f08" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{filtered.length}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Transactions</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#ede9fe', borderRadius: '8px', padding: '8px' }}><DollarSign size={20} color="#7c3aed" /></div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>{topCategory ? topCategory[0] : '—'}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Top Category {topCategory ? `· $${topCategory[1].toLocaleString()}` : ''}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ position: 'relative', flex: '1', minWidth: '200px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses..." style={{ width: '100%', padding: '9px 10px 9px 32px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
        </div>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer' }}>
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {isAdmin && branches.length > 0 && (
          <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer' }}>
            <option value="ALL">All Branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer' }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer' }} />
        {(filterCategory !== 'ALL' || filterBranch !== 'ALL' || dateFrom || dateTo) && (
          <button onClick={() => { setFilterCategory('ALL'); setFilterBranch('ALL'); setDateFrom(''); setDateTo(''); }} style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: '#6b7280' }}>
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Category breakdown mini bar */}
      {Object.keys(byCat).length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Filter size={12} /> Breakdown</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: CAT_COLORS[cat] || '#6b7280', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: '#374151' }}>{cat}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>${amt.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expenses list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>Loading expenses...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <Receipt size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>No expenses found</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>Click "Record Expense" to log your first expense</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>
          {filtered.map((expense, idx) => (
            <div key={expense.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 20px', borderTop: idx === 0 ? 'none' : '1px solid #f3f4f6', transition: 'background 0.15s' }}>
              {/* Category dot */}
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: `${CAT_COLORS[expense.category] || '#6b7280'}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: CAT_COLORS[expense.category] || '#6b7280' }} />
              </div>

              {/* Title + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: '#111827', fontSize: '14px' }}>{expense.title}</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                  <span style={{ fontSize: '12px', padding: '1px 8px', borderRadius: '10px', background: `${CAT_COLORS[expense.category] || '#6b7280'}18`, color: CAT_COLORS[expense.category] || '#6b7280', fontWeight: 500 }}>{expense.category}</span>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>{expense.payment_method.replace('_', ' ')}</span>
                  {expense.branch_name && <span style={{ fontSize: '12px', color: '#9ca3af' }}>{expense.branch_name}</span>}
                  {expense.recorded_by_name && <span style={{ fontSize: '12px', color: '#9ca3af' }}>by {expense.recorded_by_name}</span>}
                </div>
                {expense.notes && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px', fontStyle: 'italic' }}>{expense.notes}</div>}
              </div>

              {/* Date */}
              <div style={{ fontSize: '13px', color: '#6b7280', flexShrink: 0 }}>{expense.expense_date}</div>

              {/* Amount */}
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#dc2626', flexShrink: 0, minWidth: '80px', textAlign: 'right' }}>
                ${expense.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                <button onClick={() => openEdit(expense)} style={{ padding: '6px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}><Edit2 size={13} /></button>
                <button onClick={() => setDeleteConfirm(expense.id)} style={{ padding: '6px', border: '1px solid #fee2e2', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', width: '500px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontWeight: 700, fontSize: '18px' }}>{editExpense ? 'Edit Expense' : 'Record Expense'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}><X size={20} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              {/* Title */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Title <span style={{ color: '#dc2626' }}>*</span></label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Monthly Office Rent" style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {/* Amount */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Amount ($) <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {/* Category */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Category <span style={{ color: '#dc2626' }}>*</span></label>
                <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', boxSizing: 'border-box' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Date */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Date <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="date" value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {/* Payment method */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Payment Method</label>
                <select value={form.payment_method} onChange={e => setForm(p => ({ ...p, payment_method: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', boxSizing: 'border-box' }}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
                </select>
              </div>
              {/* Branch */}
              {isAdmin && branches.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Branch</label>
                  <select value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', boxSizing: 'border-box' }}>
                    <option value="">HQ / No Branch</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
              {/* Notes */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional description..." rows={3} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '10px 18px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontWeight: 500 }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.amount || !form.category} style={{ padding: '10px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', opacity: saving || !form.title.trim() || !form.amount ? 0.6 : 1 }}>
                {saving ? 'Saving...' : editExpense ? 'Save Changes' : 'Record Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', width: '380px', maxWidth: '95vw', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Trash2 size={22} color="#dc2626" />
            </div>
            <h3 style={{ margin: '0 0 8px', fontWeight: 700 }}>Delete Expense?</h3>
            <p style={{ margin: '0 0 20px', color: '#6b7280', fontSize: '14px' }}>This action cannot be undone.</p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '10px 20px', border: '1px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ padding: '10px 20px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
