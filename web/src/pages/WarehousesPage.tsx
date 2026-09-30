import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Warehouse,
  MapPin,
  Trash2,
  Edit2,
  Loader2,
  Plus,
  Search,
  Boxes,
  Package,
  Phone,
  ArrowRight,
  Layers,
  CheckCircle2,
  Building2,
  SlidersHorizontal,
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

interface WarehouseItem {
  id: string;
  name: string;
  city: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_active: boolean | number;
  location_count?: number;
  total_units?: number;
  total_skus?: number;
  inventory_value?: number;
}

export function WarehousesPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();

  const [warehouses, setWarehouses] = useState<WarehouseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newWh, setNewWh] = useState({ code: '', name: '', city: '', address: '', phone: '' });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingWh, setEditingWh] = useState<WarehouseItem | null>(null);

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

  const [submitting, setSubmitting] = useState(false);

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      const data = await apiGet<WarehouseItem[]>('/warehouses');
      setWarehouses(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load warehouses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWarehouses();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    try {
      setSubmitting(true);
      await apiPost('/warehouses', newWh);
      addToast('success', 'Warehouse created successfully');
      setNewWh({ code: '', name: '', city: '', address: '', phone: '' });
      setIsModalOpen(false);
      loadWarehouses();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create warehouse');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWh || submitting) return;
    try {
      setSubmitting(true);
      await apiPatch(`/warehouses/${editingWh.id}`, {
        code: editingWh.code,
        name: editingWh.name,
        city: editingWh.city,
        address: editingWh.address,
        phone: editingWh.phone,
      });
      addToast('success', 'Warehouse updated successfully');
      setIsEditModalOpen(false);
      setEditingWh(null);
      loadWarehouses();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update warehouse');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      isOpen: true,
      title: 'Delete Warehouse',
      message:
        'Are you sure you want to delete this warehouse? If there is existing stock or locations, the deletion will be safely rejected.',
      onConfirm: async () => {
        try {
          await apiDelete(`/warehouses/${id}`);
          addToast('success', 'Warehouse deleted successfully');
          loadWarehouses();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete warehouse');
        }
      },
    });
  };

  if (loading) {
    return <PageSkeleton />;
  }

  // Cities list for filter dropdown
  const distinctCities = Array.from(new Set(warehouses.map((w) => w.city).filter(Boolean)));

  // Filtered warehouses
  const filteredWarehouses = warehouses.filter((w) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      w.name.toLowerCase().includes(q) ||
      (w.city && w.city.toLowerCase().includes(q)) ||
      (w.code && w.code.toLowerCase().includes(q)) ||
      (w.address && w.address.toLowerCase().includes(q));

    const matchesCity = selectedCity === 'ALL' || w.city === selectedCity;
    const isActive = w.is_active !== false && w.is_active !== 0;
    const matchesStatus =
      selectedStatus === 'ALL' ||
      (selectedStatus === 'ACTIVE' && isActive) ||
      (selectedStatus === 'INACTIVE' && !isActive);

    return matchesSearch && matchesCity && matchesStatus;
  });

  const totalWarehouses = warehouses.length;
  const activeWarehouses = warehouses.filter((w) => w.is_active !== false && w.is_active !== 0).length;
  const citiesCount = distinctCities.length;
  const totalUnitsInNetwork = warehouses.reduce((acc, w) => acc + (Number(w.total_units) || 0), 0);
  const totalBinsInNetwork = warehouses.reduce((acc, w) => acc + (Number(w.location_count) || 0), 0);

  return (
    <div className="module-page">
      {/* Module Header */}
      <section className="module-header">
        <div className="module-header__icon" style={{ background: '#e9f6e8', color: '#066006' }}>
          <Warehouse size={24} />
        </div>
        <div className="module-header__info">
          <p>Inventory & Fulfillment</p>
          <h2>Warehouses & Storage Network</h2>
        </div>
        <div className="module-header__actions">
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsModalOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={16} /> New Warehouse
            </button>
          )}
        </div>
      </section>

      {/* KPI Stats Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total Facilities"
          value={String(totalWarehouses)}
          trend="Storage & depot network"
          icon={<Building2 size={20} />}
        />
        <MetricCard
          label="Active Depots"
          value={`${activeWarehouses} Active`}
          trend="Operational for fulfillment"
          icon={<CheckCircle2 size={20} />}
        />
        <MetricCard
          label="Cities Covered"
          value={`${citiesCount} Cities`}
          trend="Logistics footprint"
          icon={<MapPin size={20} />}
        />
        <MetricCard
          label="Total Units On-Hand"
          value={totalUnitsInNetwork.toLocaleString()}
          trend={`${totalBinsInNetwork} storage slots`}
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
              placeholder="Search warehouses by name, code, city, or address..."
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
            Showing <strong>{filteredWarehouses.length}</strong> of <strong>{warehouses.length}</strong> warehouses
          </span>
          <span style={{ color: '#066006', fontWeight: 600 }}>
            {totalUnitsInNetwork.toLocaleString()} total units stored across network
          </span>
        </div>
      </section>

      {/* Grid of Warehouse Cards */}
      {filteredWarehouses.length === 0 ? (
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
          <Boxes size={48} style={{ margin: '0 auto 16px', opacity: 0.35, color: '#066006' }} />
          <h3 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: '17px' }}>
            {searchQuery || selectedCity !== 'ALL' || selectedStatus !== 'ALL'
              ? 'No matching warehouses found'
              : 'No warehouses configured yet'}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            {searchQuery || selectedCity !== 'ALL' || selectedStatus !== 'ALL'
              ? 'Try changing your search keywords or clearing filters.'
              : 'Click "New Warehouse" to add your first storage facility.'}
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
          {filteredWarehouses.map((wh) => {
            const isActive = wh.is_active !== false && wh.is_active !== 0;
            return (
              <div
                key={wh.id}
                onClick={() => navigate(`/warehouses/${wh.id}`)}
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
                          {wh.code}
                        </span>
                        <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                          • {wh.city}
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
                        {wh.name}
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
                        <strong style={{ color: '#1e293b' }}>{wh.city}</strong>
                        {wh.address ? ` — ${wh.address}` : ' — General Depot Location'}
                      </span>
                    </div>
                    {wh.phone && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '12px',
                          color: '#64748b',
                        }}
                      >
                        <Phone size={14} style={{ color: '#64748b', flexShrink: 0 }} />
                        <span>{wh.phone}</span>
                      </div>
                    )}
                  </div>

                  {/* Metrics Subgrid */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px',
                      background: '#f8faf8',
                      border: '1px solid #edf2ed',
                      borderRadius: '10px',
                      padding: '12px 10px',
                      marginBottom: '18px',
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        On-Hand
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#066006', marginTop: '2px' }}>
                        {(wh.total_units ?? 0).toLocaleString()}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Units</div>
                    </div>

                    <div style={{ textAlign: 'center', borderLeft: '1px solid #e2e8e2', borderRight: '1px solid #e2e8e2' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        SKUs
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                        {wh.total_skus ?? 0}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Catalog items</div>
                    </div>

                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                        Storage
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                        {wh.location_count ?? 0}
                      </div>
                      <div style={{ fontSize: '10px', color: '#94a3b8' }}>Bin slots</div>
                    </div>
                  </div>
                </div>

                {/* Card Action Footer */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '14px',
                    borderTop: '1px solid #f1f5f1',
                    gap: '10px',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/warehouses/${wh.id}`);
                    }}
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      fontWeight: 600,
                      color: '#066006',
                      borderColor: '#bbf7d0',
                      background: '#f4fbf4',
                    }}
                  >
                    View Details & Inventory <ArrowRight size={14} />
                  </button>

                  {hasPermission('manage_inventory') && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingWh(wh);
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
                        title="Edit Warehouse Details"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(wh.id, e)}
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
                        title="Delete Warehouse"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Warehouse">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Warehouse Code *">
            <input
              type="text"
              className="form-input"
              required
              placeholder="e.g. WH-MAIN or WH-NORTH"
              value={newWh.code}
              onChange={(e) => setNewWh({ ...newWh, code: e.target.value.toUpperCase() })}
            />
          </FormField>
          <FormField label="Warehouse Name *">
            <input
              type="text"
              className="form-input"
              required
              placeholder="e.g. Al Hayat Central Fulfillment Depot"
              value={newWh.name}
              onChange={(e) => setNewWh({ ...newWh, name: e.target.value })}
            />
          </FormField>
          <FormField label="City / Region *">
            <input
              type="text"
              className="form-input"
              required
              placeholder="e.g. Hargeisa, Berbera, Burao"
              value={newWh.city}
              onChange={(e) => setNewWh({ ...newWh, city: e.target.value })}
            />
          </FormField>
          <FormField label="Street Address">
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Industrial Zone, Block 4"
              value={newWh.address || ''}
              onChange={(e) => setNewWh({ ...newWh, address: e.target.value })}
            />
          </FormField>
          <FormField label="Contact Phone">
            <input
              type="text"
              className="form-input"
              placeholder="e.g. +252 63 4440010"
              value={newWh.phone || ''}
              onChange={(e) => setNewWh({ ...newWh, phone: e.target.value })}
            />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ display: 'flex', alignItems: 'center' }}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="spin-icon" /> Creating…
                </>
              ) : (
                'Create Warehouse'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      {isEditModalOpen && editingWh && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingWh(null);
          }}
          title="Edit Warehouse Details"
        >
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <FormField label="Warehouse Code *">
              <input
                type="text"
                className="form-input"
                required
                value={editingWh.code || ''}
                onChange={(e) => setEditingWh({ ...editingWh, code: e.target.value.toUpperCase() })}
              />
            </FormField>
            <FormField label="Warehouse Name *">
              <input
                type="text"
                className="form-input"
                required
                value={editingWh.name}
                onChange={(e) => setEditingWh({ ...editingWh, name: e.target.value })}
              />
            </FormField>
            <FormField label="City / Region *">
              <input
                type="text"
                className="form-input"
                required
                value={editingWh.city}
                onChange={(e) => setEditingWh({ ...editingWh, city: e.target.value })}
              />
            </FormField>
            <FormField label="Street Address">
              <input
                type="text"
                className="form-input"
                value={editingWh.address || ''}
                onChange={(e) => setEditingWh({ ...editingWh, address: e.target.value })}
              />
            </FormField>
            <FormField label="Contact Phone">
              <input
                type="text"
                className="form-input"
                value={editingWh.phone || ''}
                onChange={(e) => setEditingWh({ ...editingWh, phone: e.target.value })}
              />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingWh(null);
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
                style={{ display: 'flex', alignItems: 'center' }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} className="spin-icon" /> Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirmation Dialog */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        isDestructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
