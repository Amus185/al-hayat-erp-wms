import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';

export interface Vehicle {
  id: string; plate_number: string; make: string | null; model: string | null; vehicle_type: string | null; capacity_note: string | null;
  status: 'ACTIVE' | 'INACTIVE'; default_driver_id: string | null; driver_name: string | null; driver_phone: string | null; driver_employee_name?: string | null;
  branch_id: string | null; branch_name: string | null; notes: string | null; open_deliveries?: number; can_edit?: boolean;
}

const TYPES = ['Truck', 'Van', 'Pickup', 'Motorbike', 'Other'];
// A driver typed in by hand on an older vehicle (not an employee): kept as is unless changed.
const TYPED_DRIVER = '__typed';
const EMPTY = { plate_number: '', make: '', model: '', vehicle_type: 'Truck', capacity_note: '', default_driver_id: '', driver_name: '', driver_phone: '', branchId: '', status: 'ACTIVE', notes: '' };

/**
 * Company Vehicles: registered once, picked on deliveries. A vehicle's usual driver is only
 * a suggestion: each delivery still records who actually drove it.
 */
export function VehiclesPanel() {
  const { addToast } = useToast();
  const { branchId: myBranch } = useAuth();
  const [rows, setRows] = useState<Vehicle[] | null>(null);
  const [employees, setEmployees] = useState<{ id: string; full_name: string; phone: string | null }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');

  const load = () => apiGet<Vehicle[]>('/vehicles').then(setRows).catch((e) => { addToast('error', e?.message); setRows([]); });
  useEffect(() => {
    load();
    apiGet<any[]>('/employees', { status: 'ACTIVE' }).then((r) => setEmployees(r || [])).catch(() => {});
    if (!myBranch) apiGet<any[]>('/branches').then((b) => setBranches((b || []).map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => { setEditId(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (v: Vehicle) => {
    setEditId(v.id);
    // Make and model are one field in the form ("Isuzu NPR"); older records may have them apart.
    setForm({ plate_number: v.plate_number, make: [v.make, v.model].filter(Boolean).join(' '), model: '', vehicle_type: v.vehicle_type ?? 'Truck', capacity_note: v.capacity_note ?? '', default_driver_id: v.default_driver_id ?? '', driver_name: v.driver_name ?? '', driver_phone: v.driver_phone ?? '', branchId: v.branch_id ?? '', status: v.status, notes: v.notes ?? '' });
    setOpen(true);
  };
  const set = (k: string) => ({ value: form[k] ?? '', onChange: (e: any) => setForm((p) => ({ ...p, [k]: e.target.value })) });

  const pickDriver = (id: string) => {
    const emp = employees.find((e) => e.id === id);
    if (id === TYPED_DRIVER) return;
    // The server fills the employee's name and phone; "none" clears the driver.
    setForm((p) => ({ ...p, default_driver_id: id, driver_name: emp ? emp.full_name : '', driver_phone: emp ? (emp.phone ?? '') : '' }));
  };

  const save = async () => {
    if (!form.plate_number.trim()) { addToast('error', 'Enter the vehicle plate number.'); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      if (editId) delete body.branchId; // a vehicle keeps its branch once registered
      editId ? await apiPatch(`/vehicles/${editId}`, body) : await apiPost('/vehicles', body);
      addToast('success', `Vehicle ${form.plate_number.trim()} saved`);
      setOpen(false);
      load();
    } catch (e: any) { addToast('error', e?.message); } finally { setSaving(false); }
  };
  const toggle = async (v: Vehicle) => {
    try { await apiPatch(`/vehicles/${v.id}`, { status: v.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const remove = async (v: Vehicle) => {
    if (!(await confirmAction(`Delete vehicle ${v.plate_number}?`, 'Vehicles used on deliveries cannot be deleted; mark them Inactive instead.'))) return;
    try { await apiDelete(`/vehicles/${v.id}`); addToast('success', `${v.plate_number} deleted`); load(); } catch (e: any) { addToast('error', e?.message); }
  };

  const shown = (rows ?? []).filter((v) => !q.trim() || `${v.plate_number} ${v.make ?? ''} ${v.model ?? ''} ${v.driver_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const columns: Column<Vehicle>[] = [
    { key: 'plate_number', label: 'Plate', render: (v) => <strong style={{ fontFamily: 'monospace' }}>{v.plate_number}</strong> },
    { key: 'make', label: 'Vehicle', render: (v) => <span>{[v.make, v.model].filter(Boolean).join(' ') || '—'}<span className="mm-sub">{[v.vehicle_type, v.capacity_note].filter(Boolean).join(' · ')}</span></span> },
    { key: 'driver_name', label: 'Usual driver', render: (v) => v.driver_name ? <span>{v.driver_name}<span className="mm-sub">{v.driver_phone || ''}</span></span> : '—' },
    { key: 'branch_name', label: 'Belongs to', render: (v) => v.branch_name || 'Whole company' },
    { key: 'open_deliveries', label: 'Open deliveries', render: (v) => v.open_deliveries ?? 0 },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge label={v.status} tone={v.status === 'ACTIVE' ? 'green' : 'neutral'} /> },
    {
      key: 'actions', label: '', render: (v) => v.can_edit ? (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(v)}><Pencil size={13} /> Edit</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggle(v)}>{v.status === 'ACTIVE' ? 'Make inactive' : 'Make active'}</button>
          <button type="button" className="mm-icon" aria-label={`Delete ${v.plate_number}`} onClick={() => remove(v)}><Trash2 size={14} /></button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="panel" style={{ padding: '12px' }} id="vehicles-panel">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input className="form-input" style={{ maxWidth: 280 }} placeholder="Search plate, vehicle or driver…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vehicles" />
        <span className="mm-sub" style={{ display: 'inline' }}>{shown.length} vehicle{shown.length === 1 ? '' : 's'}</span>
        <button type="button" className="btn btn-primary" id="new-vehicle" style={{ marginLeft: 'auto' }} onClick={openNew}><Plus size={16} /> New Vehicle</button>
      </div>
      <DataTable id="vehicles-table" data={shown} columns={columns} keyExtractor={(v) => v.id} pageSize={25}
        emptyMessage="No company vehicles yet. Click 'New Vehicle' to register one; you will then pick it when scheduling deliveries." />

      <Modal isOpen={open} onClose={() => !saving && setOpen(false)} title={editId ? 'Edit vehicle' : 'New company vehicle'} width="md"
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" id="save-vehicle" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>}>
        <div className="emp-form">
          <label className="form-field"><span className="form-field__label">Plate number *</span><input className="form-input" id="veh-plate" autoFocus {...set('plate_number')} placeholder="e.g. HG 1234" /></label>
          <label className="form-field"><span className="form-field__label">Type</span>
            <select className="form-select" id="veh-type" {...set('vehicle_type')}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="form-field"><span className="form-field__label">Make &amp; model</span><input className="form-input" id="veh-make" {...set('make')} placeholder="e.g. Isuzu NPR" /></label>
          <label className="form-field"><span className="form-field__label">Usual driver</span>
            <select className="form-select" id="veh-driver" value={!form.default_driver_id && form.driver_name ? TYPED_DRIVER : form.default_driver_id} onChange={(e) => pickDriver(e.target.value)}>
              <option value="">— none —</option>
              {!form.default_driver_id && form.driver_name && <option value={TYPED_DRIVER}>{form.driver_name}</option>}
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <span className="mm-sub">A suggestion only: each delivery can pick another driver.</span></label>
          {!myBranch && !editId && (
            <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Belongs to</span>
              <select className="form-select" id="veh-branch" {...set('branchId')}><option value="">Whole company (every branch can use it)</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          )}
        </div>
      </Modal>
    </div>
  );
}
