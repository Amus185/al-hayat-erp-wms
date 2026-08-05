import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, MapPin, Eye, Trash2, Edit2, Loader2, Plus, Search, CheckCheck } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { FormField } from '../components/FormField';
import { PageSkeleton } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Warehouse {
  id: string;
  name: string;
  city: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  location_count?: number;
}

export function WarehousesPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newWh, setNewWh] = useState({ code: '', name: '', city: '', address: '' });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);

  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const loadWarehouses = async () => {
    try {
      setLoading(true);
      const data = await apiGet<Warehouse[]>('/warehouses');
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

  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    try {
      setSubmitting(true);
      await apiPost('/warehouses', newWh);
      addToast('success', 'Warehouse created successfully');
      setNewWh({ code: '', name: '', city: '', address: '' });
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
      message: 'Are you sure you want to delete this warehouse? Active inventory or associated locations will prevent deletion.',
      onConfirm: async () => {
        try {
          await apiDelete(`/warehouses/${id}`);
          addToast('success', 'Warehouse deleted successfully');
          loadWarehouses();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete warehouse');
        }
      }
    });
  };

  if (loading) {
    return <PageSkeleton />;
  }

  const filteredWarehouses = warehouses.filter(w => 
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (w.city && w.city.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (w.code && w.code.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const totalWarehouses = warehouses.length;
  const activeWarehouses = warehouses.filter(w => w.is_active !== false).length;
  const citiesCount = new Set(warehouses.map(w => w.city).filter(Boolean)).size;

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Module Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Warehouses</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>{totalWarehouses} total storage locations · {activeWarehouses} active</p>
        </div>
        {hasPermission('manage_inventory') && (
          <button
            onClick={() => setIsModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: '#0b8f08', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
          >
            <Plus size={16} /> New Warehouse
          </button>
        )}
      </div>

      {/* KPI Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '8px' }}><Boxes size={20} color="#0b8f08" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{totalWarehouses}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Warehouses</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '8px' }}><CheckCheck size={20} color="#2563eb" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{activeWarehouses}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Active Locations</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#ede9fe', borderRadius: '8px', padding: '8px' }}><MapPin size={20} color="#7c3aed" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{citiesCount}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Cities Covered</div>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search warehouses by name, code, or city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '9px 10px 9px 32px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer', color: '#6b7280' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Create Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Warehouse">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Warehouse Code *">
            <input type="text" className="form-input" required placeholder="e.g. WH-MAIN" value={newWh.code} onChange={e => setNewWh({...newWh, code: e.target.value})} />
          </FormField>
          <FormField label="Warehouse Name *">
            <input type="text" className="form-input" required placeholder="e.g. Central Warehouse" value={newWh.name} onChange={e => setNewWh({...newWh, name: e.target.value})} />
          </FormField>
          <FormField label="City *">
            <input type="text" className="form-input" required placeholder="e.g. Hargeisa" value={newWh.city} onChange={e => setNewWh({...newWh, city: e.target.value})} />
          </FormField>
          <FormField label="Address">
            <input type="text" className="form-input" placeholder="Optional street address" value={newWh.address || ''} onChange={e => setNewWh({...newWh, address: e.target.value})} />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Creating…</>
              ) : (
                'Create Warehouse'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      {isEditModalOpen && editingWh && (
        <Modal isOpen={isEditModalOpen} onClose={() => { setIsEditModalOpen(false); setEditingWh(null); }} title="Edit Warehouse">
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <FormField label="Warehouse Code *">
              <input type="text" className="form-input" required value={editingWh.code || ''} onChange={e => setEditingWh({...editingWh, code: e.target.value})} />
            </FormField>
            <FormField label="Warehouse Name *">
              <input type="text" className="form-input" required value={editingWh.name} onChange={e => setEditingWh({...editingWh, name: e.target.value})} />
            </FormField>
            <FormField label="City *">
              <input type="text" className="form-input" required value={editingWh.city} onChange={e => setEditingWh({...editingWh, city: e.target.value})} />
            </FormField>
            <FormField label="Address">
              <input type="text" className="form-input" value={editingWh.address || ''} onChange={e => setEditingWh({...editingWh, address: e.target.value})} />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setIsEditModalOpen(false); setEditingWh(null); }} disabled={submitting}>Cancel</button>
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
      )}

      {/* Grid of Warehouses */}
      {filteredWarehouses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <Boxes size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>{searchQuery ? 'No matching warehouses found' : 'No warehouses yet'}</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{searchQuery ? 'Try adjusting your search' : 'Click "New Warehouse" to create one'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredWarehouses.map((wh) => (
            <div
              key={wh.id}
              onClick={() => navigate(`/warehouses/${wh.id}`)}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'box-shadow 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#111827' }}>{wh.name}</h3>
                    <span style={{ fontSize: '11px', background: '#f3f4f6', padding: '2px 8px', borderRadius: '6px', color: '#4b5563', fontWeight: 600, fontFamily: 'monospace' }}>{wh.code}</span>
                  </div>
                  <StatusBadge status={wh.is_active !== false ? 'ACTIVE' : 'INACTIVE'} />
                </div>
                {wh.city && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: '#6b7280', margin: '4px 0' }}>
                    <MapPin size={14} style={{ color: '#0b8f08', flexShrink: 0 }} />
                    <strong style={{ color: '#374151' }}>{wh.city}</strong>
                    {wh.address && ` — ${wh.address}`}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  Bin Locations: <strong style={{ color: '#111827' }}>{wh.location_count ?? 0}</strong>
                </span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); navigate(`/warehouses/${wh.id}`); }}
                    style={{ padding: '6px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}
                    title="View Details"
                  >
                    <Eye size={13} />
                  </button>
                  {hasPermission('manage_inventory') && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingWh(wh); setIsEditModalOpen(true); }}
                        style={{ padding: '6px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#6b7280', display: 'flex', alignItems: 'center' }}
                        title="Edit Warehouse"
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(wh.id, e)}
                        style={{ padding: '6px', border: '1px solid #fee2e2', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#dc2626', display: 'flex', alignItems: 'center' }}
                        title="Delete Warehouse"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
