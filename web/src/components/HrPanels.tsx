// HR & payroll (roadmap items 22-24): attendance, commissions and payroll runs.
import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { Modal } from './Modal';
import { SearchableSelect } from './SearchableSelect';
import { MoneyAccountSelect } from './MoneyAccountSelect';
import { DownloadDocButton } from './DownloadDocButton';
import { downloadPayslip } from '../utils/documents';
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
const STATUS: { key: string; label: string; color: string }[] = [
  { key: 'PRESENT', label: 'Present', color: '#066006' }, { key: 'LATE', label: 'Late', color: '#b45309' },
  { key: 'ABSENT', label: 'Absent', color: '#b91c1c' }, { key: 'LEAVE', label: 'Leave', color: '#0369a1' },
];

/** Mark the day's attendance for everyone at once; monthly summary below. */
export function AttendancePanel() {
  const { addToast } = useToast();
  const [date, setDate] = useState(iso(new Date()));
  const [rows, setRows] = useState<any[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any[] | null>(null);
  const load = useCallback(() => { setRows(null); setDirty(false); apiGet<any>('/hr/attendance', { date }).then((d) => setRows(d.rows)).catch((e) => { addToast('error', e?.message); setRows([]); }); }, [date, addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet<any>('/hr/attendance/summary', { period: date.slice(0, 7) }).then((d) => setSummary(d.rows)).catch(() => setSummary([])); }, [date, busy]);
  const set = (id: string, patch: any) => { setDirty(true); setRows((p) => (p || []).map((r) => (r.employee_id === id ? { ...r, ...patch } : r))); };
  const save = async () => {
    setBusy(true);
    try {
      const r: any = await apiPut('/hr/attendance', { date, records: (rows || []).map((x) => ({ employeeId: x.employee_id, status: x.status || null, checkIn: x.check_in || undefined, checkOut: x.check_out || undefined, lateMinutes: x.late_minutes, notes: x.notes })) });
      addToast('success', `Attendance saved for ${r.saved} employee${r.saved === 1 ? '' : 's'}.`); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const cols: Column<any>[] = [
    { key: 'full_name', label: 'Employee', render: (r) => <span><strong>{r.full_name}</strong><span className="mm-sub">{[r.position, r.branch_name].filter(Boolean).join(' · ')}</span></span> },
    { key: 'status', label: 'Today', render: (r) => (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {STATUS.map((s) => <button key={s.key} type="button" className="btn btn--sm att-btn" data-status={s.key} onClick={() => set(r.employee_id, { status: r.status === s.key ? null : s.key })}
          style={{ border: `1px solid ${r.status === s.key ? s.color : '#e2e8f0'}`, background: r.status === s.key ? s.color : '#fff', color: r.status === s.key ? '#fff' : '#334155', padding: '4px 10px' }}>{s.label}</button>)}
      </span>) },
    { key: 'times', label: 'In / out', render: (r) => (
      <span style={{ display: 'flex', gap: 4 }}>
        <input className="form-input" type="time" style={{ width: 110, minHeight: 32, padding: '2px 6px' }} value={r.check_in || ''} onChange={(e) => set(r.employee_id, { check_in: e.target.value })} />
        <input className="form-input" type="time" style={{ width: 110, minHeight: 32, padding: '2px 6px' }} value={r.check_out || ''} onChange={(e) => set(r.employee_id, { check_out: e.target.value })} />
      </span>) },
    { key: 'late_minutes', label: 'Minutes late', render: (r) => r.status === 'LATE' ? <input className="form-input" type="number" min="0" style={{ width: 80, minHeight: 32, padding: '2px 6px' }} value={r.late_minutes || ''} onChange={(e) => set(r.employee_id, { late_minutes: Number(e.target.value) })} /> : '—' },
  ];
  const sumCols: Column<any>[] = [
    { key: 'full_name', label: 'Employee', render: (r) => <span><strong>{r.full_name}</strong>{r.branch_name ? <span className="mm-sub">{r.branch_name}</span> : null}</span> },
    { key: 'present', label: 'Present' }, { key: 'late', label: 'Late', render: (r) => r.late ? <span style={{ color: '#b45309' }}>{r.late} ({r.late_minutes} min)</span> : '0' },
    { key: 'absent', label: 'Absent', render: (r) => r.absent ? <strong style={{ color: '#b91c1c' }}>{r.absent}</strong> : '0' }, { key: 'leave', label: 'Leave' },
  ];
  return (
    <div id="attendance-panel">
      <h3 style={{ margin: '0 0 4px' }}>Attendance</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>Mark each person for the day, then Save. Absent days are taken off the salary in the payroll; leave is paid.</p>
      <div style={row}>
        <Field label="Day"><input className="form-input" type="date" id="att-date" value={date} max={iso(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        <button className="btn btn--secondary" onClick={() => { setDirty(true); setRows((p) => (p || []).map((r) => (r.status ? r : { ...r, status: 'PRESENT' }))); }}>Everyone else present</button>
        <button className="btn btn--primary" id="att-save" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</button>
      </div>
      {!rows ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="attendance-table" data={rows} columns={cols} keyExtractor={(r) => r.employee_id} emptyMessage="No active employees." />}
      <h4 style={{ margin: '20px 0 8px' }}>This month ({date.slice(0, 7)})</h4>
      {summary && <DataTable id="attendance-summary" data={summary} columns={sumCols} keyExtractor={(r) => r.employee_id} emptyMessage="No active employees." />}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { PERCENT_REVENUE: '% of net sales', FIXED_PER_SALE: 'Fixed amount per sale', PERCENT_PRODUCT: '% of a product\'s sales', FIXED_PER_UNIT: 'Fixed amount per unit of a product' };

/** Commission rules, the link between employees and their sales login, and this month's commissions. */
export function CommissionsPanel() {
  const { addToast } = useToast();
  const { hasPermission, branchId } = useAuth();
  const canManage = hasPermission('payroll.manage') && !branchId;
  const [period, setPeriod] = useState(iso(new Date()).slice(0, 7));
  const [rules, setRules] = useState<any[] | null>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [form, setForm] = useState({ employeeId: '', kind: 'PERCENT_REVENUE', rate: '', productId: '', productLabel: '' });
  const load = useCallback(() => {
    apiGet<any>('/hr/commission-rules').then((d) => setRules(d.rules)).catch(() => setRules([]));
    apiGet<any>('/hr/commissions', { period }).then((d) => setRows(d.rows)).catch((e) => { addToast('error', e?.message); setRows([]); });
  }, [period, addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet<any>('/employees', { page: 1, pageSize: 200, status: 'ACTIVE' }).then((d) => setEmployees(d.items || [])).catch(() => {});
    if (canManage) apiGet<any>('/hr/users').then((d) => setUsers(d.users || [])).catch(() => {});
  }, [canManage]);
  const add = async () => {
    try { await apiPost('/hr/commission-rules', { employeeId: form.employeeId || undefined, kind: form.kind, rate: Number(form.rate), productId: form.productId || undefined }); addToast('success', 'Commission rule added.'); setForm({ ...form, rate: '', productId: '', productLabel: '' }); load(); }
    catch (e: any) { addToast('error', e?.message); }
  };
  const link = async (employeeId: string, userId: string) => {
    try { await apiPut(`/hr/employees/${employeeId}/user`, { userId: userId || null }); addToast('success', 'Saved.'); load(); apiGet<any>('/hr/users').then((d) => setUsers(d.users || [])).catch(() => {}); } catch (e: any) { addToast('error', e?.message); }
  };
  const needsProduct = form.kind === 'PERCENT_PRODUCT' || form.kind === 'FIXED_PER_UNIT';
  const ruleCols: Column<any>[] = [
    { key: 'employee_name', label: 'For', render: (r) => <strong>{r.employee_name || 'Every seller'}</strong> },
    { key: 'kind', label: 'Rule', render: (r) => `${r.kind.startsWith('PERCENT') ? `${r.rate}%` : money(r.rate)} · ${KIND_LABEL[r.kind]}${r.product_name ? `: ${r.product_name}` : ''}` },
    { key: 'is_active', label: 'Status', render: (r) => Number(r.is_active) === 1 ? 'In use' : <span style={{ color: '#94a3b8' }}>Stopped</span> },
    ...(canManage ? [{ key: 'a', label: '', render: (r: any) => <button className="btn btn--secondary btn--sm" onClick={() => apiPatch(`/hr/commission-rules/${r.id}`, { is_active: Number(r.is_active) !== 1 }).then(load).catch((e: any) => addToast('error', e?.message))}>{Number(r.is_active) === 1 ? 'Stop' : 'Use again'}</button> }] : []),
  ];
  const userOf = (empId: string) => users.find((u) => u.employee_id === empId)?.id || '';
  const cols: Column<any>[] = [
    { key: 'full_name', label: 'Employee', render: (r) => <span><strong>{r.full_name}</strong>{r.branch_name ? <span className="mm-sub">{r.branch_name}</span> : null}</span> },
    { key: 'linked', label: 'Sells as', render: (r) => canManage
      ? <select className="form-select emp-user" style={{ minHeight: 32, padding: '2px 26px 2px 8px', maxWidth: 220 }} value={userOf(r.employee_id)} onChange={(e) => link(r.employee_id, e.target.value)}><option value="">— not linked —</option>{users.filter((u) => !u.employee_id || u.employee_id === r.employee_id).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      : (r.linked ? 'Linked' : <span style={{ color: '#94a3b8' }}>Not linked</span>) },
    { key: 'total', label: 'Commission', render: (r) => <span><strong>{money(r.total)}</strong>{r.parts.map((p: any, i: number) => <span key={i} className="mm-sub">{p.label}: {money(p.amount)}</span>)}</span> },
  ];
  return (
    <div id="commissions-panel">
      <h3 style={{ margin: '0 0 4px' }}>Commissions</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>Commission is counted on invoiced sales of the month, less discounts and returns; cancelled sales never count. Link each employee to the login they sell with.</p>
      {canManage && (
        <div style={{ ...box, marginBottom: 14 }}>
          <div style={{ ...row, marginBottom: 0 }}>
            <Field label="For" min={180}><select className="form-select" id="rule-employee" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}><option value="">Every seller</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
            <Field label="Counted as" min={200}><select className="form-select" id="rule-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {needsProduct && <Field label="Product" min={200}><SearchableSelect options={[]} value={form.productId} selectedLabel={form.productLabel} placeholder="Search product…"
              loadOptions={async (q) => { const r = await apiGet<{ items: any[] }>('/products', { page: 1, pageSize: 25, q: q || undefined, sort: 'name', dir: 'asc' }); return r.items.map((p) => ({ value: `${p.id}|${p.name}`, label: p.name, sublabel: p.sku })); }}
              onChange={(v) => { const [id, ...n] = v.split('|'); setForm((p) => ({ ...p, productId: id, productLabel: n.join('|') })); }} /></Field>}
            <Field label={form.kind.startsWith('PERCENT') ? 'Percent (%)' : 'Amount ($)'}><input className="form-input" id="rule-rate" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} style={{ width: 110 }} /></Field>
            <button className="btn btn--primary" id="rule-add" onClick={add}>Add rule</button>
          </div>
        </div>
      )}
      {rules && <DataTable id="rules-table" data={rules} columns={ruleCols} keyExtractor={(r) => r.id} emptyMessage="No commission rules yet." />}
      <div style={{ ...row, marginTop: 16 }}><Field label="Month"><input className="form-input" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></Field></div>
      {!rows ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="commissions-table" data={rows} columns={cols} keyExtractor={(r) => r.employee_id} emptyMessage="No active employees." />}
    </div>
  );
}

const RUN_WORD: Record<string, string> = { DRAFT: 'Draft', APPROVED: 'Approved — to pay', PAID: 'Paid' };

/** Monthly payroll: calculate, adjust, approve (posted to the books), then pay from a chosen account. */
export function PayrollPanel() {
  const { addToast } = useToast();
  const { hasPermission, branchId } = useAuth();
  const canManage = hasPermission('payroll.manage') && !branchId;
  const [runs, setRuns] = useState<any[] | null>(null);
  const [run, setRun] = useState<any>(null);
  const [newPeriod, setNewPeriod] = useState(iso(new Date()).slice(0, 7));
  const [days, setDays] = useState('26');
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState<{ lineIds?: string[]; total: number } | null>(null);
  const [payFrom, setPayFrom] = useState('');
  const loadRuns = useCallback(() => apiGet<any>('/hr/payroll').then((d) => setRuns(d.runs)).catch((e) => { addToast('error', e?.message); setRuns([]); }), [addToast]);
  const open = useCallback((id: string) => apiGet<any>(`/hr/payroll/${id}`).then(setRun).catch((e) => addToast('error', e?.message)), [addToast]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try { await fn(); addToast('success', ok); loadRuns(); if (run) open(run.id); } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const create = () => act(async () => { const r: any = await apiPost('/hr/payroll', { period: newPeriod, workingDays: Number(days) }); open(r.id); }, 'Payroll calculated. Check it, then approve.');
  const edit = (l: any, k: string, label: string) => {
    const v = window.prompt(`${label} for ${l.full_name}`, String(l[k] || 0));
    if (v === null) return;
    act(() => apiPatch(`/hr/payroll/${run.id}/lines/${l.id}`, { [k]: Number(v) }), 'Updated.');
  };
  const draft = run?.status === 'DRAFT';
  const lineCols: Column<any>[] = [
    { key: 'full_name', label: 'Employee', render: (l) => <span><strong>{l.full_name}</strong><span className="mm-sub">{l.branch_name || 'Company'}</span></span> },
    { key: 'basic', label: 'Salary', render: (l) => money(l.basic) },
    { key: 'attendance_deduction', label: 'Absences', render: (l) => l.attendance_deduction > 0 ? <span style={{ color: '#b91c1c' }}>-{money(l.attendance_deduction)} ({l.absent_days} d)</span> : '—' },
    { key: 'commission', label: 'Commission', render: (l) => l.commission > 0 ? <span title={l.notes || ''}>{money(l.commission)}</span> : '—' },
    { key: 'additions', label: 'Bonus', render: (l) => draft && canManage ? <button className="btn btn--secondary btn--sm" onClick={() => edit(l, 'additions', 'Bonus / other additions')}>{l.additions > 0 ? money(l.additions) : 'Add'}</button> : (l.additions > 0 ? money(l.additions) : '—') },
    { key: 'other_deductions', label: 'Other deductions', render: (l) => draft && canManage ? <button className="btn btn--secondary btn--sm" onClick={() => edit(l, 'other_deductions', 'Other deductions')}>{l.other_deductions > 0 ? `-${money(l.other_deductions)}` : 'Add'}</button> : (l.other_deductions > 0 ? `-${money(l.other_deductions)}` : '—') },
    { key: 'advance_deduction', label: 'Advance taken back', render: (l) => draft && canManage ? <button className="btn btn--secondary btn--sm" onClick={() => edit(l, 'advance_deduction', 'Advance to take back')}>{l.advance_deduction > 0 ? `-${money(l.advance_deduction)}` : '—'}</button> : (l.advance_deduction > 0 ? `-${money(l.advance_deduction)}` : '—') },
    { key: 'net', label: 'Net pay', render: (l) => <strong>{money(l.net)}</strong> },
    { key: 'status', label: '', render: (l) => (
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {l.status === 'PAID' ? <span style={{ color: '#066006', fontWeight: 700 }}>Paid</span> : (!draft && canManage && l.net > 0 ? <button className="btn btn--primary btn--sm" onClick={() => setPayOpen({ lineIds: [l.id], total: l.net })}>Pay</button> : null)}
        <DownloadDocButton iconOnly label={`Download payslip ${l.full_name}`} make={() => downloadPayslip(run, l)} />
      </span>) },
  ];
  const runCols: Column<any>[] = [
    { key: 'period', label: 'Month', render: (r) => <strong>{new Date(`${r.period}-01T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong> },
    { key: 'employees', label: 'Employees' },
    { key: 'total_net', label: 'Net pay', render: (r) => money(r.total_net) },
    { key: 'paid', label: 'Paid', render: (r) => money(r.paid) },
    { key: 'status', label: 'Status', render: (r) => <strong style={{ color: r.status === 'PAID' ? '#066006' : r.status === 'APPROVED' ? '#b45309' : '#475569' }}>{RUN_WORD[r.status] || r.status}</strong> },
    { key: 'a', label: '', render: (r) => <button className="btn btn--secondary btn--sm payroll-open" onClick={() => open(r.id)}>Open</button> },
  ];
  const unpaid = run ? run.lines.filter((l: any) => l.status !== 'PAID' && l.net > 0) : [];
  return (
    <div id="payroll-panel">
      <h3 style={{ margin: '0 0 4px' }}>Payroll</h3>
      <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>Salary − absent days + commission + bonus − deductions − advances = net pay. Approving posts the salaries to the books (owed to staff); paying takes the money from the account you choose.</p>
      {canManage && (
        <div style={row}>
          <Field label="Month"><input className="form-input" type="month" id="payroll-month" value={newPeriod} onChange={(e) => setNewPeriod(e.target.value)} /></Field>
          <Field label="Working days"><input className="form-input" type="number" min="1" max="31" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 100 }} /></Field>
          <button className="btn btn--primary" id="payroll-create" disabled={busy} onClick={create}>Calculate payroll</button>
        </div>
      )}
      {runs && <DataTable id="payroll-runs" data={runs} columns={runCols} keyExtractor={(r) => r.id} emptyMessage="No payroll yet." />}
      {run && (
        <div style={{ ...box, marginTop: 16 }} id="payroll-run">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0 }}>Payroll {run.period} · {RUN_WORD[run.status]}</h4>
            {canManage && (
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {draft && <button className="btn btn--secondary" disabled={busy} onClick={() => act(() => apiPost(`/hr/payroll/${run.id}/recalculate`, {}), 'Recalculated.')}>Recalculate</button>}
                {draft && <button className="btn btn--secondary" disabled={busy} onClick={() => { if (window.confirm('Delete this draft payroll?')) act(async () => { await apiDelete(`/hr/payroll/${run.id}`); setRun(null); }, 'Draft deleted.'); }}>Delete draft</button>}
                {draft && <button className="btn btn--primary" id="payroll-approve" disabled={busy} onClick={() => { if (window.confirm(`Approve the payroll of ${run.period}? It is posted to the books and can no longer be changed.`)) act(() => apiPost(`/hr/payroll/${run.id}/approve`, {}), 'Payroll approved and posted.'); }}>Approve</button>}
                {!draft && unpaid.length > 0 && <button className="btn btn--primary" id="payroll-pay-all" onClick={() => setPayOpen({ total: unpaid.reduce((a: number, l: any) => a + l.net, 0) })}>Pay everyone ({money(unpaid.reduce((a: number, l: any) => a + l.net, 0))})</button>}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
            <Card label="Salaries" value={money(run.totals.basic)} /><Card label="Absences" value={`-${money(run.totals.attendance_deduction)}`} />
            <Card label="Commission" value={money(run.totals.commission)} /><Card label="Advances back" value={`-${money(run.totals.advance_deduction)}`} /><Card label="Net pay" value={money(run.totals.net)} />
          </div>
          <DataTable id="payroll-lines" data={run.lines} columns={lineCols} keyExtractor={(l) => l.id} />
        </div>
      )}
      <Modal open={!!payOpen} onClose={() => setPayOpen(null)} title={`Pay salaries · ${money(payOpen?.total || 0)}`}
        footer={<><button className="btn btn--secondary" onClick={() => setPayOpen(null)}>Cancel</button><button className="btn btn--primary" id="payroll-pay-confirm" disabled={busy || !payFrom} onClick={() => act(async () => { await apiPost(`/hr/payroll/${run.id}/pay`, { moneyAccountId: payFrom, lineIds: payOpen?.lineIds }); setPayOpen(null); }, 'Salaries paid.')}>Pay</button></>}>
        <MoneyAccountSelect id="payroll-from" label="Paid from" value={payFrom} onChange={setPayFrom} mustChoose amount={payOpen?.total} branchId={null} />
      </Modal>
    </div>
  );
}
