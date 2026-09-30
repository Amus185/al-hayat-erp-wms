import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  MapPin,
  Trash2,
  Edit2,
  Loader2,
  Plus,
  Search,
  Package,
  Phone,
  ArrowRight,
  CheckCircle2,
  SlidersHorizontal,
  RefreshCw,
  ShoppingBag,
  DollarSign,
  Copy,
  CheckCheck,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { FormField } from '../components/FormField';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';

interface BranchItem {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean | number;
  total_units?: number;
  order_count?: number;
  total_revenue?: number;
}

interface BranchUser {
  id: string;
  username: string;
  rawPassword: string;
}

interface CredentialInfo {
  branchName: string;
  branchUser: BranchUser;
}

export function BranchesPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Creation Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({ code: '', name: '', city: '', address: '', phone: '' });

  // Edit Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchItem | null>(null);

  // Delete Confirm Modal
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // One-time credential modal state
  const [credModal, setCredModal] = useState<CredentialInfo | null>(null);
  const [copied, setCopied] = useState<'username' | 'password' | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadBranches = async () => {
    try {
      setLoading(true);
      const data = await apiGet<BranchItem[]>('/branches');
      setBranches(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch branch network');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    try {
      setSubmitting(true);
      const result = await apiPost<{ branch: BranchItem; branchUser: BranchUser }>('/branches', newBranch);
      addToast('success', `Branch "${result.branch.name}" created successfully`);
      setIsModalOpen(false);
      setNewBranch({ code: '', name: '', city: '', address: '', phone: '' });
      // Display initial one-time credentials
      setCredModal({
        branchName: result.branch.name,
        branchUser: result.branchUser,
      });
      loadBranches();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch || submitting) return;
    try {
      setSubmitting(true);
      await apiPatch(`/branches/${editingBranch.id}`, {
        code: editingBranch.code,
        name: editingBranch.name,
        city: editingBranch.city,
        address: editingBranch.address,
        phone: editingBranch.phone,
        is_active: editingBranch.is_active ? 1 : 0,
      });
      addToast('success', `Branch "${editingBranch.name}" updated successfully`);
      setIsEditModalOpen(false);
      setEditingBranch(null);
      loadBranches();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      isOpen: true,
      title: 'Delete Branch',
      message: `Are you sure you want to delete branch "${name}"? If there are existing sales transactions or inventory stock, the deletion will be safely rejected.`,
      onConfirm: async () => {
        try {
          await apiDelete(`/branches/${id}`);
          addToast('success', `Branch "${name}" deleted successfully`);
          loadBranches();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete branch');
        }
      },
    });
  };

  const handleCopy = (text: string, field: 'username' | 'password') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleRegenerateCredentials = async (branchId: string, branchName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirmAction(
      'Regenerate Credentials?',
      `Are you sure you want to regenerate credentials for "${branchName}"? This will immediately terminate all active sessions for this branch.`,
      'Yes, Regenerate',
      'warning'
    );
    if (!confirmed) return;
    setRegenerating(branchId);

    try {
      const result = await apiPost<{ branchUser: BranchUser }>(`/branches/${branchId}/regenerate-credentials`, {});
      setCredModal({ branchName, branchUser: result.branchUser });
      addToast('success', 'Credentials regenerated — existing sessions invalidated.');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to regenerate credentials');
    } finally {
      setRegenerating(null);
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  // Distinct cities for filter dropdown
  const distinctCities = Array.from(new Set(branches.map((b) => b.city).filter(Boolean)));

  // Filtered branches
  const filteredBranches = branches.filter((b) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      b.name.toLowerCase().includes(q) ||
      (b.city && b.city.toLowerCase().includes(q)) ||
      (b.code && b.code.toLowerCase().includes(q)) ||
      (b.address && b.address.toLowerCase().includes(q));

    const matchesCity = selectedCity === 'ALL' || b.city === selectedCity;
    const isActive = b.is_active !== false && b.is_active !== 0;
    const matchesStatus =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'ACTIVE' && isActive) ||
      (selectedStatus === 'INACTIVE' && !isActive);

    return matchesSearch && matchesCity && matchesStatus;
  });

  const totalBranches = branches.length;
  const activeBranches = branches.filter((b) => b.is_active !== false && b.is_active !== 0).length;
  const citiesCount = distinctCities.length;
  const totalUnitsInNetwork = branches.reduce((acc, b) => acc + (Number(b.total_units) || 0), 0);
  const totalOrdersInNetwork = branches.reduce((acc, b) => acc + (Number(b.order_count) || 0), 0);
  const totalRevenueInNetwork = branches.reduce((acc, b) => acc + (Number(b.total_revenue) || 0), 0);

  return (
    <div className="module-page">
      {/* Module Header */}
      <section className="module-header">
        <div className="module-header__icon" style={{ background: '#e9f6e8', color: '#066006' }}>
          <Building2 size={24} />
        </div>
        <div className="module-header__info">
          <p>Organization & Sales Channels</p>
          <h2>Branches & Retail Network</h2>
        </div>
        <div className="module-header__actions">
          {hasPermission('manage_users') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={16} /> New Branch
            </button>
          )}
        </div>
      </section>

      {/* KPI Stats Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total Network Outlets"
          value={String(totalBranches)}
          trend="Showroom & retail network"
          icon={<Building2 size={20} />}
        />
        <MetricCard
          label="Active Outlets"
          value={`${activeBranches} Active`}
          trend="Operational POS channels"
          icon={<CheckCircle2 size={20} />}
        />
        <MetricCard
          label="Cities Covered"
          value={`${citiesCount} Cities`}
          trend="Regional footprint"
          icon={<MapPin size={20} />}
        />
        <MetricCard
          label="Retail Stock On-Hand"
          value={totalUnitsInNetwork.toLocaleString()}
          trend={`$${totalRevenueInNetwork.toLocaleString()} total revenue`}
          icon={<Package size={20} />}
        />
      </section>

      {/* Filter / Search Bar Panel */}
      <section className="panel" style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Search Box */}
          <div style={{ position: 'relative', flex: '1 1 280px', minWidth: '240px' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#9ca3af',
              }}
            />
            <input
              type="text"
              className="form-input"
              placeholder="Search branches by name, code, city, or address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '36px', height: '38px', borderRadius: '8px' }}
            />
          </div>

          {/* Filters Row */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b', fontSize: '13px' }}>
              <SlidersHorizontal size={14} />
              <span>Filter:</span>
            </div>

            {/* City Filter */}
            <select
              className="form-select"
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
              style={{ height: '38px', minWidth: '130px', borderRadius: '8px', fontSize: '13px' }}
            >
              <option value="ALL">All Cities ({citiesCount})</option>
              {distinctCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              className="form-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              style={{ height: '38px', minWidth: '120px', borderRadius: '8px', fontSize: '13px' }}
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>

            {(searchQuery || selectedCity !== 'ALL' || selectedStatus !== 'ALL') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCity('ALL');
                  setSelectedStatus('ALL');
                }}
                style={{ height: '38px' }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Results Counter Pill */}
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            Showing <strong>{filteredBranches.length}</strong> of <strong>{branches.length}</strong> branches
          </span>
          <span style={{ color: '#066006', fontWeight: 600 }}>
            {totalUnitsInNetwork.toLocaleString()} total units stocked across branches
          </span>
        </div>
      </section>

      {/* Grid of Branch Cards */}
      {filteredBranches.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#64748b',
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #e2e8e2',
          }}
        >
          <Building2 size={48} style={{ margin: '0 auto 16px', opacity: 0.35, color: '#066006' }} />
          <h3 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: '17px' }}>
            {searchQuery || selectedCity !== 'ALL' || selectedStatus !== 'ALL'
              ? 'No matching branches found'
              : 'No branches configured yet'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery || selectedCity !== 'ALL' || selectedStatus !== 'ALL'
              ? 'Try changing your search keywords or clearing filters.'
              : 'Click "New Branch" to add your first sales showroom.'}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: '18px',
          }}
        >
          {filteredBranches.map((branch) => {
            const isActive = branch.is_active !== false && branch.is_active !== 0;
            return (
              <div
                key={branch.id}
                onClick={() => navigate(`/branches/${branch.id}`)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8e2',
                  borderRadius: '14px',
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(6, 96, 6, 0.12)';
                  e.currentTarget.style.borderColor = '#0b8f08';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
                  e.currentTarget.style.borderColor = '#e2e8e2';
                }}
              >
                {/* Top Accent Strip */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '4px',
                    background: isActive
                      ? 'linear-gradient(90deg, #0b8f08, #22c55e)'
                      : '#94a3b8',
                  }}
                />

                {/* Card Header */}
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '12px',
                      marginBottom: '14px',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            letterSpacing: '0.5px',
                            background: '#f0fdf4',
                            color: '#166534',
                            border: '1px solid #bbf7d0',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            fontFamily: 'monospace',
                          }}
                        >
                          {branch.code}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                          • {branch.city}
                        </span>
                      </div>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: '17px',
                          fontWeight: 700,
                          color: '#0f172a',
                          letterSpacing: '-0.3px',
                          lineHeight: 1.3,
                        }}
                      >
                        {branch.name}
                      </h3>
                    </div>

                    {/* Status Badge with Live Dot indicator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isActive ? '#16a34a' : '#94a3b8',
                          boxShadow: isActive ? '0 0 6px rgba(22, 163, 74, 0.6)' : 'none',
                        }}
                      />
                      <StatusBadge
                        label={isActive ? 'ACTIVE' : 'INACTIVE'}
                        tone={isActive ? 'green' : 'neutral'}
                      />
                    </div>
                  </div>

                  {/* Location Address & Phone */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '18px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '13px',
                        color: '#475569',
                      }}
                    >
                      <MapPin size={15} style={{ color: '#0b8f08', flexShrink: 0, marginTop: '2px' }} />
                      <span>
                        <strong style={{ color: '#1e293b' }}>{branch.city}</strong>
                        {branch.address ? ` — ${branch.address}` : ' — Main Commercial District'}
                      </span>
                    </div>
                    {branch.phone && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '12px',
                          color: '#64748b',
                        }}
                      >
                        <Phone size={14} style={{ color: '#0b8f08', flexShrink: 0 }} />
                        <span>{branch.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Key Stats Pill Bar */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      background: '#f8fafc',
                      borderRadius: '10px',
                      padding: '12px 10px',
                      marginBottom: '18px',
                      border: '1px solid #f1f5f9',
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <Package size={12} /> Stock
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                        {(Number(branch.total_units) || 0).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <ShoppingBag size={12} /> Orders
                      </div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>
                        {(Number(branch.order_count) || 0).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <DollarSign size={12} /> Revenue
                      </div>
                      <div style={{ fontSize: '14px', fontWeight: 800, color: '#166534' }}>
                        ${(Number(branch.total_revenue) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '14px',
                    borderTop: '1px solid #f1f5f9',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={(e) => handleRegenerateCredentials(branch.id, branch.name, e)}
                      disabled={regenerating === branch.id}
                      title="Regenerate branch user login credentials"
                      style={{
                        padding: '6px 10px',
                        border: '1px solid #e2e8e2',
                        borderRadius: '8px',
                        background: '#fff',
                        cursor: 'pointer',
                        color: '#475569',
                        fontSize: '12px',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <RefreshCw size={13} className={regenerating === branch.id ? 'spin-icon' : ''} />
                      {regenerating === branch.id ? 'Regen…' : 'Creds'}
                    </button>

                    {hasPermission('manage_users') && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingBranch(branch);
                          setIsEditModalOpen(true);
                        }}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid #e2e8e2',
                          background: '#fff',
                          cursor: 'pointer',
                          color: '#475569',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                        }}
                        title="Edit Branch Information"
                      >
                        <Edit2 size={13} />
                      </button>
                    )}

                    {hasPermission('manage_users') && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(branch.id, branch.name, e)}
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          border: '1px solid #fee2e2',
                          background: '#fff',
                          cursor: 'pointer',
                          color: '#dc2626',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                        }}
                        title="Delete Branch"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate(`/branches/${branch.id}`)}
                    style={{
                      background: '#f0fdf4',
                      color: '#166534',
                      border: '1px solid #bbf7d0',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    View Details <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CREATE BRANCH MODAL ── */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add New Branch Outlet">
        <form onSubmit={handleCreate} style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
            <FormField label="Branch Code *" id="brCode">
              <input
                type="text"
                id="brCode"
                className="form-input"
                required
                placeholder="e.g. BR-BBO"
                value={newBranch.code}
                onChange={(e) => setNewBranch({ ...newBranch, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="Branch / Showroom Name *" id="brName">
              <input
                type="text"
                id="brName"
                className="form-input"
                required
                placeholder="e.g. Al Hayat Borama Branch"
                value={newBranch.name}
                onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })}
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <FormField label="City *" id="brCity">
              <input
                type="text"
                id="brCity"
                className="form-input"
                required
                placeholder="e.g. Borama"
                value={newBranch.city}
                onChange={(e) => setNewBranch({ ...newBranch, city: e.target.value })}
              />
            </FormField>
            <FormField label="Contact Phone" id="brPhone">
              <input
                type="text"
                id="brPhone"
                className="form-input"
                placeholder="e.g. +252 63 4440003"
                value={newBranch.phone}
                onChange={(e) => setNewBranch({ ...newBranch, phone: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Street Address / Location" id="brAddress">
            <input
              type="text"
              id="brAddress"
              className="form-input"
              placeholder="e.g. Main Commercial Market, Near Central Bank"
              value={newBranch.address}
              onChange={(e) => setNewBranch({ ...newBranch, address: e.target.value })}
            />
          </FormField>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? <><Loader2 size={14} className="spin-icon" /> Creating…</> : 'Create Branch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── EDIT BRANCH MODAL ── */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingBranch(null);
        }}
        title="Edit Branch Outlet"
      >
        {editingBranch && (
          <form onSubmit={handleEdit} style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px' }}>
              <FormField label="Branch Code *" id="editBrCode">
                <input
                  type="text"
                  id="editBrCode"
                  className="form-input"
                  required
                  value={editingBranch.code}
                  onChange={(e) => setEditingBranch({ ...editingBranch, code: e.target.value.toUpperCase() })}
                />
              </FormField>
              <FormField label="Branch Name *" id="editBrName">
                <input
                  type="text"
                  id="editBrName"
                  className="form-input"
                  required
                  value={editingBranch.name}
                  onChange={(e) => setEditingBranch({ ...editingBranch, name: e.target.value })}
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormField label="City *" id="editBrCity">
                <input
                  type="text"
                  id="editBrCity"
                  className="form-input"
                  required
                  value={editingBranch.city}
                  onChange={(e) => setEditingBranch({ ...editingBranch, city: e.target.value })}
                />
              </FormField>
              <FormField label="Contact Phone" id="editBrPhone">
                <input
                  type="text"
                  id="editBrPhone"
                  className="form-input"
                  value={editingBranch.phone || ''}
                  onChange={(e) => setEditingBranch({ ...editingBranch, phone: e.target.value })}
                />
              </FormField>
            </div>

            <FormField label="Street Address" id="editBrAddress">
              <input
                type="text"
                id="editBrAddress"
                className="form-input"
                value={editingBranch.address || ''}
                onChange={(e) => setEditingBranch({ ...editingBranch, address: e.target.value })}
              />
            </FormField>

            <FormField label="Operational Status" id="editBrActive">
              <select
                id="editBrActive"
                className="form-select"
                value={editingBranch.is_active ? '1' : '0'}
                onChange={(e) => setEditingBranch({ ...editingBranch, is_active: e.target.value === '1' ? 1 : 0 })}
              >
                <option value="1">Active (Operational for POS & Sales)</option>
                <option value="0">Inactive (Decommissioned / Closed)</option>
              </select>
            </FormField>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingBranch(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <><Loader2 size={14} className="spin-icon" /> Saving…</> : 'Save Changes'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ── ONE-TIME CREDENTIAL MODAL ── */}
      <Modal
        isOpen={!!credModal}
        onClose={() => setCredModal(null)}
        title="Branch User Login Credentials"
      >
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            borderRadius: '10px',
            padding: '14px',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}>
            <ShieldCheck size={20} color="#b45309" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
                Secure One-Time Display
              </h4>
              <p style={{ margin: 0, fontSize: '12px', color: '#78350f', lineHeight: 1.4 }}>
                These login credentials for <strong>{credModal?.branchName}</strong> will only be shown once. Please copy and securely deliver them to the branch manager.
              </p>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
              BRANCH USERNAME / EMAIL
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1,
                background: '#f8fafc',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '13px',
                border: '1px solid #e2e8f0',
                fontWeight: 600,
                color: '#0f172a',
              }}>
                {credModal?.branchUser.username}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => credModal && handleCopy(credModal.branchUser.username, 'username')}
                style={{ padding: '8px 12px' }}
              >
                {copied === 'username' ? <CheckCheck size={15} color="#16a34a" /> : <Copy size={15} />}
              </button>
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
              GENERATED PASSWORD
            </label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1,
                background: '#fef2f2',
                borderRadius: '8px',
                padding: '10px 14px',
                fontSize: '14px',
                letterSpacing: '0.05em',
                border: '1px solid #fecaca',
                fontWeight: 700,
                color: '#dc2626',
              }}>
                {credModal?.branchUser.rawPassword}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => credModal && handleCopy(credModal.branchUser.rawPassword, 'password')}
                style={{ padding: '8px 12px' }}
              >
                {copied === 'password' ? <CheckCheck size={15} color="#16a34a" /> : <Copy size={15} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button type="button" className="btn btn-primary" onClick={() => setCredModal(null)}>
              I Have Saved The Credentials
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmLabel="Yes, Delete Branch"
        cancelLabel="Cancel"
        isDestructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((p) => ({ ...p, isOpen: false }))}
      />
    </div>
  );
}
