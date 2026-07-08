import { useEffect, useState } from 'react';
import { Boxes, MapPin, Plus, List } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { Modal } from '../components/Modal';
import { InputField, FormField } from '../components/FormField';
import { DataTable, type Column } from '../components/DataTable';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Warehouse {
  id: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  location_count?: number;
}

interface WarehouseLocation {
  id: string;
  warehouse_id: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  barcode: string | null;
}

export function WarehousesPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();
  
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected warehouse for locations view
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);

  // Form for adding a location
  const [isAddLocationOpen, setIsAddLocationOpen] = useState(false);
  const [newLoc, setNewLoc] = useState({
    aisle: '',
    rack: '',
    shelf: '',
    bin: '',
    barcode: '',
  });

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newWh, setNewWh] = useState({ code: '', name: '', city: '', address: '' });

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost('/warehouses', newWh);
      addToast('success', 'Warehouse created successfully');
      setNewWh({ code: '', name: '', city: '', address: '' });
      setIsModalOpen(false);
      loadWarehouses();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create warehouse');
    }
  };

  const handleViewLocations = async (wh: Warehouse) => {
    setSelectedWarehouse(wh);
    setLocationsLoading(true);
    try {
      const data = await apiGet<WarehouseLocation[]>(`/warehouses/${wh.id}/locations`);
      setLocations(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load warehouse locations');
    } finally {
      setLocationsLoading(false);
    }
  };

  const handleAddLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWarehouse) return;
    if (!newLoc.aisle || !newLoc.rack || !newLoc.shelf || !newLoc.bin) {
      addToast('error', 'All fields are required');
      return;
    }

    try {
      await apiPost(`/warehouses/${selectedWarehouse.id}/locations`, newLoc);
      addToast('success', 'Location created successfully');
      setNewLoc({ aisle: '', rack: '', shelf: '', bin: '', barcode: '' });
      setIsAddLocationOpen(false);
      
      // Reload locations
      handleViewLocations(selectedWarehouse);
      
      // Reload warehouse counts
      loadWarehouses();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create location');
    }
  };

  if (loading) {
    return <PageSkeleton />;
  }

  const locationColumns: Column<WarehouseLocation>[] = [
    { key: 'aisle', label: 'Aisle' },
    { key: 'rack', label: 'Rack' },
    { key: 'shelf', label: 'Shelf' },
    { key: 'bin', label: 'Bin' },
    { key: 'barcode', label: 'Location Barcode', render: (row) => row.barcode || 'N/A' },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Boxes size={24} />
        </div>
        <div>
          <p>Locations</p>
          <h2>Warehouses, aisles, racks, shelves, and bins</h2>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            + New Warehouse
          </button>
        </div>
      </section>

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
            <input type="text" className="form-input" value={newWh.address} onChange={e => setNewWh({...newWh, address: e.target.value})} />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      {/* Grid of Warehouses */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '16px'
      }}>
        {warehouses.map((wh) => (
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
                City: <strong>{wh.city}</strong>
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
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleViewLocations(wh)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <List size={14} /> View Locations
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* View Locations Modal */}
      <Modal
        isOpen={!!selectedWarehouse}
        onClose={() => setSelectedWarehouse(null)}
        title={selectedWarehouse ? `Bin Locations: ${selectedWarehouse.name}` : 'Locations'}
        width="lg"
      >
        {selectedWarehouse && (
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px',
              borderBottom: '1px solid #edf1ed',
              paddingBottom: '12px'
            }}>
              <div>
                <p style={{ margin: '0', color: '#667066', fontSize: '13px' }}>
                  {selectedWarehouse.city} — {selectedWarehouse.address || 'No Address'}
                </p>
              </div>
              {hasPermission('inventory.adjust') && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setIsAddLocationOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Plus size={14} /> Add Bin Location
                </button>
              )}
            </div>

            <DataTable
              columns={locationColumns}
              data={locations}
              keyExtractor={(row) => row.id}
              loading={locationsLoading}
              emptyMessage="No bin locations configured for this warehouse"
            />
          </div>
        )}
      </Modal>

      {/* Add Location Sub-Modal */}
      <Modal
        isOpen={isAddLocationOpen}
        onClose={() => setIsAddLocationOpen(false)}
        title="Add Warehouse Bin Location"
        width="sm"
      >
        <form onSubmit={handleAddLocationSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField
              label="Aisle"
              id="aisle"
              placeholder="e.g. A-02"
              value={newLoc.aisle}
              onChange={(val) => setNewLoc(prev => ({ ...prev, aisle: val }))}
              required
            />
            <InputField
              label="Rack"
              id="rack"
              placeholder="e.g. R4"
              value={newLoc.rack}
              onChange={(val) => setNewLoc(prev => ({ ...prev, rack: val }))}
              required
            />
            <InputField
              label="Shelf"
              id="shelf"
              placeholder="e.g. S1"
              value={newLoc.shelf}
              onChange={(val) => setNewLoc(prev => ({ ...prev, shelf: val }))}
              required
            />
            <InputField
              label="Bin"
              id="bin"
              placeholder="e.g. B8"
              value={newLoc.bin}
              onChange={(val) => setNewLoc(prev => ({ ...prev, bin: val }))}
              required
            />
            <InputField
              label="Barcode (Optional)"
              id="locBarcode"
              placeholder="e.g. LOC-00123"
              value={newLoc.barcode}
              onChange={(val) => setNewLoc(prev => ({ ...prev, barcode: val }))}
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsAddLocationOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Location
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
