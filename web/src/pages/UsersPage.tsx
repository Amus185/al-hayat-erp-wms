import { useEffect, useState } from 'react';
import { Users, UserPlus, Shield, Landmark, Warehouse, Pencil, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { FormField, InputField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface UserRecord {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  branch_id: string | null;
  warehouse_id: string | null;
  is_active: boolean;
  created_at: string;
}

interface Role {
  id: string;
  name: string;
  description: string | null;
}

const EMPTY_FORM = {
  email: '',
  password: '',
  fullName: '',
  phone: '',
  branchId: '',
  warehouseId: '',
  roleIds: [] as string[],
};

export function UsersPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [usersList, setUsersList] = useState<UserRecord[]>([]);
  const [rolesList, setRolesList] = useState<Role[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // Edit modal
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    branchId: '',
    warehouseId: '',
    isActive: true,
    roleIds: [] as string[],
  });

  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [editRolesLoading, setEditRolesLoading] = useState(false);

  // Change-password modal
  const [pwUser, setPwUser] = useState<UserRecord | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const loadData = async () => {
    try {
      setLoading(true);
      const [u, r, w, b] = await Promise.all([
        apiGet<UserRecord[]>('/users'),
        apiGet<Role[]>('/users/roles'),
        apiGet<any[]>('/warehouses'),
        apiGet<any[]>('/branches'),
      ]);
      setUsersList(u || []);
      setRolesList(r || []);
      setWarehouses(w || []);
      setBranches(b || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch user list');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // ── Helpers ──────────────────────────────────────────────
  const handleRoleToggle = (roleId: string, ids: string[], setter: (fn: (p: any) => any) => void, key: string) => {
    setter((prev: any) => ({
      ...prev,
      [key]: ids.includes(roleId) ? ids.filter(id => id !== roleId) : [...ids, roleId],
    }));
  };

  const getBranchName = (id: string | null) => branches.find(b => b.id === id)?.name || '';
  const getWarehouseName = (id: string | null) => warehouses.find(w => w.id === id)?.name || '';

  const [submitting, setSubmitting] = useState(false);

  // ── Create ───────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!form.email || !form.password || !form.fullName) {
      addToast('error', 'Please fill out all required fields'); return;
    }
    if (form.roleIds.length === 0) {
      addToast('error', 'Select at least one security role'); return;
    }
    try {
      setSubmitting(true);
      await apiPost('/users', {
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone || undefined,
        branchId: form.branchId || undefined,
        warehouseId: form.warehouseId || undefined,
        roleIds: form.roleIds,
      });
      addToast('success', 'User account created successfully');
      setIsCreateOpen(false);
      setForm({ ...EMPTY_FORM });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register new user');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Open Edit ────────────────────────────────────────────
  const openEdit = async (user: UserRecord) => {
    setEditUser(user);
    setEditForm({
      fullName: user.full_name,
      email: user.email,
      phone: user.phone || '',
      branchId: user.branch_id || '',
      warehouseId: user.warehouse_id || '',
      isActive: user.is_active,
      roleIds: [],
    });
    // Fetch existing roles for this user
    setEditRolesLoading(true);
    try {
      const roles = await apiGet<Role[]>(`/users/${user.id}/roles`);
      setEditForm(prev => ({ ...prev, roleIds: (roles || []).map(r => r.id) }));
    } catch {}
    setEditRolesLoading(false);
  };

  // ── Save Edit ────────────────────────────────────────────
  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser || submitting) return;
    try {
      setSubmitting(true);
      // Use fetch directly with PATCH since apiPatch is available in client
      const token = localStorage.getItem('access_token');
      const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
      const res = await fetch(`${base}/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullName: editForm.fullName,
          email: editForm.email,
          phone: editForm.phone || null,
          branchId: editForm.branchId || null,
          warehouseId: editForm.warehouseId || null,
          isActive: editForm.isActive,
          roleIds: editForm.roleIds,
        }),
      });
      if (!res.ok) throw new Error('Failed to update user');
      addToast('success', 'User updated successfully');
      setEditUser(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update user');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Delete ───────────────────────────────────────────────
  const handleDelete = async (user: UserRecord) => {
    setConfirmState({
      isOpen: true,
      title: 'Delete User',
      message: `Delete user "${user.full_name}"? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await apiDelete(`/users/${user.id}`);
          addToast('success', 'User deleted');
          loadData();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete user');
        }
      }
    });
  };

  // ── Change Password ──────────────────────────────────────
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwUser || submitting) return;
    if (newPassword.length < 6) { addToast('error', 'Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { addToast('error', 'Passwords do not match'); return; }
    try {
      setSubmitting(true);
      await apiPost(`/users/${pwUser.id}/change-password`, { newPassword });
      addToast('success', 'Password changed successfully');
      setPwUser(null);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Columns ──────────────────────────────────────────────
  const columns: Column<UserRecord>[] = [
    { key: 'full_name', label: 'Full Name', sortable: true },
    { key: 'email', label: 'Email Address', sortable: true },
    {
      key: 'assignment',
      label: 'Site Assignment',
      render: (row) => {
        if (row.warehouse_id) return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <Warehouse size={13} style={{ color: '#0b8f08' }} />
            <span>{getWarehouseName(row.warehouse_id)}</span>
          </div>
        );
        if (row.branch_id) return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
            <Landmark size={13} style={{ color: '#b45309' }} />
            <span>{getBranchName(row.branch_id)}</span>
          </div>
        );
        return <span style={{ color: '#667066', fontSize: '12px' }}>Corporate HQ</span>;
      },
    },
    {
      key: 'is_active',
      label: 'Status',
      render: (row) => <StatusBadge label={row.is_active ? 'Active' : 'Inactive'} tone={row.is_active ? 'green' : 'neutral'} />,
    },
    {
      key: 'created_at',
      label: 'Registered',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openEdit(row); }}
            title="Edit user">
            <Pencil size={13} />
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); setPwUser(row); }}
            title="Change password">
            <KeyRound size={13} />
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(row); }}
            title="Delete user">
            <Trash2 size={13} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <PageSkeleton />;

  // ── Role checklist helper ────────────────────────────────
  const RoleChecklist = ({ ids, onToggle }: { ids: string[]; onToggle: (id: string) => void }) => (
    <div style={{ display: 'grid', gap: '8px' }}>
      {rolesList.map((role) => (
        <label key={role.id} style={{
          display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 10px',
          border: `1px solid ${ids.includes(role.id) ? '#0b8f08' : '#d9e2d9'}`,
          borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
          background: ids.includes(role.id) ? '#f0f9f0' : 'transparent',
        }}>
          <input type="checkbox" checked={ids.includes(role.id)} onChange={() => onToggle(role.id)} style={{ marginTop: '2px' }} />
          <div>
            <strong>{role.name.replace(/_/g, ' ')}</strong>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#667066' }}>{role.description || 'System security permissions role'}</p>
          </div>
        </label>
      ))}
    </div>
  );

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon"><Users size={24} /></div>
        <div className="module-header__info">
          <p>IAM Governance</p>
          <h2>Manage employee identities, credentials, roles, and assignments</h2>
        </div>
        {hasPermission('manage_users') && (
          <button type="button" className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Add Staff Account
          </button>
        )}
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={usersList}
          keyExtractor={(row) => row.id}
          emptyMessage="No staff users registered"
        />
      </section>

      {/* ── Create Modal ── */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Register Staff User" width="md">
        <form onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField label="Full Name *" id="fullName" value={form.fullName}
              onChange={(v) => setForm(p => ({ ...p, fullName: v }))} required />
            <InputField label="Phone Number" id="phone" value={form.phone}
              onChange={(v) => setForm(p => ({ ...p, phone: v }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <InputField label="Email Address *" id="email" type="email" value={form.email}
              onChange={(v) => setForm(p => ({ ...p, email: v }))} required />
            <InputField label="Temporary Password *" id="password" type="password" value={form.password}
              onChange={(v) => setForm(p => ({ ...p, password: v }))} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <FormField label="Assign to Warehouse">
              <SearchableSelect
                options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                value={form.warehouseId}
                onChange={(val) => setForm(p => ({ ...p, warehouseId: val, branchId: '' }))}
                placeholder="None (HQ/Corporate)"
              />
            </FormField>
            <FormField label="Assign to Branch">
              <SearchableSelect
                options={branches.map(b => ({ value: b.id, label: b.name }))}
                value={form.branchId}
                onChange={(val) => setForm(p => ({ ...p, branchId: val, warehouseId: '' }))}
                placeholder="None (HQ/Corporate)"
              />
            </FormField>
          </div>
          <div style={{ marginTop: '20px', borderTop: '1px solid #edf1ed', paddingTop: '14px' }}>
            <h4 style={{ margin: '0 0 10px', color: '#066006', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Shield size={16} /> Assign Security Roles *
            </h4>
            <RoleChecklist ids={form.roleIds} onToggle={(id) => handleRoleToggle(id, form.roleIds, setForm, 'roleIds')} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Registering…</>
              ) : (
                'Register User'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal isOpen={!!editUser} onClose={() => setEditUser(null)} title={`Edit User: ${editUser?.full_name}`} width="md">
        <form onSubmit={handleEdit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField label="Full Name" id="editFullName" value={editForm.fullName}
              onChange={(v) => setEditForm(p => ({ ...p, fullName: v }))} required />
            <InputField label="Phone Number" id="editPhone" value={editForm.phone}
              onChange={(v) => setEditForm(p => ({ ...p, phone: v }))} />
          </div>
          <div style={{ marginTop: '10px' }}>
            <InputField label="Email Address" id="editEmail" type="email" value={editForm.email}
              onChange={(v) => setEditForm(p => ({ ...p, email: v }))} required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <FormField label="Assign to Warehouse">
              <SearchableSelect
                options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                value={editForm.warehouseId}
                onChange={(val) => setEditForm(p => ({ ...p, warehouseId: val, branchId: '' }))}
                placeholder="None (HQ/Corporate)"
              />
            </FormField>
            <FormField label="Assign to Branch">
              <SearchableSelect
                options={branches.map(b => ({ value: b.id, label: b.name }))}
                value={editForm.branchId}
                onChange={(val) => setEditForm(p => ({ ...p, branchId: val, warehouseId: '' }))}
                placeholder="None (HQ/Corporate)"
              />
            </FormField>
          </div>
          <div style={{ marginTop: '10px' }}>
            <FormField label="Account Status">
              <select className="form-select" value={editForm.isActive ? '1' : '0'}
                onChange={(e) => setEditForm(p => ({ ...p, isActive: e.target.value === '1' }))}>
                <option value="1">Active</option>
                <option value="0">Inactive (Suspended)</option>
              </select>
            </FormField>
          </div>
          <div style={{ marginTop: '20px', borderTop: '1px solid #edf1ed', paddingTop: '14px' }}>
            <h4 style={{ margin: '0 0 10px', color: '#066006', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Shield size={16} /> Security Roles
            </h4>
            {editRolesLoading
              ? <p style={{ fontSize: '13px', color: '#667066' }}>Loading roles...</p>
              : <RoleChecklist ids={editForm.roleIds} onToggle={(id) => handleRoleToggle(id, editForm.roleIds, setEditForm, 'roleIds')} />}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditUser(null)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Saving…</>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── Change Password Modal ── */}
      <Modal isOpen={!!pwUser} onClose={() => setPwUser(null)} title={`Change Password: ${pwUser?.full_name}`} width="sm">
        <form onSubmit={handleChangePassword}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField label="New Password" id="newPw" type="password" value={newPassword}
              onChange={setNewPassword} required />
            <InputField label="Confirm Password" id="confirmPw" type="password" value={confirmPassword}
              onChange={setConfirmPassword} required />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setPwUser(null)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Updating…</>
              ) : (
                <><KeyRound size={14} style={{ marginRight: '6px', inlineSize: 'auto' }} />Update Password</>
              )}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        isDestructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
