import { useEffect, useRef, useState } from 'react';
import { FileText, Pencil, Plus, Trash2, Upload, Wallet } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost, apiUpload, fileUrl } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { ListToolbar } from '../components/ListToolbar';
import { StatusTabs } from '../components/StatusTabs';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { ModalLoading } from '../components/ModalLoading';
import { useServerList, useOpenParam } from '../utils/serverList';
import { useToast } from '../contexts/ToastContext';
import { confirmAction } from '../utils/swal';

interface Employee {
  id: string; full_name: string; phone: string | null; email: string | null; position: string | null;
  branch_id: string | null; branch_name: string | null; hire_date: string | null; national_id: string | null; address: string | null;
  salary: number; photo_key: string | null; document_key: string | null; document_name: string | null;
  status: 'ACTIVE' | 'INACTIVE'; notes: string | null;
  total_advances: number; total_repaid: number; advance_balance: number;
}
interface Advance { id: string; kind: 'ADVANCE' | 'REPAYMENT'; amount: number; entry_date: string; method: string; notes: string | null; created_by_name: string | null }
type Profile = Employee & { advances: Advance[] };

const money = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string | null) => (d ? String(d).slice(0, 10) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const METHOD: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', SALARY_DEDUCTION: 'Deducted from salary' };
const EMPTY = { full_name: '', phone: '', email: '', position: '', branch_id: '', hire_date: '', national_id: '', address: '', salary: '', status: 'ACTIVE', notes: '', photo_key: '', document_key: '', document_name: '' };

function Photo({ emp, small }: { emp: Pick<Employee, 'photo_key' | 'full_name'>; small?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = `emp-photo${small ? ' emp-photo--sm' : ''}`;
  if (emp.photo_key && !broken) return <img className={cls} src={fileUrl(emp.photo_key)} alt="" onError={() => setBroken(true)} />;
  return <span className={cls} aria-hidden>{emp.full_name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

export function EmployeesPage() {
  const { addToast } = useToast();
  const list = useServerList<Employee>('/employees', { key: 'employees', filters: ['status', 'branchId', 'balance'], defaultSort: 'name', defaultDir: 'asc' });
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { apiGet<any[]>('/branches').then((b) => setBranches(b || [])).catch(() => {}); }, []);

  // Create / edit
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'' | 'photo' | 'document'>('');
  const photoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  // Profile
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [adv, setAdv] = useState({ kind: 'ADVANCE', amount: '', method: 'CASH', entry_date: today(), notes: '' });
  const [advSaving, setAdvSaving] = useState(false);

  const loadProfile = async (id: string) => {
    try { setProfile(await apiGet<Profile>(`/employees/${id}`)); } catch (err: any) { addToast('error', err?.message || 'Could not open the profile'); setProfileId(null); }
  };
  const openProfile = (id: string) => {
    setProfileId(id); setProfile(null);
    setAdv({ kind: 'ADVANCE', amount: '', method: 'CASH', entry_date: today(), notes: '' });
    loadProfile(id);
  };
  useOpenParam(openProfile);

  const openCreate = () => { setEditId(null); setForm(EMPTY); setFormOpen(true); };
  const openEdit = (e: Employee) => {
    setEditId(e.id);
    setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, (e as any)[k] == null ? '' : k === 'hire_date' ? day((e as any)[k]) : String((e as any)[k])])));
    setFormOpen(true);
  };

  const upload = async (kind: 'photo' | 'document', files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (kind === 'photo' && !file.type.startsWith('image/')) { addToast('error', 'Choose a photo (JPG, PNG…)'); return; }
    setUploading(kind);
    try {
      const f = await apiUpload(file);
      setForm((p) => (kind === 'photo' ? { ...p, photo_key: f.object_key } : { ...p, document_key: f.object_key, document_name: file.name }));
    } catch (err: any) {
      addToast('error', err?.message || 'Upload failed');
    } finally {
      setUploading('');
      if (photoInput.current) photoInput.current.value = '';
      if (docInput.current) docInput.current.value = '';
    }
  };

  const save = async () => {
    if (!form.full_name.trim()) { addToast('error', 'Full name is required'); return; }
    setSaving(true);
    try {
      const body = { ...form, salary: Number(form.salary) || 0 };
      const saved = editId ? await apiPatch<Employee>(`/employees/${editId}`, body) : await apiPost<Employee>('/employees', body);
      addToast('success', `${saved.full_name} saved`);
      setFormOpen(false);
      list.refresh();
      if (profileId === saved.id) loadProfile(saved.id);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const recordAdvance = async () => {
    if (!profile) return;
    const amount = Number(adv.amount);
    if (!(amount > 0)) { addToast('error', 'Enter an amount greater than zero'); return; }
    setAdvSaving(true);
    try {
      await apiPost(`/employees/${profile.id}/advances`, { ...adv, amount });
      addToast('success', `${adv.kind === 'ADVANCE' ? 'Advance' : 'Repayment'} of ${money(amount)} recorded`);
      setAdv((p) => ({ ...p, amount: '', notes: '' }));
      await loadProfile(profile.id);
      list.refresh();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not record');
    } finally {
      setAdvSaving(false);
    }
  };
  const deleteAdvance = async (a: Advance) => {
    if (!profile || !(await confirmAction('Delete this entry?', `${a.kind === 'ADVANCE' ? 'Advance' : 'Repayment'} of ${money(a.amount)} on ${day(a.entry_date)}. Its accounting entry is reversed.`))) return;
    try { await apiDelete(`/employees/${profile.id}/advances/${a.id}`); await loadProfile(profile.id); list.refresh(); } catch (err: any) { addToast('error', err?.message || 'Could not delete'); }
  };
  const deleteEmployee = async (e: Employee) => {
    if (!(await confirmAction(`Delete ${e.full_name}?`, 'Employees with advance history cannot be deleted; mark them Inactive instead.'))) return;
    try { await apiDelete(`/employees/${e.id}`); addToast('success', `${e.full_name} deleted`); setProfileId(null); list.refresh(); } catch (err: any) { addToast('error', err?.message || 'Could not delete'); }
  };

  const columns: Column<Employee>[] = [
    { key: 'full_name', label: 'Name', sortable: true, sortKey: 'name', render: (e) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Photo emp={e} small /><span><strong>{e.full_name}</strong><span className="mm-sub">{e.phone || ''}</span></span></span>
    ) },
    { key: 'position', label: 'Position', sortable: true, render: (e) => e.position || '—' },
    { key: 'branch_name', label: 'Branch', sortable: true, sortKey: 'branch', render: (e) => e.branch_name || '—' },
    { key: 'salary', label: 'Salary', sortable: true, render: (e) => money(e.salary) },
    { key: 'advance_balance', label: 'Advance balance', sortable: true, sortKey: 'balance', render: (e) => <strong style={{ color: e.advance_balance > 0 ? '#b45309' : undefined }}>{money(e.advance_balance)}</strong> },
    { key: 'status', label: 'Status', render: (e) => <StatusBadge label={e.status} tone={e.status === 'ACTIVE' ? 'green' : 'neutral'} /> },
  ];

  const f = (k: string) => ({ value: form[k] ?? '', onChange: (ev: any) => setForm((p) => ({ ...p, [k]: ev.target.value })) });

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Employees</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>
            {list.total.toLocaleString()} employees · salaries {money(list.totals?.salary ?? 0)} · advances owed {money(list.totals?.balance ?? 0)}
          </p>
        </div>
        <button type="button" className="btn btn-primary" id="new-employee" onClick={openCreate}><Plus size={16} /> New Employee</button>
      </div>

      <div className="panel" style={{ padding: '12px' }}>
        <StatusTabs id="emp-status" value={list.filters.status} counts={list.counts} onChange={(v) => list.setFilter('status', v)}
          tabs={[{ key: 'ALL', label: 'All' }, { key: 'ACTIVE', label: 'Active' }, { key: 'INACTIVE', label: 'Inactive' }]} />
        <ListToolbar id="emp-toolbar" list={list} searchPlaceholder="Search name, phone, position or ID…"
          filters={[
            { key: 'branchId', label: 'All branches', options: branches.map((b) => ({ value: b.id, label: b.name })) },
            { key: 'balance', label: 'Any advance balance', options: [{ value: 'owing', label: 'Owes an advance' }] },
          ]} />
        <DataTable id="emp-table" data={list.items} columns={columns} server={list} keyExtractor={(e) => e.id} onRowClick={(e) => openProfile(e.id)}
          emptyMessage={list.activeFilters ? 'No employees match your filters' : "No employees yet. Click 'New Employee' to add one."} />
      </div>

      {/* Profile */}
      <Modal isOpen={!!profileId} onClose={() => setProfileId(null)} title={profile ? profile.full_name : 'Employee profile'} width="lg">
        {!profile ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="emp-head">
              <Photo emp={profile} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{profile.full_name} <StatusBadge label={profile.status} tone={profile.status === 'ACTIVE' ? 'green' : 'neutral'} /></div>
                <div className="mm-sub">{[profile.position, profile.branch_name].filter(Boolean).join(' · ') || 'No position set'}</div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(profile)}><Pencil size={14} /> Edit</button>
              <button type="button" className="mm-icon" aria-label="Delete employee" onClick={() => deleteEmployee(profile)}><Trash2 size={15} /></button>
            </div>

            <div className="emp-stats">
              <div className="emp-stat"><span>Normal salary</span><strong>{money(profile.salary)}</strong></div>
              <div className="emp-stat"><span>Total advances</span><strong>{money(profile.total_advances)}</strong></div>
              <div className="emp-stat"><span>Repaid</span><strong>{money(profile.total_repaid)}</strong></div>
              <div className="emp-stat"><span>Remaining balance</span><strong style={{ color: profile.advance_balance > 0 ? '#b45309' : '#066006' }}>{money(profile.advance_balance)}</strong></div>
            </div>

            <dl className="emp-info">
              <div><dt>Phone</dt><dd>{profile.phone || '—'}</dd></div>
              <div><dt>Email</dt><dd>{profile.email || '—'}</dd></div>
              <div><dt>Hire date</dt><dd>{day(profile.hire_date)}</dd></div>
              <div><dt>National ID</dt><dd>{profile.national_id || '—'}</dd></div>
              <div><dt>Address</dt><dd>{profile.address || '—'}</dd></div>
              <div><dt>Employment document</dt><dd>{profile.document_key
                ? <a href={fileUrl(profile.document_key)} target="_blank" rel="noreferrer"><FileText size={13} style={{ verticalAlign: '-2px' }} /> {profile.document_name || 'Open document'}</a>
                : '—'}</dd></div>
              {profile.notes && <div style={{ gridColumn: '1 / -1' }}><dt>Notes</dt><dd>{profile.notes}</dd></div>}
            </dl>

            <div>
              <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={16} /> Salary advances</h4>
              <div className="emp-adv-form">
                <label className="form-field"><span className="form-field__label">Type</span>
                  <select className="form-select" value={adv.kind} onChange={(e) => setAdv({ ...adv, kind: e.target.value, method: e.target.value === 'REPAYMENT' ? 'SALARY_DEDUCTION' : 'CASH' })}>
                    <option value="ADVANCE">Give advance</option>
                    <option value="REPAYMENT">Repayment</option>
                  </select></label>
                <label className="form-field"><span className="form-field__label">Amount</span>
                  <input className="form-input" id="adv-amount" type="number" min="0" step="0.01" inputMode="decimal" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} placeholder="0.00" /></label>
                <label className="form-field"><span className="form-field__label">Paid by</span>
                  <select className="form-select" value={adv.method} onChange={(e) => setAdv({ ...adv, method: e.target.value })}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                    {adv.kind === 'REPAYMENT' && <option value="SALARY_DEDUCTION">Deducted from salary</option>}
                  </select></label>
                <label className="form-field"><span className="form-field__label">Date</span>
                  <input className="form-input" type="date" value={adv.entry_date} onChange={(e) => setAdv({ ...adv, entry_date: e.target.value })} /></label>
                <label className="form-field" style={{ flex: 1, minWidth: 140 }}><span className="form-field__label">Note</span>
                  <input className="form-input" value={adv.notes} onChange={(e) => setAdv({ ...adv, notes: e.target.value })} placeholder="optional" /></label>
                <button type="button" className="btn btn-primary" id="record-advance" onClick={recordAdvance} disabled={advSaving}>{advSaving ? 'Saving…' : 'Record'}</button>
              </div>
              <DataTable id="adv-table" data={profile.advances} keyExtractor={(a) => a.id} pageSize={10}
                emptyMessage="No advances yet."
                columns={[
                  { key: 'entry_date', label: 'Date', render: (a) => day(a.entry_date) },
                  { key: 'kind', label: 'Type', render: (a) => <StatusBadge label={a.kind === 'ADVANCE' ? 'Advance' : 'Repayment'} tone={a.kind === 'ADVANCE' ? 'yellow' : 'green'} /> },
                  { key: 'amount', label: 'Amount', render: (a) => <strong>{a.kind === 'ADVANCE' ? '' : '−'}{money(a.amount)}</strong> },
                  { key: 'method', label: 'Paid by', render: (a) => METHOD[a.method] ?? a.method },
                  { key: 'notes', label: 'Note', render: (a) => a.notes || '' },
                  { key: 'created_by_name', label: 'By', render: (a) => a.created_by_name || '' },
                  { key: 'x', label: '', render: (a) => <button type="button" className="mm-icon" aria-label="Delete entry" onClick={() => deleteAdvance(a)}><Trash2 size={14} /></button> },
                ]} />
            </div>
          </div>
        )}
      </Modal>

      {/* Create / edit */}
      <Modal isOpen={formOpen} onClose={() => !saving && setFormOpen(false)} title={editId ? 'Edit employee' : 'New employee'} width="lg" zIndex={1100}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" id="save-employee" onClick={save} disabled={saving || !!uploading}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        }>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="emp-head">
            <Photo emp={{ photo_key: form.photo_key || null, full_name: form.full_name || '?' }} />
            <input ref={photoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => upload('photo', e.target.files)} aria-label="Choose profile photo" />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => photoInput.current?.click()} disabled={!!uploading}>
              <Upload size={14} /> {uploading === 'photo' ? 'Uploading…' : form.photo_key ? 'Change photo' : 'Upload photo'}
            </button>
            {form.photo_key && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm((p) => ({ ...p, photo_key: '' }))}>Remove</button>}
          </div>
          <div className="emp-form">
            <label className="form-field"><span className="form-field__label">Full name *</span><input className="form-input" id="emp-name" {...f('full_name')} /></label>
            <label className="form-field"><span className="form-field__label">Position</span><input className="form-input" {...f('position')} placeholder="e.g. Cashier" /></label>
            <label className="form-field"><span className="form-field__label">Phone</span><input className="form-input" {...f('phone')} /></label>
            <label className="form-field"><span className="form-field__label">Email</span><input className="form-input" type="email" {...f('email')} /></label>
            <label className="form-field"><span className="form-field__label">Branch</span>
              <select className="form-select" {...f('branch_id')}><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="form-field"><span className="form-field__label">Normal salary (monthly)</span><input className="form-input" id="emp-salary" type="number" min="0" step="0.01" {...f('salary')} placeholder="0.00" /></label>
            <label className="form-field"><span className="form-field__label">Hire date</span><input className="form-input" type="date" {...f('hire_date')} /></label>
            <label className="form-field"><span className="form-field__label">National ID</span><input className="form-input" {...f('national_id')} /></label>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Address</span><input className="form-input" {...f('address')} /></label>
            <label className="form-field"><span className="form-field__label">Status</span>
              <select className="form-select" {...f('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label>
            <div className="form-field"><span className="form-field__label">Employment document</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input ref={docInput} type="file" accept=".pdf,.doc,.docx,image/*" style={{ display: 'none' }} onChange={(e) => upload('document', e.target.files)} aria-label="Choose employment document" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => docInput.current?.click()} disabled={!!uploading}>
                  <Upload size={14} /> {uploading === 'document' ? 'Uploading…' : form.document_key ? 'Replace' : 'Upload'}
                </button>
                {form.document_key && <span className="mm-sub" style={{ display: 'inline' }}>{form.document_name || 'document'}</span>}
                {form.document_key && <button type="button" className="mm-icon" aria-label="Remove document" onClick={() => setForm((p) => ({ ...p, document_key: '', document_name: '' }))}><Trash2 size={13} /></button>}
              </div>
            </div>
            <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Notes</span><textarea className="form-textarea" rows={2} {...f('notes')} /></label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
