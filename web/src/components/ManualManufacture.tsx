import { useState } from 'react';
import { Layers, Pencil, Plus, Trash2, X, CheckCheck } from 'lucide-react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { Modal } from './Modal';
import { ModalLoading } from './ModalLoading';
import { DataTable, type Column } from './DataTable';
import { ListToolbar } from './ListToolbar';
import { StatusTabs } from './StatusTabs';
import { StatusBadge } from './StatusBadge';
import { SearchableSelect, type SelectOption } from './SearchableSelect';
import { useServerList } from '../utils/serverList';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';

interface Row { key: string; name: string; price: string; group_name?: string | null }
interface Group { id: string; name: string; item_count: number; total: number; items: { name: string; price: number }[] }
interface Job { id: string; job_number: string; title: string; notes: string | null; total: number; status: 'OPEN' | 'DONE' | 'CANCELLED'; item_count: number; groups: string | null; created_at: string; created_by_name?: string }

const money = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let seq = 0;
const newRow = (name = '', price: string | number = '', group_name: string | null = null): Row => ({ key: `r${++seq}`, name, price: price === '' ? '' : String(price), group_name });
const toPayload = (rows: Row[]) => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), price: Number(r.price) || 0, group_name: r.group_name || null }));
const tone = (s: Job['status']) => (s === 'DONE' ? 'green' : s === 'CANCELLED' ? 'red' : 'yellow');

/** Item rows: name + price, add as many as needed. */
function ItemRows({ rows, setRows, showGroup }: { rows: Row[]; setRows: (r: Row[]) => void; showGroup?: boolean }) {
  const set = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div>
      <table className="mm-items">
        <thead><tr><th>Item name</th><th style={{ width: 130 }}>Price</th>{showGroup && <th style={{ width: 120 }}>Group</th>}<th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td><input className="form-input" value={r.name} placeholder={`Item ${i + 1}`} aria-label="Item name" onChange={(e) => set(r.key, { name: e.target.value })} /></td>
              <td><input className="form-input" type="number" min="0" step="0.01" inputMode="decimal" value={r.price} placeholder="0.00" aria-label="Price" onChange={(e) => set(r.key, { price: e.target.value })} /></td>
              {showGroup && <td className="mm-items__group">{r.group_name || '—'}</td>}
              <td><button type="button" className="mm-icon" aria-label="Remove item" onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [newRow()])}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setRows([...rows, newRow()])}><Plus size={14} /> Add item</button>
    </div>
  );
}

export function ManualManufacturePanel({ enabled }: { enabled: boolean }) {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('manage_inventory');
  const list = useServerList<Job>('/manufacturing/jobs', { key: 'mfg-jobs', prefix: 'mf', filters: ['status', 'dateFrom', 'dateTo'], defaultSort: 'date', defaultDir: 'desc', enabled });

  // New / edit manufacture
  const [open, setOpen] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [saveAsGroup, setSaveAsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [saving, setSaving] = useState(false);
  const [groupCache, setGroupCache] = useState<Record<string, Group>>({});

  // Saved groups manager
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupEdit, setGroupEdit] = useState<{ id: string | null; name: string; rows: Row[] } | null>(null);

  const total = rows.reduce((s, r) => s + (r.name.trim() ? Number(r.price) || 0 : 0), 0);
  const picked = Array.from(new Set(rows.map((r) => r.group_name).filter(Boolean))) as string[];

  const loadGroups = async (q: string): Promise<SelectOption[]> => {
    const res = await apiGet<Group[]>('/manufacturing/item-groups', q ? { q } : undefined);
    setGroupCache((prev) => ({ ...prev, ...Object.fromEntries(res.map((g) => [g.id, g])) }));
    return res.map((g) => ({ value: g.id, label: g.name, sublabel: `${g.item_count} item${g.item_count === 1 ? '' : 's'} · ${money(g.total)}` }));
  };

  const addGroup = (id: string) => {
    const g = groupCache[id];
    if (!g) return;
    const kept = rows.filter((r) => r.name.trim() || r.price);
    setRows([...kept, ...g.items.map((it) => newRow(it.name, it.price, g.name))]);
  };
  const removeGroup = (name: string) => {
    const left = rows.filter((r) => r.group_name !== name);
    setRows(left.length ? left : [newRow()]);
  };

  const openNew = () => {
    setEditing(null); setTitle(''); setNotes(''); setRows([newRow()]); setSaveAsGroup(false); setGroupName(''); setOpen(true);
  };
  const openEdit = async (job: Job) => {
    setEditing(job); setOpen(true); setLoadingJob(true); setSaveAsGroup(false); setGroupName('');
    try {
      const full = await apiGet<Job & { items: { name: string; price: number; group_name: string | null }[] }>(`/manufacturing/jobs/${job.id}`);
      setTitle(full.title); setNotes(full.notes ?? '');
      setRows(full.items.length ? full.items.map((i) => newRow(i.name, i.price, i.group_name)) : [newRow()]);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not open this manufacture'); setOpen(false);
    } finally {
      setLoadingJob(false);
    }
  };

  const save = async () => {
    const items = toPayload(rows);
    if (!items.length) { addToast('error', 'Add at least one item with a name'); return; }
    if (saveAsGroup && !groupName.trim()) { addToast('error', 'Type a name for the new group'); return; }
    setSaving(true);
    try {
      if (saveAsGroup) {
        await apiPost('/manufacturing/item-groups', { name: groupName.trim(), items: items.map(({ name, price }) => ({ name, price })) });
      }
      const body = { title: title.trim(), notes: notes.trim(), items };
      const saved = editing ? await apiPut<Job>(`/manufacturing/jobs/${editing.id}`, body) : await apiPost<Job>('/manufacturing/jobs', body);
      addToast('success', `${saved.job_number} saved${saveAsGroup ? ` and group “${groupName.trim()}” created` : ''}`);
      setOpen(false);
      setGroups(null);
      list.refresh();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (job: Job, status: Job['status']) => {
    if (status === 'CANCELLED' && !(await confirmAction('Cancel this manufacture?', `${job.job_number} will be marked cancelled.`))) return;
    try { await apiPost(`/manufacturing/jobs/${job.id}/status`, { status }); list.refresh(); } catch (err: any) { addToast('error', err?.message || 'Could not update'); }
  };
  const removeJob = async (job: Job) => {
    if (!(await confirmAction('Delete this manufacture?', `${job.job_number} and its items will be removed.`))) return;
    try { await apiDelete(`/manufacturing/jobs/${job.id}`); addToast('success', `${job.job_number} deleted`); list.refresh(); } catch (err: any) { addToast('error', err?.message || 'Could not delete'); }
  };

  const openGroups = async () => {
    setGroupsOpen(true);
    setGroups(null);
    try { setGroups(await apiGet<Group[]>('/manufacturing/item-groups')); } catch { setGroups([]); }
  };
  const saveGroup = async () => {
    if (!groupEdit) return;
    const items = toPayload(groupEdit.rows).map(({ name, price }) => ({ name, price }));
    if (!groupEdit.name.trim() || !items.length) { addToast('error', 'A group needs a name and at least one item'); return; }
    setSaving(true);
    try {
      const body = { name: groupEdit.name.trim(), items };
      if (groupEdit.id) await apiPut(`/manufacturing/item-groups/${groupEdit.id}`, body); else await apiPost('/manufacturing/item-groups', body);
      addToast('success', `Group “${body.name}” saved`);
      setGroupEdit(null);
      setGroupCache({});
      setGroups(await apiGet<Group[]>('/manufacturing/item-groups'));
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save the group');
    } finally {
      setSaving(false);
    }
  };
  const deleteGroup = async (g: Group) => {
    if (!(await confirmAction(`Delete group “${g.name}”?`, 'Manufactures that used it keep their items.'))) return;
    try {
      await apiDelete(`/manufacturing/item-groups/${g.id}`);
      setGroups((prev) => (prev ?? []).filter((x) => x.id !== g.id));
      setGroupCache({});
    } catch (err: any) { addToast('error', err?.message || 'Could not delete'); }
  };

  const columns: Column<Job>[] = [
    { key: 'job_number', label: 'Number', sortable: true, sortKey: 'number', render: (j) => <strong>{j.job_number}</strong> },
    { key: 'created_at', label: 'Date', sortable: true, sortKey: 'date', render: (j) => new Date(j.created_at).toLocaleDateString() },
    { key: 'title', label: 'Title', sortable: true, render: (j) => <span>{j.title}{j.groups && <span className="mm-sub">{j.groups}</span>}</span> },
    { key: 'item_count', label: 'Items', sortable: true, sortKey: 'items' },
    { key: 'total', label: 'Total', sortable: true, render: (j) => <strong>{money(j.total)}</strong> },
    { key: 'status', label: 'Status', sortable: true, render: (j) => <StatusBadge label={j.status} tone={tone(j.status)} /> },
    {
      key: 'actions', label: '', render: (j) => canEdit && (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {j.status === 'OPEN' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(j)}><Pencil size={13} /> Edit</button>}
          {j.status === 'OPEN' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(j, 'DONE')}><CheckCheck size={13} /> Done</button>}
          {j.status !== 'OPEN' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(j, 'OPEN')}>Reopen</button>}
          <button type="button" className="mm-icon" aria-label={`Delete ${j.job_number}`} onClick={() => removeJob(j)}><Trash2 size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '12px' }}>
      <StatusTabs id="mf-status-tabs" value={list.filters.status} counts={list.counts} onChange={(v) => list.setFilter('status', v)}
        tabs={[{ key: 'ALL', label: 'All' }, { key: 'OPEN', label: 'Open' }, { key: 'DONE', label: 'Done' }, { key: 'CANCELLED', label: 'Cancelled' }]} />
      <ListToolbar id="mf-toolbar" list={list} searchPlaceholder="Search number, title, group or item…" dateRange>
        <button type="button" className="btn btn-secondary btn-sm" onClick={openGroups}><Layers size={14} /> Saved groups</button>
        {canEdit && <button type="button" className="btn btn-primary btn-sm" id="new-manufacture" onClick={openNew}><Plus size={14} /> New Manufacture</button>}
      </ListToolbar>
      <DataTable id="mf-table" data={list.items} columns={columns} server={list} keyExtractor={(j) => j.id}
        onRowClick={canEdit ? (j) => j.status === 'OPEN' && openEdit(j) : undefined}
        emptyMessage={list.activeFilters ? 'No manufactures match your filters' : "Nothing yet. Click 'New Manufacture' to add items and their prices."} />
      {list.totals && <p className="mm-sub" style={{ textAlign: 'right', marginTop: 6 }}>Total of matching: <strong>{money(list.totals.value)}</strong></p>}

      <Modal isOpen={open} onClose={() => !saving && setOpen(false)} title={editing ? `Edit ${editing.job_number}` : 'New Manufacture'} width="lg"
        footer={!loadingJob && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <span style={{ marginRight: 'auto', fontSize: 15 }}>Total: <strong>{money(total)}</strong></span>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" id="save-manufacture" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}>
        {loadingJob ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="mm-grid">
              <label className="form-field"><span className="form-field__label">Title (optional)</span>
                <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Order for Ali — defaults to the group names" /></label>
              <div className="form-field"><span className="form-field__label">Add a saved group</span>
                <SearchableSelect id="mm-group-picker" options={[]} value="" onChange={(v) => v && addGroup(v)} loadOptions={loadGroups} placeholder="Search groups (Fadhi, Somali Bed…)" /></div>
            </div>
            {picked.length > 0 && (
              <div className="mm-chips" aria-label="Groups added">
                {picked.map((g) => (
                  <span key={g} className="mm-chip">{g} <button type="button" aria-label={`Remove ${g}`} onClick={() => removeGroup(g)}><X size={12} /></button></span>
                ))}
              </div>
            )}
            <ItemRows rows={rows} setRows={setRows} showGroup={picked.length > 0} />
            <label className="form-field"><span className="form-field__label">Notes (optional)</span>
              <textarea className="form-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
            <div className="mm-savegroup">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={saveAsGroup} onChange={(e) => setSaveAsGroup(e.target.checked)} /> Also save these items as a group to reuse
              </label>
              {saveAsGroup && <input className="form-input" autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name, e.g. Fadhi" style={{ maxWidth: 260 }} />}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={groupsOpen} onClose={() => { if (!saving) { setGroupsOpen(false); setGroupEdit(null); } }} title={groupEdit ? (groupEdit.id ? `Edit group “${groupEdit.name}”` : 'New group') : 'Saved groups'} width="md"
        footer={groupEdit ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setGroupEdit(null)} disabled={saving}>Back</button>
            <button type="button" className="btn btn-primary" onClick={saveGroup} disabled={saving}>{saving ? 'Saving…' : 'Save group'}</button>
          </div>
        ) : undefined}>
        {groupEdit ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="form-field"><span className="form-field__label">Group name</span>
              <input className="form-input" value={groupEdit.name} onChange={(e) => setGroupEdit({ ...groupEdit, name: e.target.value })} /></label>
            <ItemRows rows={groupEdit.rows} setRows={(r) => setGroupEdit({ ...groupEdit, rows: r })} />
          </div>
        ) : groups === null ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {groups.length === 0 && <p className="mm-sub">No groups yet. Tick “save these items as a group” in New Manufacture, or add one here.</p>}
            {groups.map((g) => (
              <div key={g.id} className="mm-group-row">
                <div><strong>{g.name}</strong><span className="mm-sub">{g.items.map((i) => i.name).join(', ')}</span></div>
                <span>{money(g.total)}</span>
                {canEdit && <>
                  <button type="button" className="mm-icon" aria-label={`Edit ${g.name}`} onClick={() => setGroupEdit({ id: g.id, name: g.name, rows: g.items.map((i) => newRow(i.name, i.price)) })}><Pencil size={14} /></button>
                  <button type="button" className="mm-icon" aria-label={`Delete ${g.name}`} onClick={() => deleteGroup(g)}><Trash2 size={14} /></button>
                </>}
              </div>
            ))}
            {canEdit && <button type="button" className="btn btn-secondary btn-sm" style={{ justifySelf: 'start', marginTop: 6 }} onClick={() => setGroupEdit({ id: null, name: '', rows: [newRow()] })}><Plus size={14} /> New group</button>}
          </div>
        )}
      </Modal>
    </div>
  );
}
