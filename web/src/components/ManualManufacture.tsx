import { refreshAfterSave } from '../utils/afterSave';
import { useEffect, useRef, useState } from 'react';
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
function ItemRows({ rows, setRows, showGroup, id }: { rows: Row[]; setRows: (r: Row[]) => void; showGroup?: boolean; id: string }) {
  const set = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const box = useRef<HTMLDivElement>(null);
  const focusLast = () => setTimeout(() => {
    const inputs = box.current?.querySelectorAll<HTMLInputElement>('input[aria-label="Item name"]');
    inputs?.[inputs.length - 1]?.focus();
  }, 0);
  const addRow = () => { setRows([...rows, newRow()]); focusLast(); };
  return (
    <div ref={box} id={id}>
      <table className="mm-items">
        <thead><tr><th>Item name</th><th style={{ width: 130 }}>Price</th>{showGroup && <th style={{ width: 120 }}>Group</th>}<th style={{ width: 36 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td><input className="form-input" value={r.name} placeholder={`Item ${i + 1}`} aria-label="Item name" onChange={(e) => set(r.key, { name: e.target.value })} /></td>
              <td><input className="form-input" type="number" min="0" step="0.01" inputMode="decimal" value={r.price} placeholder="0.00" aria-label="Price" onChange={(e) => set(r.key, { price: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === rows.length - 1) addRow(); } }} /></td>
              {showGroup && <td className="mm-items__group">{r.group_name || '—'}</td>}
              <td><button type="button" className="mm-icon" aria-label="Remove item" onClick={() => setRows(rows.length > 1 ? rows.filter((x) => x.key !== r.key) : [newRow()])}><X size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addRow}><Plus size={14} /> Add item</button>
      <span className="mm-sub" style={{ display: 'inline', marginLeft: 8 }}>Tip: press Enter in the last price to add the next item.</span>
    </div>
  );
}

export function ManualManufacturePanel({ enabled, command }: { enabled: boolean; command?: { action: 'new' | 'newGroup' | 'groups'; n: number } | null }) {
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
  const [groupName, setGroupName] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groupCache, setGroupCache] = useState<Record<string, Group>>({});

  // Saved groups manager
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupEdit, setGroupEdit] = useState<{ id: string | null; name: string; rows: Row[] } | null>(null);

  const total = rows.reduce((s, r) => s + (r.name.trim() ? Number(r.price) || 0 : 0), 0);
  const picked = Array.from(new Set(rows.map((r) => r.group_name).filter(Boolean))) as string[];
  const pickedInfo = picked.map((g) => {
    const its = rows.filter((r) => r.group_name === g);
    return { name: g, count: its.length, total: its.reduce((a, r) => a + (Number(r.price) || 0), 0) };
  });
  const manualCount = rows.filter((r) => !r.group_name && r.name.trim()).length;

  const loadGroups = async (q: string): Promise<SelectOption[]> => {
    const res = await apiGet<Group[]>('/manufacturing/item-groups', q ? { q } : undefined);
    setGroupCache((prev) => ({ ...prev, ...Object.fromEntries(res.map((g) => [g.id, g])) }));
    return res.map((g) => ({ value: g.id, label: g.name, sublabel: `${g.item_count} item${g.item_count === 1 ? '' : 's'} · ${money(g.total)}${picked.includes(g.name) ? ' · already added' : ''}` }));
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
    setEditing(null); setTitle(''); setNotes(''); setRows([newRow()]); setGroupName(''); setOpen(true);
  };
  const openEdit = async (job: Job) => {
    setEditing(job); setOpen(true); setLoadingJob(true); setGroupName('');
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
    setSaving(true);
    try {
      const body = { title: title.trim(), notes: notes.trim(), items };
      const saved = editing ? await apiPut<Job>(`/manufacturing/jobs/${editing.id}`, body) : await apiPost<Job>('/manufacturing/jobs', body);
      addToast('success', `${saved.job_number} saved: ${items.length} item${items.length === 1 ? '' : 's'}, ${money(items.reduce((a, i) => a + i.price, 0))}`);
      setOpen(false);
      setGroups(null);
      list.refresh();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  /** Saves the items now on screen as a reusable group, without leaving the manufacture. */
  const saveRowsAsGroup = async () => {
    const items = toPayload(rows).map(({ name, price }) => ({ name, price }));
    if (!groupName.trim()) { addToast('error', 'Type a name for the group'); return; }
    if (!items.length) { addToast('error', 'Add at least one item first'); return; }
    setSavingGroup(true);
    try {
      await apiPost('/manufacturing/item-groups', { name: groupName.trim(), items });
      addToast('success', `Group “${groupName.trim()}” saved with ${items.length} item${items.length === 1 ? '' : 's'}`);
      setGroupName('');
      setGroupCache({});
      setGroups(null);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not save the group');
    } finally {
      setSavingGroup(false);
    }
  };

  // Page-header buttons (New Manufacture / New Group / Saved Groups).
  useEffect(() => {
    if (!command) return;
    if (command.action === 'new') openNew();
    else if (command.action === 'groups') openGroups();
    else { setGroupsOpen(true); setGroups(null); setGroupEdit({ id: null, name: '', rows: [newRow()] }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.n]);

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
      refreshAfterSave(addToast, () => apiGet<Group[]>('/manufacturing/item-groups').then(setGroups));
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
      <ListToolbar id="mf-toolbar" list={list} searchPlaceholder="Search number, title, group or item…" dateRange />
      {list.total > 0 && <div className="list-summary"><span>Manufactures: <strong>{list.total.toLocaleString()}</strong></span><span>Total value: <strong>{money(list.totals?.value ?? 0)}</strong></span></div>}
      <DataTable id="mf-table" data={list.items} columns={columns} server={list} keyExtractor={(j) => j.id}
        onRowClick={canEdit ? (j) => j.status === 'OPEN' && openEdit(j) : undefined}
        emptyMessage={list.activeFilters ? 'No manufactures match your filters' : "Nothing yet. Click 'New Manufacture' to add items and their prices."} />


      <Modal isOpen={open} onClose={() => !saving && setOpen(false)} title={editing ? `Edit ${editing.job_number}` : 'New Manufacture'} width="lg"
        footer={!loadingJob && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
            <span style={{ marginRight: 'auto', fontSize: 15 }}>Total: <strong>{money(total)}</strong></span>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" id="save-manufacture" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}>
        {loadingJob ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: 16 }}>
            <section className="mm-step">
              <h4 className="mm-step__title">1. Add saved groups <span>(pick as many as you need, one after another)</span></h4>
              <SearchableSelect id="mm-group-picker" options={[]} value="" onChange={(v) => v && addGroup(v)} loadOptions={loadGroups} placeholder="Search saved groups, e.g. Fadhi, Somali Bed…" />
              {pickedInfo.length > 0 ? (
                <div className="mm-picked" aria-label="Groups in this manufacture">
                  {pickedInfo.map((g) => (
                    <span key={g.name} className="mm-chip">{g.name} · {g.count} item{g.count === 1 ? '' : 's'} · {money(g.total)}
                      <button type="button" aria-label={`Remove ${g.name}`} onClick={() => removeGroup(g.name)}><X size={12} /></button></span>
                  ))}
                </div>
              ) : <p className="mm-sub" style={{ margin: '6px 0 0' }}>No groups added. You can also just type items below.</p>}
            </section>

            <section className="mm-step">
              <h4 className="mm-step__title">2. Items <span>({rows.filter((r) => r.name.trim()).length} in total: {rows.filter((r) => r.group_name).length} from groups, {manualCount} typed)</span></h4>
              <ItemRows id="mm-items" rows={rows} setRows={setRows} showGroup />
              <div className="mm-savegroup">
                <span>Save these items as a new group to reuse later:</span>
                <input className="form-input" id="mm-group-name" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name, e.g. Fadhi" style={{ maxWidth: 220 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveRowsAsGroup(); } }} />
                <button type="button" className="btn btn-secondary btn-sm" id="mm-save-group" onClick={saveRowsAsGroup} disabled={savingGroup}>{savingGroup ? 'Saving…' : 'Save as group'}</button>
              </div>
            </section>

            <section className="mm-step mm-grid">
              <label className="form-field"><span className="form-field__label">Title (optional)</span>
                <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the group names" /></label>
              <label className="form-field"><span className="form-field__label">Notes (optional)</span>
                <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. for customer Ali" /></label>
            </section>
          </div>
        )}
      </Modal>

      <Modal isOpen={groupsOpen} onClose={() => { if (!saving) { setGroupsOpen(false); setGroupEdit(null); } }} title={groupEdit ? (groupEdit.id ? `Edit group “${groupEdit.name}”` : 'New group') : 'Saved groups'} width="md"
        footer={groupEdit ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setGroupEdit(null)} disabled={saving}>Back</button>
            <button type="button" className="btn btn-primary" id="save-group" onClick={saveGroup} disabled={saving}>{saving ? 'Saving…' : 'Save group'}</button>
          </div>
        ) : undefined}>
        {groupEdit ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label className="form-field"><span className="form-field__label">Group name</span>
              <input className="form-input" id="group-edit-name" autoFocus value={groupEdit.name} placeholder="e.g. Fadhi" onChange={(e) => setGroupEdit({ ...groupEdit, name: e.target.value })} /></label>
            <ItemRows id="group-edit-items" rows={groupEdit.rows} setRows={(r) => setGroupEdit({ ...groupEdit, rows: r })} />
          </div>
        ) : groups === null ? <ModalLoading /> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {groups.length === 0 && <p className="mm-sub">No groups yet. Click “New group”, type the items and their prices, and save.</p>}
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
