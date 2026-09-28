import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Warehouse,
  Box,
  MapPin,
  Package,
  DollarSign,
  Layers,
  Phone,
  Plus,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Truck,
  ExternalLink,
  Barcode,
  Loader2,
  SlidersHorizontal,
  ChevronRight,
  Tag,
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { PageSkeleton } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface WarehouseInfo {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active?: boolean | number;
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
  cost_price?: number;
  selling_price?: number;
}

interface WarehouseLocation {
  id: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  barcode: string | null;
}

function fmt(n: number | string | null | undefined): string {
  const num = Number(n || 0);
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function WarehouseDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [warehouse, setWarehouse] = useState<WarehouseInfo | null>(null);
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [inventory, setInventory] = useState<WarehouseInventory[]>([]);
  const [locations, setLocations] = useState<WarehouseLocation[]>([]);
  const [loading, setLoading] = useState(true);

  // Active view tab
  const [activeTab, setActiveTab] = useState<'INVENTORY' | 'LOCATIONS' | 'LOGISTICS'>('INVENTORY');

  // Search & Filters for inventory
  const [invSearch, setInvSearch] = useState('');
  const [invFilter, setInvFilter] = useState<'ALL' | 'HEALTHY' | 'LOW' | 'OUT'>('ALL');

  // Search for locations
  const [locSearch, setLocSearch] = useState('');

  // Modal: Add Bin Location
  const [isAddBinOpen, setIsAddBinOpen] = useState(false);
  const [binForm, setBinForm] = useState({
    aisle: '',
    rack: '',
    shelf: '',
    bin: '',
    barcode: '',
  });
  const [submittingBin, setSubmittingBin] = useState(false);

  const fetchData = async () => {
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
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleAddBin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || submittingBin) return;
    try {
      setSubmittingBin(true);
      const generatedBarcode =
        binForm.barcode.trim() ||
        `LOC-${warehouse?.code || 'WH'}-${binForm.aisle.trim()}-${binForm.rack.trim()}-${binForm.shelf.trim()}-${binForm.bin.trim()}`.toUpperCase();

      await apiPost(`/warehouses/${id}/locations`, {
        ...binForm,
        barcode: generatedBarcode,
      });
      addToast('success', 'Storage location bin created successfully');
      setIsAddBinOpen(false);
      setBinForm({ aisle: '', rack: '', shelf: '', bin: '', barcode: '' });
      fetchData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create storage bin');
    } finally {
      setSubmittingBin(false);
    }
  };

  if (loading) return <PageSkeleton />;

  if (!warehouse) {
    return (
      <div className="module-page" style={{ textAlign: 'center', padding: '60px 20px' }}>
        <Warehouse size={48} style={{ margin: '0 auto 16px', opacity: 0.35, color: '#066006' }} />
        <h3 style={{ margin: '0 0 6px', color: '#1e293b' }}>Warehouse Facility Not Found</h3>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '14px' }}>
          The requested warehouse could not be located in the database.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/warehouses')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Warehouses Network
        </button>
      </div>
    );
  }

  // Filtered inventory
  const filteredInventory = inventory.filter((item) => {
    const q = invSearch.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      item.sku.toLowerCase().includes(q) ||
      (item.barcode && item.barcode.toLowerCase().includes(q));

    const qty = Number(item.quantity_on_hand || 0);
    let matchesFilter = true;
    if (invFilter === 'HEALTHY') matchesFilter = qty > 5;
    else if (invFilter === 'LOW') matchesFilter = qty > 0 && qty <= 5;
    else if (invFilter === 'OUT') matchesFilter = qty === 0;

    return matchesSearch && matchesFilter;
  });

  // Filtered locations
  const filteredLocations = locations.filter((loc) => {
    const q = locSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      loc.aisle.toLowerCase().includes(q) ||
      loc.rack.toLowerCase().includes(q) ||
      loc.shelf.toLowerCase().includes(q) ||
      loc.bin.toLowerCase().includes(q) ||
      (loc.barcode && loc.barcode.toLowerCase().includes(q))
    );
  });

  const totalProducts = summary?.total_products || inventory.length || 0;
  const totalUnits = summary?.total_units || inventory.reduce((acc, i) => acc + Number(i.quantity_on_hand || 0), 0);
  const inventoryValue =
    summary?.inventory_value ||
    inventory.reduce((acc, i) => acc + (Number(i.quantity_on_hand || 0) * (Number(i.cost_price) || 0)), 0);
  const locationCount = summary?.location_count || locations.length || 0;
  const receiptsCount = summary?.receipts_count || 0;
  const transfersIn = summary?.transfers_in || 0;
  const transfersOut = summary?.transfers_out || 0;

  const invColumns: Column<WarehouseInventory>[] = [
    {
      key: 'name',
      label: 'Product & SKU',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.name}</div>
          <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginTop: '1px' }}>
            SKU: {row.sku}
          </div>
        </div>
      ),
    },
    {
      key: 'barcode',
      label: 'Barcode',
      render: (row) =>
        row.barcode ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'monospace',
              fontSize: '11px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '2px 8px',
              borderRadius: '6px',
              color: '#334155',
            }}
          >
            <Barcode size={13} style={{ color: '#64748b' }} /> {row.barcode}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
    {
      key: 'cost_price',
      label: 'Unit Cost',
      render: (row) => (
        <span style={{ color: '#475569' }}>
          {row.cost_price != null ? fmt(row.cost_price) : '—'}
        </span>
      ),
    },
    {
      key: 'quantity_on_hand',
      label: 'Stock Level',
      render: (row) => {
        const qty = Number(row.quantity_on_hand || 0);
        let badgeTone: 'green' | 'yellow' | 'red' = 'green';
        let badgeText = `${qty} in stock`;
        if (qty === 0) {
          badgeTone = 'red';
          badgeText = 'Out of stock';
        } else if (qty <= 5) {
          badgeTone = 'yellow';
          badgeText = `${qty} low stock`;
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 800, fontSize: '15px', color: badgeTone === 'green' ? '#166534' : badgeTone === 'yellow' ? '#b45309' : '#dc2626' }}>
              {qty}
            </span>
            <StatusBadge label={badgeText} tone={badgeTone} />
          </div>
        );
      },
    },
    {
      key: 'valuation',
      label: 'Total Valuation',
      render: (row) => {
        const qty = Number(row.quantity_on_hand || 0);
        const cost = Number(row.cost_price || 0);
        return (
          <span style={{ fontWeight: 700, color: '#0f172a' }}>
            {fmt(qty * cost)}
          </span>
        );
      },
    },
    {
      key: 'actions',
      label: 'Quick Transfer',
      render: (row) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/transfers', { state: { sourceWarehouseId: warehouse.id, productId: row.product_id } })}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 10px' }}
        >
          Transfer <ArrowUpRight size={13} />
        </button>
      ),
    },
  ];

  const locColumns: Column<WarehouseLocation>[] = [
    {
      key: 'aisle',
      label: 'Aisle',
      render: (row) => (
        <span style={{ fontWeight: 700, color: '#0f172a' }}>
          {row.aisle}
        </span>
      ),
    },
    {
      key: 'rack',
      label: 'Rack',
      render: (row) => (
        <span style={{ fontWeight: 600, color: '#334155' }}>
          {row.rack}
        </span>
      ),
    },
    {
      key: 'shelf',
      label: 'Shelf',
      render: (row) => <span style={{ color: '#475569' }}>{row.shelf}</span>,
    },
    {
      key: 'bin',
      label: 'Bin Slot',
      render: (row) => (
        <span style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 8px', borderRadius: '4px', fontWeight: 700, fontFamily: 'monospace', fontSize: '12px' }}>
          {row.bin}
        </span>
      ),
    },
    {
      key: 'barcode',
      label: 'Location Barcode',
      render: (row) =>
        row.barcode ? (
          <span style={{ fontFamily: 'monospace', fontSize: '12px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', color: '#0f172a', fontWeight: 600 }}>
            {row.barcode}
          </span>
        ) : (
          <span style={{ color: '#94a3b8' }}>—</span>
        ),
    },
  ];

  return (
    <div className="module-page">
      {/* Breadcrumb Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#64748b', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => navigate('/warehouses')}
          style={{ background: 'none', border: 'none', padding: 0, color: '#066006', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          <Warehouse size={14} /> Warehouses Network
        </button>
        <ChevronRight size={14} />
        <span style={{ color: '#0f172a', fontWeight: 600 }}>{warehouse.name}</span>
      </div>

      {/* Facility Hero Banner */}
      <section
        className="panel"
        style={{
          padding: '24px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f7fbf7 100%)',
          border: '1px solid #dcf0dc',
          boxShadow: '0 4px 16px rgba(6, 96, 6, 0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
          {/* Facility Identity */}
          <div style={{ display: 'flex', gap: '18px', alignItems: 'center' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #e9f6e8, #c8e6c9)',
                color: '#066006',
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 2px 8px rgba(11, 143, 8, 0.15)',
                flexShrink: 0,
              }}
            >
              <Warehouse size={28} />
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontWeight: 800,
                    fontSize: '12px',
                    background: '#f0fdf4',
                    color: '#166534',
                    border: '1px solid #bbf7d0',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    letterSpacing: '0.5px',
                  }}
                >
                  {warehouse.code}
                </span>
                <StatusBadge label="ACTIVE" tone="green" />
                <span style={{ fontSize: '13px', color: '#64748b' }}>• Fulfillment Hub</span>
              </div>

              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.5px' }}>
                {warehouse.name}
              </h1>

              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap', fontSize: '13px', color: '#475569' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <MapPin size={14} style={{ color: '#0b8f08' }} />
                  <strong>{warehouse.city}</strong>
                  {warehouse.address ? ` — ${warehouse.address}` : ''}
                </span>
                {warehouse.phone && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#64748b' }}>
                    <Phone size={13} /> {warehouse.phone}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {hasPermission('manage_inventory') && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsAddBinOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Plus size={15} /> Add Storage Bin
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/transfers', { state: { sourceWarehouseId: warehouse.id } })}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Truck size={15} /> New Transfer
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/purchasing')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Package size={15} /> Receive PO Items
            </button>
          </div>
        </div>
      </section>

      {/* Facility KPIs Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total On-Hand Units"
          value={totalUnits.toLocaleString()}
          trend="Physical units in depot"
          icon={<Box size={20} />}
        />
        <MetricCard
          label="Inventory Valuation"
          value={fmt(inventoryValue)}
          trend="Valued at product cost"
          icon={<DollarSign size={20} />}
        />
        <MetricCard
          label="Catalog SKUs Stored"
          value={String(totalProducts)}
          trend="Unique catalog products"
          icon={<Package size={20} />}
        />
        <MetricCard
          label="Storage Bin Slots"
          value={String(locationCount)}
          trend="Aisles, racks & shelves"
          icon={<Layers size={20} />}
        />
      </section>

      {/* Operational Logistics Activity Bar */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '14px',
        }}
      >
        <div
          className="panel"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: 'linear-gradient(135deg, #ffffff, #f0fdf4)',
            border: '1px solid #dcfce7',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: '#dcfce7',
              color: '#166534',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <ArrowDownLeft size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Goods Receipts
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#066006', marginTop: '2px' }}>
              {receiptsCount}
            </div>
            <div style={{ fontSize: '11px', color: '#16a34a' }}>Completed shipments received</div>
          </div>
        </div>

        <div
          className="panel"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: 'linear-gradient(135deg, #ffffff, #eff6ff)',
            border: '1px solid #dbeafe',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: '#dbeafe',
              color: '#1e40af',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <ArrowDownLeft size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Transfers Inbound
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#1e40af', marginTop: '2px' }}>
              {transfersIn}
            </div>
            <div style={{ fontSize: '11px', color: '#2563eb' }}>Internal stock received</div>
          </div>
        </div>

        <div
          className="panel"
          style={{
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            background: 'linear-gradient(135deg, #ffffff, #fef3c7)',
            border: '1px solid #fde68a',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: '#fef3c7',
              color: '#92400e',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <ArrowUpRight size={20} />
          </div>
          <div>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Transfers Outbound
            </div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', marginTop: '2px' }}>
              {transfersOut}
            </div>
            <div style={{ fontSize: '11px', color: '#d97706' }}>Stock dispatched to branches</div>
          </div>
        </div>
      </section>

      {/* Main Content Tabs */}
      <section className="panel" style={{ padding: '0', overflow: 'hidden' }}>
        {/* Navigation Tabs Header */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #e2e8e2',
            background: '#fafcfa',
            padding: '4px 16px 0',
            gap: '8px',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('INVENTORY')}
            style={{
              padding: '12px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'INVENTORY' ? '3px solid #066006' : '3px solid transparent',
              color: activeTab === 'INVENTORY' ? '#066006' : '#64748b',
              fontWeight: activeTab === 'INVENTORY' ? 700 : 500,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Box size={16} /> Physical Stock ({inventory.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('LOCATIONS')}
            style={{
              padding: '12px 18px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'LOCATIONS' ? '3px solid #066006' : '3px solid transparent',
              color: activeTab === 'LOCATIONS' ? '#066006' : '#64748b',
              fontWeight: activeTab === 'LOCATIONS' ? 700 : 500,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Layers size={16} /> Storage Layout & Bins ({locations.length})
          </button>
        </div>

        {/* Tab 1: Inventory Stock Table */}
        {activeTab === 'INVENTORY' && (
          <div style={{ padding: '20px' }}>
            {/* Filter and Search Sub-bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: '220px' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Filter stock by SKU, product name, or barcode..."
                  value={invSearch}
                  onChange={(e) => setInvSearch(e.target.value)}
                  style={{ paddingLeft: '36px', height: '36px', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>Stock Status:</span>
                <select
                  className="form-select"
                  value={invFilter}
                  onChange={(e) => setInvFilter(e.target.value as any)}
                  style={{ height: '36px', fontSize: '13px', minWidth: '130px' }}
                >
                  <option value="ALL">All Items ({inventory.length})</option>
                  <option value="HEALTHY">In Stock (&gt; 5)</option>
                  <option value="LOW">Low Stock (1 - 5)</option>
                  <option value="OUT">Out of Stock (0)</option>
                </select>
              </div>
            </div>

            <DataTable
              columns={invColumns}
              data={filteredInventory}
              keyExtractor={(row) => row.id}
              emptyMessage={
                invSearch || invFilter !== 'ALL'
                  ? 'No inventory items match the current search filter.'
                  : 'No inventory stock recorded in this warehouse yet. Receive a PO or transfer stock into this facility.'
              }
            />
          </div>
        )}

        {/* Tab 2: Storage Layout & Bins */}
        {activeTab === 'LOCATIONS' && (
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: '220px' }}>
                <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by aisle, rack, shelf, or bin barcode..."
                  value={locSearch}
                  onChange={(e) => setLocSearch(e.target.value)}
                  style={{ paddingLeft: '36px', height: '36px', fontSize: '13px' }}
                />
              </div>

              {hasPermission('manage_inventory') && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setIsAddBinOpen(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={15} /> Add Storage Bin
                </button>
              )}
            </div>

            <DataTable
              columns={locColumns}
              data={filteredLocations}
              keyExtractor={(row) => row.id}
              emptyMessage={
                locSearch
                  ? 'No storage bins match the current filter.'
                  : 'No storage bin locations configured for this warehouse yet. Click "Add Storage Bin" to set up aisles and racks.'
              }
            />
          </div>
        )}
      </section>

      {/* Add Storage Bin Modal */}
      <Modal
        isOpen={isAddBinOpen}
        onClose={() => setIsAddBinOpen(false)}
        title={`Add Storage Bin — ${warehouse.name}`}
      >
        <form onSubmit={handleAddBin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#64748b' }}>
            Define an organized storage location for inventory put-away and picking.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField label="Aisle *">
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. A01 or Central"
                value={binForm.aisle}
                onChange={(e) => setBinForm({ ...binForm, aisle: e.target.value })}
              />
            </FormField>

            <FormField label="Rack *">
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. R01 or North"
                value={binForm.rack}
                onChange={(e) => setBinForm({ ...binForm, rack: e.target.value })}
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <FormField label="Shelf *">
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. S01 or Floor"
                value={binForm.shelf}
                onChange={(e) => setBinForm({ ...binForm, shelf: e.target.value })}
              />
            </FormField>

            <FormField label="Bin *">
              <input
                type="text"
                className="form-input"
                required
                placeholder="e.g. B01 or Slot A"
                value={binForm.bin}
                onChange={(e) => setBinForm({ ...binForm, bin: e.target.value })}
              />
            </FormField>
          </div>

          <FormField label="Location Barcode (Optional — auto-generated if blank)">
            <input
              type="text"
              className="form-input"
              placeholder={`e.g. LOC-${warehouse.code}-A01-R01-S01-B01`}
              value={binForm.barcode}
              onChange={(e) => setBinForm({ ...binForm, barcode: e.target.value })}
            />
          </FormField>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsAddBinOpen(false)}
              disabled={submittingBin}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submittingBin}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {submittingBin ? (
                <>
                  <Loader2 size={14} className="spin-icon" /> Creating…
                </>
              ) : (
                'Create Storage Bin'
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
