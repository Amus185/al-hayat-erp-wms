import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, TrendingUp, ShoppingBag, Box, DollarSign } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface BranchPerformance {
  id: string;
  code: string;
  name: string;
  order_count: string;
  invoiced_amount: string;
  units_sold: string;
}

interface BranchInventory {
  name: string;
  sku: string;
  barcode: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  available_quantity: number;
}

interface BranchInfo {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

export function BranchDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [branch, setBranch] = useState<BranchInfo | null>(null);
  const [performance, setPerformance] = useState<BranchPerformance | null>(null);
  const [inventory, setInventory] = useState<BranchInventory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBranchDetails() {
      if (!id) return;
      try {
        setLoading(true);
        const brInfo = await apiGet<BranchInfo>(`/branches/${id}`);
        setBranch(brInfo);

        const brPerf = await apiGet<BranchPerformance>(`/branches/${id}/performance`);
        setPerformance(brPerf);

        const brInv = await apiGet<BranchInventory[]>(`/branches/${id}/inventory`);
        setInventory(brInv || []);
      } catch (err: any) {
        addToast('error', err?.message || 'Failed to fetch branch analytics');
      } finally {
        setLoading(false);
      }
    }
    fetchBranchDetails();
  }, [id]);

  if (loading) {
    return <LoadingSpinner label="Fetching branch operations data..." />;
  }

  if (!branch) {
    return (
      <div className="empty-state">
        <Building2 size={48} />
        <p>Branch not found</p>
        <button type="button" className="btn btn--outline" onClick={() => navigate('/branches')}>
          Back to Branches
        </button>
      </div>
    );
  }

  const invColumns: Column<BranchInventory>[] = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'quantity_on_hand', label: 'On Hand' },
    { key: 'quantity_reserved', label: 'Reserved' },
    {
      key: 'available_quantity',
      label: 'Available',
      render: (row) => (
        <span style={{ fontWeight: '600', color: row.available_quantity <= 3 ? '#991b1b' : 'inherit' }}>
          {row.available_quantity}
        </span>
      ),
    },
  ];

  const invoicedAmount = performance?.invoiced_amount ? Number(performance.invoiced_amount) : 0;
  const orderCount = performance?.order_count ? Number(performance.order_count) : 0;
  const unitsSold = performance?.units_sold ? Number(performance.units_sold) : 0;
  const avgOrderValue = orderCount > 0 ? invoicedAmount / orderCount : 0;

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => navigate('/branches')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Branches
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
            <Building2 size={24} />
          </div>
          <div>
            <span style={{ fontSize: '11px', color: '#667066', fontWeight: '800' }}>{branch.code}</span>
            <h2 style={{ margin: '2px 0 0', fontSize: '22px' }}>{branch.name}</h2>
            <p style={{ margin: '4px 0 0', color: '#667066', fontSize: '13px' }}>
              {branch.city} {branch.address ? `— ${branch.address}` : ''} | Contact: {branch.phone || 'N/A'}
            </p>
          </div>
        </div>
      </section>

      {/* KPIs Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total Revenue"
          value={`SAR ${invoicedAmount.toLocaleString()}`}
          trend={`${orderCount} orders total`}
          icon={<DollarSign size={20} />}
        />
        <MetricCard
          label="Units Sold"
          value={unitsSold.toLocaleString()}
          trend="Physical volume sold"
          icon={<Box size={20} />}
        />
        <MetricCard
          label="Average Ticket"
          value={`SAR ${avgOrderValue.toFixed(1)}`}
          trend="Per sales ticket"
          icon={<TrendingUp size={20} />}
        />
        <MetricCard
          label="Orders Count"
          value={String(orderCount)}
          trend="Closed invoices"
          icon={<ShoppingBag size={20} />}
        />
      </section>

      {/* Local stock list */}
      <section className="panel">
        <div className="panel__header">
          <div>
            <p>Branch inventory</p>
            <h2>Local stock levels at branch site</h2>
          </div>
        </div>
        <DataTable
          columns={invColumns}
          data={inventory}
          keyExtractor={(row) => row.sku}
          emptyMessage="No stock currently allocated to this branch"
        />
      </section>
    </div>
  );
}
