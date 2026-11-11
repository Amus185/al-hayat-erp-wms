import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiPost } from '../api/client';
import { Modal } from './Modal';
import { useToast } from '../contexts/ToastContext';
import { loadMoneyAccountOptions, type MoneyAccountOption } from './MoneyAccountSelect';

export interface ExpenseAccount { id: string; code: string; name: string }
interface Row { expense_date: string; title: string; expenseAccountId: string; amount: string; moneyAccountId: string; branch_id: string; reference: string }
const OWED = '__owed';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Spreadsheet-style entry: many expenses on one screen, saved together (all or none).
 * Each row: date, description, expense account (chart of accounts), amount, paid from, branch, reference.
 */
export function BulkExpenses({ open, onClose, onSaved, accounts, branches, fixedBranchId }: {
  open: boolean; onClose: () => void; onSaved: () => void;
  accounts: ExpenseAccount[]; branches: { id: string; name: string }[]; fixedBranchId: string | null;
}) {
  const { addToast } = useToast();
  const blank = (prev?: Row): Row => ({ expense_date: prev?.expense_date || today(), title: '', expenseAccountId: prev?.expenseAccountId || '', amount: '', moneyAccountId: prev?.moneyAccountId || '', branch_id: prev?.branch_id || fixedBranchId || '', reference: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [money, setMoney] = useState<MoneyAccountOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([blank(), blank(), blank()]);
    loadMoneyAccountOptions(fixedBranchId).then(setMoney).catch(() => setMoney([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (i: number, k: keyof Row, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const filled = rows.filter((r) => r.title.trim() || r.amount);
  const total = filled.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  // accounts a row may use: its branch's own and company-wide ones
  const moneyFor = (r: Row) => money.filter((m) => !m.branch_id || !r.branch_id || m.branch_id === r.branch_id);

  const save = async () => {
    if (!filled.length) { addToast('error', 'Enter at least one expense.'); return; }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]; if (!(r.title.trim() || r.amount)) continue;
      const n = `Row ${i + 1}`;
      if (!r.title.trim()) { addToast('error', `${n}: enter a description.`); return; }
      if (!(Number(r.amount) > 0)) { addToast('error', `${n}: enter an amount above 0.`); return; }
      if (!r.expenseAccountId) { addToast('error', `${n}: choose the expense account.`); return; }
      if (!r.moneyAccountId) { addToast('error', `${n}: choose where it is paid from (or "Not paid yet").`); return; }
    }
    setSaving(true);
    try {
      const res: any = await apiPost('/expenses/bulk', {
        rows: filled.map((r) => ({
          title: r.title.trim(), amount: Number(r.amount), expense_date: r.expense_date, expenseAccountId: r.expenseAccountId,
          branch_id: r.branch_id || undefined, reference: r.reference || undefined,
          ...(r.moneyAccountId === OWED ? { payment_method: 'UNPAID' } : { moneyAccountId: r.moneyAccountId }),
        })),
      });
      addToast('success', `${res.count} expense${res.count === 1 ? '' : 's'} saved.`);
      onSaved(); onClose();
    } catch (e: any) { addToast('error', e?.message); } finally { setSaving(false); }
  };

  const cell: React.CSSProperties = { padding: 4, verticalAlign: 'top' };
  const input: React.CSSProperties = { width: '100%', minWidth: 0, padding: '7px 8px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box', background: '#fff' };
  return (
    <Modal isOpen={open} onClose={() => !saving && onClose()} title="Enter several expenses" width="xl" id="bulk-expenses"
      footer={<div style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>{filled.length} expense{filled.length === 1 ? '' : 's'} · ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" id="bulk-save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save all'}</button>
        </span>
      </div>}>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 8px' }}>One line per expense. Empty lines are ignored. They are saved together: if one line is wrong, nothing is saved.</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 1020, borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left', fontSize: 12, color: '#64748b' }}>
            <th style={cell}>Date</th><th style={{ ...cell, width: '22%' }}>Description</th><th style={{ ...cell, width: '18%' }}>Expense account</th>
            <th style={{ ...cell, width: 100 }}>Amount</th><th style={{ ...cell, width: '18%' }}>Paid from</th>
            {!fixedBranchId && <th style={{ ...cell, width: 130 }}>Branch</th>}<th style={{ ...cell, width: 110 }}>Reference</th><th style={cell} />
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={cell}><input style={input} type="date" value={r.expense_date} onChange={(e) => set(i, 'expense_date', e.target.value)} /></td>
                <td style={cell}><input style={input} className="bulk-title" value={r.title} onChange={(e) => set(i, 'title', e.target.value)} placeholder="e.g. Fuel for the truck" /></td>
                <td style={cell}><select style={input} className="bulk-account" value={r.expenseAccountId} onChange={(e) => set(i, 'expenseAccountId', e.target.value)}>
                  <option value="">— choose —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></td>
                <td style={cell}><input style={input} className="bulk-amount" type="number" min="0" step="0.01" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} placeholder="0.00" /></td>
                <td style={cell}><select style={input} className="bulk-paid" value={r.moneyAccountId} onChange={(e) => set(i, 'moneyAccountId', e.target.value)}>
                  <option value="">— choose —</option>{moneyFor(r).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}<option value={OWED}>Not paid yet (owed)</option></select></td>
                {!fixedBranchId && <td style={cell}><select style={input} value={r.branch_id} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, branch_id: e.target.value, moneyAccountId: '' } : x)))}>
                  <option value="">Company</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>}
                <td style={cell}><input style={input} value={r.reference} onChange={(e) => set(i, 'reference', e.target.value)} placeholder="receipt no." /></td>
                <td style={cell}><button type="button" className="mm-icon" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" id="bulk-add-row" style={{ marginTop: 8 }} onClick={() => setRows((rs) => [...rs, blank(rs[rs.length - 1])])}><Plus size={14} /> Add a line</button>
    </Modal>
  );
}
