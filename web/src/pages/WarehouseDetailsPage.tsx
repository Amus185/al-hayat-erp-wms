import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Warehouse, Box, MapPin, TruckIcon, Package, DollarSign } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface WarehouseInfo {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
}

interface WarehouseSummary {
  total_products: number;
  total_units: number;
  inventory_value: number;
  location_count: number;
  receipts_count: number;
  transfers_in: number;
  transfers_out: number;
}

interface WarehouseInventory {
  id: string;
  product_id: string;
  name: string;
  sku: string;
  barcode: string;
  quantity_on_hand: number;
}

interface WarehouseLocation {
  id: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  barcode: string | null;
}

export function WarehouseDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [warehouse, setWarehouse] = useState<WarehouseInfo | null>(null);
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [inventory, setInventory] = useState<WarehouseInventory[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!id) return;
      try {
        setLoading(true);
        const [whInfo, whSummary, whInventory, whLocations] = await Promise.all([
          apiGet<WarehouseInfo>(`/warehouses/${id}`),
          apiGet<WarehouseSummary>(`/warehouses/${id}/summary`),
          apiGet<WarehouseInventory[]>(`/warehouses/${id}/inventory`),
          apiGet<WarehouseLocation[]>(`/warehouses/${id}/locations`),
        ]);
        setWarehouse(whInfo);
        setSummary(whSummary);
        setInventory(whInventory || []);
        setLocations(whLocations || []);
      } catch (err: any) {
        addToast('error', err?.message || 'Failed to load warehouse details');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) return <PageSkeleton />;

  if (!warehouse) {
    return (
      <div className="empty-state">
        <Warehouse size={48} />
        <p>Warehouse not found</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/warehouses')}>
          Back to Warehouses
        </button>
      </div>
    );
  }

  const invColumns: Column<WarehouseInventory>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product Name' },
    { key: 'barcode', label: 'Barcode', render: (row) => row.barcode || '—' },
    {
      key: 'quantity_on_hand',
      label: 'Qty On Hand',
      render: (row) => (
        <span style={{ fontWeight: '700', color: row.quantity_on_hand <= 3 ? '#991b1b' : '#066006' }}>
          {row.quantity_on_hand}
        </span>
      ),
    },
  ];

  const locColumns: Column<WarehouseLocation>[] = [
    { key: 'aisle', label: 'Aisle' },
    { key: 'rack', label: 'Rack' },
    { key: 'shelf', label: 'Shelf' },
    { key: 'bin', label: 'Bin' },
    { key: 'barcode', label: 'Location Barcode', render: (row) => row.barcode || '—' },
  ];

  const totalProducts = summary?.total_products || 0;
  const totalUnits = summary?.total_units || 0;
  const inventoryValue = summary?.inventory_value || 0;
  const locationCount = summary?.location_count || 0;
  const receiptsCount = summary?.receipts_count || 0;
  const transfersIn = summary?.transfers_in || 0;
  const transfersOut = summary?.transfers_out || 0;

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/warehouses')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Warehouses
        </button>
      </section>

      {/* Header Info */}
      <section className="panel" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '8px',
            background: '#e9f6e8',
            color: '#066006',
            display: 'grid',
            placeItems: 'center'
          }}>
            <Warehouse size={24} />
          </div>
          <div>
            <span style={{ fontSize: '11px', color: '#667066', fontWeight: '800' }}>{warehouse.code}</span>
            <h2 style={{ margin: '2px 0 0', fontSize: '22px' }}>{warehouse.name}</h2>
            <p style={{ margin: '4px 0 0', color: '#667066', fontSize: '13px' }}>
              {warehouse.city} {warehouse.address ? `— ${warehouse.address}` : ''} | Contact: {warehouse.phone || 'N/A'}
            </p>
          </div>
        </div>
      </section>

      {/* KPIs Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Unique Products"
          value={String(totalProducts)}
          trend="Distinct SKUs stored"
          icon={<Package size={20} />}
        />
        <MetricCard
          label="Total Units"
          value={totalUnits.toLocaleString()}
          trend="Aggregate on-hand count"
          icon={<Box size={20} />}
        />
        <MetricCard
          label="Inventory Value"
          value={`$${Number(inventoryValue).toLocaleString()}`}
          trend="At cost price"
          icon={<DollarSign size={20} />}
        />
        <MetricCard
          label="Bin Locations"
          value={String(locationCount)}
          trend="Storage slots configured"
          icon={<MapPin size={20} />}
        />
      </section>

      {/* Transfer Activity */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
        <div className="panel" style={{ padding: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#667066', margin: '0 0 4px' }}>Goods Receipts</p>
          <p style={{ fontSize: '24px', fontWeight: '700', color: '#066006', margin: 0 }}>{receiptsCount}</p>
        </div>
        <div className="panel" style={{ padding: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#667066', margin: '0 0 4px' }}>Transfers In</p>
          <p style={{ fontSize: '24px', fontWeight: '700', color: '#066006', margin: 0 }}>{transfersIn}</p>
        </div>
        <div className="panel" style={{ padding: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#667066', margin: '0 0 4px' }}>Transfers Out</p>
          <p style={{ fontSize: '24px', fontWeight: '700', color: '#d97706', margin: 0 }}>{transfersOut}</p>
        </div>
      </section>

      {/* Inventory Table */}
      <section className="panel">
        <div className="panel__header">
          <div>
            <p>Warehouse inventory</p>
            <h2>Products stored in this warehouse</h2>
          </div>
        </div>
        <DataTable
          columns={invColumns}
          data={inventory}
          keyExtractor={(row) => row.id}
          emptyMessage="No products currently stored in this warehouse"
        />
      </section>

      {/* Locations Table */}
      <section className="panel" style={{ marginTop: '14px' }}>
        <div className="panel__header">
          <div>
            <p>Bin locations</p>
            <h2>Storage layout configuration</h2>
          </div>
        </div>
        <DataTable
          columns={locColumns}
          data={locations}
          keyExtractor={(row) => row.id}
          emptyMessage="No bin locations configured for this warehouse"
        />
      </section>
    </div>
  );
}
