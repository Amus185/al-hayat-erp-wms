import { BulkExpenses, type ExpenseAccount } from '../components/BulkExpenses';
import { Modal } from '../components/Modal';
import { MoneyAccountSelect } from '../components/MoneyAccountSelect';
import { useState, useEffect, useCallback } from 'react';
import { Receipt, Plus, Search, X, Edit2, Trash2, DollarSign, TrendingDown, Filter } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useServerList } from '../utils/serverList';
import { DownloadDocButton } from '../components/DownloadDocButton';
import { downloadExpenseVoucher } from '../utils/documents';
import { ListToolbar } from '../components/ListToolbar';
import { Pagination } from '../components/Pagination';

interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  branch_id?: string;
  branch_name?: string;
  payment_method: string;
  money_account_id?: string | null;
  money_account_name?: string | null;
  expense_account_id?: string | null;
  expense_account_code?: string | null;
  expense_account_name?: string | null;
  reference?: string | null;
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

const isOwed = (e: { payment_method: string }) => ['CREDIT', 'ON_ACCOUNT', 'UNPAID', 'PAYABLE'].includes(String(e.payment_method).toUpperCase());
const emptyForm = { title: '', amount: '', category: 'Other', expense_date: new Date().toISOString().slice(0, 10), branch_id: '', payment_method: 'CASH', money_account_id: '', expense_account_id: '', class_id: '', owed: false, notes: '' };

export function ExpensesPage() {
  const { isAdmin, branchId } = useAuth();
  const { addToast } = useToast();
  // Expenses: searched, filtered, sorted and paged on the server; the totals
  // and the category breakdown cover everything that matches the filters.
  const list = useServerList<Expense>('/expenses', {
    key: 'expenses',
    filters: ['category', 'branch_id', 'method', 'dateFrom', 'dateTo'],
    defaultSort: 'date',
    defaultDir: 'desc',
  });
  const expenses = list.items;
  const [branches, setBranches] = useState<Branch[]>([]);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [accountChanged, setAccountChanged] = useState(false);
  const [expAccounts, setExpAccounts] = useState<ExpenseAccount[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [payFor, setPayFor] = useState<Expense | null>(null);
  const [payFrom, setPayFrom] = useState('');
  const [paying, setPaying] = useState(false);
  useEffect(() => { apiGet<ExpenseAccount[]>('/expenses/accounts').then((a) => setExpAccounts(a || [])).catch(() => {}); }, []);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classRequired, setClassRequired] = useState(false);
  useEffect(() => { apiGet<any>('/expenses/classes').then((d) => { setClasses(d.classes || []); setClassRequired(!!d.required); }).catch(() => {}); }, []);
  const payOwed = async () => {
    if (!payFor) return;
    if (!payFrom) { addToast('error', 'Choose the account you are paying from.'); return; }
    setPaying(true);
    try { await apiPost(`/expenses/${payFor.id}/pay`, { moneyAccountId: payFrom }); addToast('success', `${payFor.title} paid.`); setPayFor(null); load(); }
    catch (err: any) { addToast('error', err?.message); } finally { setPaying(false); }
  };
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = () => list.refresh();

  useEffect(() => {
    apiGet<Branch[]>('/branches').then((data) => setBranches(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const filtered = expenses;
  const totalAmount = list.totals?.amount ?? 0;
  const byCatList = (list.response?.byCategory ?? []) as { category: string; amount: number }[];
  const topCategory = byCatList[0] ? [byCatList[0].category, byCatList[0].amount] as [string, number] : undefined;

  const openCreate = () => {
    setEditExpense(null);
    setAccountChanged(false);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (e: Expense) => {
    setEditExpense(e);
    setAccountChanged(false);
    setForm({
      title: e.title, amount: String(e.amount), category: e.category,
      expense_date: e.expense_date, branch_id: e.branch_id || '',
      payment_method: e.payment_method, money_account_id: e.money_account_id || '', expense_account_id: e.expense_account_id || '', class_id: (e as any).class_id || '', owed: isOwed(e), notes: e.notes || '',
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
        // On an edit, the account is only sent when the person changed it (never moved by itself).
        moneyAccountId: form.owed || (editExpense && !accountChanged) ? undefined : (form.money_account_id || undefined),
        expenseAccountId: form.expense_account_id || (editExpense ? '' : undefined),
        classId: form.class_id || (editExpense ? '' : undefined),
        // New expense not paid yet: it is owed (Accounts Payable) until "Pay" is used.
        payment_method: editExpense ? form.payment_method : (form.owed ? 'UNPAID' : form.payment_method),
      };
      delete (payload as any).owed; delete (payload as any).expense_account_id; delete (payload as any).class_id;
      delete (payload as any).money_account_id;
      if (editExpense) {
        await apiPatch(`/expenses/${editExpense.id}`, payload);
      } else {
        await apiPost('/expenses', payload);
      }
      setShowModal(false);
      addToast('success', editExpense ? 'Expense updated' : 'Expense recorded');
      load();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save the expense');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/expenses/${id}`);
      setDeleteConfirm(null);
      addToast('success', 'Expense deleted');
      load();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not delete the expense');
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Expenses</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>{list.total.toLocaleString()} records · ${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total</p>
        </div>
        <button type="button" className="btn btn-secondary" id="bulk-expenses-open" onClick={() => setBulkOpen(true)} style={{ marginLeft: 'auto' }}>Enter several</button>
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
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{list.total.toLocaleString()}</div>
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

      {/* Search and filters (server side) */}
      <ListToolbar
        id="expenses-toolbar"
        list={list}
        searchPlaceholder="Search title, category or notes…"
        dateRange
        filters={[
          { key: 'category', label: 'All categories', options: CATEGORIES.map((c) => ({ value: c, label: c })) },
          { key: 'method', label: 'All payment methods', options: PAYMENT_METHODS.map((m) => ({ value: m, label: m.replace('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()) })) },
          ...(isAdmin && branches.length > 0 ? [{ key: 'branch_id', label: 'All branches', options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
        ]}
      >
        <select aria-label="Sort expenses" className="list-toolbar__select" value={`${list.sort}:${list.dir}`}
          onChange={(e) => { const [k, d] = e.target.value.split(':'); list.setFilters({ sort: k, dir: d }); }}>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="amount:desc">Largest amount</option>
          <option value="amount:asc">Smallest amount</option>
          <option value="title:asc">Title A–Z</option>
        </select>
      </ListToolbar>

      {/* Category breakdown mini bar */}
      {byCatList.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}><Filter size={12} /> Breakdown</div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {byCatList.map(({ category: cat, amount: amt }) => (
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
      {list.initialLoading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>Loading expenses...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <Receipt size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>No expenses found</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{list.activeFilters ? 'Try other filters, or clear them.' : 'Click "Record Expense" to log your first expense'}</p>
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
                  {expense.expense_account_code && <span style={{ fontSize: '12px', color: '#6b7280' }}>{expense.expense_account_code} {expense.expense_account_name}</span>}
                  {isOwed(expense)
                    ? <span style={{ fontSize: '12px', padding: '1px 8px', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>Not paid yet</span>
                    : <span style={{ fontSize: '12px', color: '#9ca3af' }}>{expense.money_account_name || expense.payment_method.replace('_', ' ')}</span>}
                  {expense.reference && <span style={{ fontSize: '12px', color: '#9ca3af' }}>Ref {expense.reference}</span>}
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
              <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                <DownloadDocButton iconOnly label={`Download expense voucher ${expense.title}`} make={() => downloadExpenseVoucher(expense)} />
                {isOwed(expense) && <button className="btn btn-primary btn-sm pay-expense" onClick={() => { setPayFrom(''); setPayFor(expense); }}>Pay</button>}
                <button onClick={() => openEdit(expense)} style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}><Edit2 size={13} /></button>
                <button onClick={() => setDeleteConfirm(expense.id)} style={{ padding: '6px 8px', border: '1px solid #fee2e2', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      {list.total > 0 && (
        <Pagination id="expenses-pages" page={list.page} pageSize={list.pageSize} total={list.total}
          onPageChange={list.setPage} onPageSizeChange={list.setPageSize} pageSizeOptions={[25, 50, 100]} />
      )}

      <BulkExpenses open={bulkOpen} onClose={() => setBulkOpen(false)} onSaved={load} accounts={expAccounts} branches={branches} fixedBranchId={isAdmin ? null : (branchId ?? null)} />
      <Modal isOpen={!!payFor} onClose={() => !paying && setPayFor(null)} title={payFor ? `Pay: ${payFor.title}` : ''} width="sm"
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setPayFor(null)} disabled={paying}>Cancel</button>
          <button type="button" className="btn btn-primary" id="confirm-pay-expense" onClick={payOwed} disabled={paying}>{paying ? 'Paying…' : `Pay $${Number(payFor?.amount || 0).toFixed(2)}`}</button>
        </div>}>
        {payFor && <MoneyAccountSelect id="payExpenseFrom" label="Paid from" value={payFrom} onChange={setPayFrom} mustChoose branchId={(payFor as any).branch_id ?? null} amount={Number(payFor.amount)} />}
      </Modal>
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
              {/* Expense account from the chart of accounts */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Expense account</label>
                <select id="expenseAccount" className="form-select" value={form.expense_account_id} onChange={e => setForm(p => ({ ...p, expense_account_id: e.target.value }))}>
                  <option value="">Automatic (from the category)</option>
                  {expAccounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </div>
              {classes.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Class{classRequired ? ' *' : ''}</label>
                  <select id="expenseClass" className="form-select" value={form.class_id} onChange={e => setForm(p => ({ ...p, class_id: e.target.value }))}>
                    <option value="">{classRequired ? '— choose —' : 'No class'}</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {!editExpense && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Payment</label>
                  <select id="expenseOwed" className="form-select" value={form.owed ? 'OWED' : 'PAID'} onChange={e => setForm(p => ({ ...p, owed: e.target.value === 'OWED' }))}>
                    <option value="PAID">Paid now</option><option value="OWED">Not paid yet (owed)</option>
                  </select>
                </div>
              )}
              {/* Date */}
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Date <span style={{ color: '#dc2626' }}>*</span></label>
                <input type="date" value={form.expense_date} onChange={e => setForm(p => ({ ...p, expense_date: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {/* Paid from: a Bank & Cash account of the expense's branch */}
              <div style={{ display: form.owed ? 'none' : undefined }}>
                <MoneyAccountSelect id="expensePaidFrom" label="Paid from" value={form.money_account_id}
                  onChange={(v, auto) => { setForm(p => ({ ...p, money_account_id: v })); if (!auto) setAccountChanged(true); }}
                  defaultTo={editExpense ? 'main' : 'remembered'}
                  branchId={form.branch_id || null} amount={Number(form.amount) || 0} />
              </div>
              {/* Branch */}
              {isAdmin && branches.length > 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '4px' }}>Branch</label>
                  <select value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', boxSizing: 'border-box' }}>
                    <option value="">No branch (company-level)</option>
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
