import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, MapPin, Eye, Trash2, Edit2, Loader2 } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api/client';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { InputField, FormField } from '../components/FormField';
import { PageSkeleton } from '../components/LoadingSpinner';
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

  // Search
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
      message: 'Are you sure you want to delete this warehouse? This action cannot be undone and will fail if the warehouse has active inventory.',
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
    (w.city && w.city.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Boxes size={24} />
        </div>
        <div className="module-header__info">
          <p>Locations</p>
          <h2>Warehouses, aisles, racks, shelves, and bins</h2>
        </div>
        <div>
          {hasPermission('manage_inventory') && (
            <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
              + New Warehouse
            </button>
          )}
        </div>
      </section>

      <section style={{ marginBottom: '14px', maxWidth: '400px' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search warehouses by name or city..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </section>

      {/* Create Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Warehouse">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Code">
            <input type="text" className="form-input" required value={newWh.code} onChange={e => setNewWh({...newWh, code: e.target.value})} />
          </FormField>
          <FormField label="Name">
            <input type="text" className="form-input" required value={newWh.name} onChange={e => setNewWh({...newWh, name: e.target.value})} />
          </FormField>
          <FormField label="City">
            <input type="text" className="form-input" required value={newWh.city} onChange={e => setNewWh({...newWh, city: e.target.value})} />
          </FormField>
          <FormField label="Address">
            <input type="text" className="form-input" value={newWh.address || ''} onChange={e => setNewWh({...newWh, address: e.target.value})} />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
            <FormField label="Code">
              <input type="text" className="form-input" required value={editingWh.code || ''} onChange={e => setEditingWh({...editingWh, code: e.target.value})} />
            </FormField>
            <FormField label="Name">
              <input type="text" className="form-input" required value={editingWh.name} onChange={e => setEditingWh({...editingWh, name: e.target.value})} />
            </FormField>
            <FormField label="City">
              <input type="text" className="form-input" required value={editingWh.city} onChange={e => setEditingWh({...editingWh, city: e.target.value})} />
            </FormField>
            <FormField label="Address">
              <input type="text" className="form-input" value={editingWh.address || ''} onChange={e => setEditingWh({...editingWh, address: e.target.value})} />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
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
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px'
      }}>
        {filteredWarehouses.map((wh) => (
          <div key={wh.id} className="panel" style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '20px',
            minHeight: '180px'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <MapPin size={18} style={{ color: '#0b8f08' }} />
                <h3 style={{ margin: '0', fontSize: '18px', color: '#066006' }}>{wh.name}</h3>
              </div>
              <p style={{ margin: '0 0 6px', color: '#667066', fontSize: '13px' }}>
                City: <strong>{wh.city}</strong> | Code: <strong>{wh.code}</strong>
              </p>
              <p style={{ margin: '0 0 12px', color: '#667066', fontSize: '13px' }}>
                Address: {wh.address || 'N/A'}
              </p>
            </div>
            
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderTop: '1px solid #edf1ed',
              paddingTop: '12px',
              marginTop: '12px'
            }}>
              <span style={{ fontSize: '13px', color: '#394339' }}>
                Bin Locations: <strong>{wh.location_count ?? 0}</strong>
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigate(`/warehouses/${wh.id}`)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Eye size={14} /> Details
                </button>
                {hasPermission('manage_inventory') && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setEditingWh(wh); setIsEditModalOpen(true); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <Edit2 size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={(e) => handleDelete(wh.id, e)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </section>

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
