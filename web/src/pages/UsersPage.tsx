import { useEffect, useState } from 'react';
import { Users, UserPlus, Shield, Landmark, Warehouse, ShieldAlert } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField, InputField } from '../components/FormField';
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

export function UsersPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [usersList, setUsersList] = useState<UserRecord[]>([]);
  const [rolesList, setRolesList] = useState<Role[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Modal
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    branchId: '',
    warehouseId: '',
    roleIds: [] as string[],
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const u = await apiGet<UserRecord[]>('/users');
      const r = await apiGet<Role[]>('/users/roles');
      const w = await apiGet<any[]>('/warehouses');
      const b = await apiGet<any[]>('/branches');
      
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

  useEffect(() => {
    loadData();
  }, []);

  const handleRoleToggle = (roleId: string) => {
    setForm((prev) => {
      const exists = prev.roleIds.includes(roleId);
      if (exists) {
        return { ...prev, roleIds: prev.roleIds.filter((id) => id !== roleId) };
      } else {
        return { ...prev, roleIds: [...prev.roleIds, roleId] };
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password || !form.fullName) {
      addToast('error', 'Please fill out all required fields');
      return;
    }
    if (form.roleIds.length === 0) {
      addToast('error', 'Select at least one security role');
      return;
    }

    const payload = {
      email: form.email,
      password: form.password,
      fullName: form.fullName,
      phone: form.phone || undefined,
      branchId: form.branchId || undefined,
      warehouseId: form.warehouseId || undefined,
      roleIds: form.roleIds,
    };

    try {
      await apiPost('/users', payload);
      addToast('success', 'User account created successfully');
      setIsOpen(false);
      setForm({
        email: '',
        password: '',
        fullName: '',
        phone: '',
        branchId: '',
        warehouseId: '',
        roleIds: [],
      });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register new user');
    }
  };

  const getBranchName = (id: string | null) => {
    if (!id) return '';
    const b = branches.find((item) => item.id === id);
    return b ? b.name : '';
  };

  const getWarehouseName = (id: string | null) => {
    if (!id) return '';
    const w = warehouses.find((item) => item.id === id);
    return w ? w.name : '';
  };

  const columns: Column<UserRecord>[] = [
    { key: 'full_name', label: 'Full Name', sortable: true },
    { key: 'email', label: 'Email Address', sortable: true },
    {
      key: 'assignment',
      label: 'Site Assignment',
      render: (row) => {
        if (row.warehouse_id) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
              <Warehouse size={13} style={{ color: '#0b8f08' }} />
              <span>{getWarehouseName(row.warehouse_id)}</span>
            </div>
          );
        } else if (row.branch_id) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px' }}>
              <Landmark size={13} style={{ color: '#b45309' }} />
              <span>{getBranchName(row.branch_id)}</span>
            </div>
          );
        }
        return <span style={{ color: '#667066', fontSize: '12px' }}>Corporate HQ</span>;
      },
    },
    {
      key: 'is_active',
      label: 'Status',
      render: (row) => (
        <StatusBadge label={row.is_active ? 'Active' : 'Inactive'} tone={row.is_active ? 'green' : 'neutral'} />
      ),
    },
    {
      key: 'created_at',
      label: 'Registered',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Users size={24} />
        </div>
        <div>
          <p>IAM Governance</p>
          <h2>Manage employee identities, credentials, roles, and assignments</h2>
        </div>
        {hasPermission('users.manage') && (
          <button type="button" className="btn btn-primary" onClick={() => setIsOpen(true)}>
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

      {/* Add User Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Register Staff User" width="md">
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField
              label="Full Name *"
              id="fullName"
              placeholder="e.g. Abdullah Al Harbi"
              value={form.fullName}
              onChange={(val) => setForm((prev) => ({ ...prev, fullName: val }))}
              required
            />
            <InputField
              label="Phone Number"
              id="phone"
              placeholder="e.g. +96650..."
              value={form.phone}
              onChange={(val) => setForm((prev) => ({ ...prev, phone: val }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <InputField
              label="Email Address *"
              id="email"
              type="email"
              placeholder="user@alhayat.sa"
              value={form.email}
              onChange={(val) => setForm((prev) => ({ ...prev, email: val }))}
              required
            />
            <InputField
              label="Temporary Password *"
              id="password"
              type="password"
              placeholder="Min 8 characters"
              value={form.password}
              onChange={(val) => setForm((prev) => ({ ...prev, password: val }))}
              required
            />
          </div>

          {/* Assignments */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <FormField label="Assign to Warehouse">
              <select
                className="form-select"
                value={form.warehouseId}
                onChange={(e) => setForm((prev) => ({ ...prev, warehouseId: e.target.value, branchId: '' }))}
              >
                <option value="">None (HQ/Corporate)</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Assign to Branch">
              <select
                className="form-select"
                value={form.branchId}
                onChange={(e) => setForm((prev) => ({ ...prev, branchId: e.target.value, warehouseId: '' }))}
              >
                <option value="">None (HQ/Corporate)</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          {/* Roles Checklist */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #edf1ed', paddingTop: '14px' }}>
            <h4 style={{ margin: '0 0 10px', color: '#066006', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Shield size={16} /> Assign Security Roles *
            </h4>
            <div style={{ display: 'grid', gap: '8px' }}>
              {rolesList.map((role) => (
                <label
                  key={role.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '8px 10px',
                    border: '1px solid #d9e2d9',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    background: form.roleIds.includes(role.id) ? '#f0f9f0' : 'transparent',
                    borderColor: form.roleIds.includes(role.id) ? '#0b8f08' : '#d9e2d9',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={form.roleIds.includes(role.id)}
                    onChange={() => handleRoleToggle(role.id)}
                    style={{ marginTop: '2px' }}
                  />
                  <div>
                    <strong>{role.name.replace('_', ' ')}</strong>
                    <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#667066' }}>
                      {role.description || 'System security permissions role'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Register User
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
