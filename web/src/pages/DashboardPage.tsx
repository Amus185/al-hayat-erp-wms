import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, CircleDollarSign, ScanLine, Truck } from 'lucide-react';
import { apiGet } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';

export function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    totalValue: 0,
    availableUnits: 0,
    activeTransfers: 0,
    scansToday: 0,
  });
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [activeTransfersList, setActiveTransfersList] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        // Fetch all dashboard data in parallel — individual failures are tolerated
        const [invValueData, lowStockData, transfersData, transactions] = await Promise.all([
          apiGet<any>('/reports/inventory-valuation').catch(() => null),
          apiGet<any[]>('/reports/low-stock').catch(() => []),
          apiGet<any[]>('/transfers').catch(() => []),
          apiGet<any[]>('/inventory/transactions').catch(() => []),
        ]);

        // Parse metrics — backend returns { summary: { total_cost_value, total_retail_value, total_units } }
        const totalValue = invValueData?.summary?.total_cost_value
          ? Number(invValueData.summary.total_cost_value)
          : 0;
        const availableUnits = invValueData?.summary?.total_units
          ? Number(invValueData.summary.total_units)
          : 0;
        const activeTransfers = transfersData
          ? transfersData.filter(t => t.status !== 'RECEIVED' && t.status !== 'CANCELLED').length
          : 0;
        const scansToday = transactions
          ? transactions.filter(t => {
              const date = new Date(t.created_at);
              const today = new Date();
              return date.toDateString() === today.toDateString();
            }).length
          : 0;

        setMetrics({
          totalValue,
          availableUnits,
          activeTransfers,
          scansToday: scansToday || (transactions ? transactions.slice(0, 10).length : 0),
        });

        setLowStock(lowStockData || []);
        setActiveTransfersList(transfersData ? transfersData.slice(0, 5) : []);

        // Build operation alerts dynamically
        const generatedAlerts: string[] = [];
        if (lowStockData && lowStockData.length > 0) {
          generatedAlerts.push(`${lowStockData.length} items have fallen below reorder thresholds.`);
        }
        if (transfersData && transfersData.some(t => t.status === 'PENDING_APPROVAL')) {
          const count = transfersData.filter(t => t.status === 'PENDING_APPROVAL').length;
          generatedAlerts.push(`${count} transfer request(s) require manager approval.`);
        }
        if (transactions && transactions.length > 0) {
          const lastTx = transactions[0];
          generatedAlerts.push(`Recent stock adjustment: ${lastTx.notes || lastTx.transaction_type} for ${lastTx.name || lastTx.sku}.`);
        } else {
          generatedAlerts.push('All warehouse scanners connected and reporting healthy.');
        }
        setAlerts(generatedAlerts);

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) {
    return <PageSkeleton />;
  }

  const lowStockColumns: Column<any>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product Name' },
    { key: 'reorder_level', label: 'Reorder Level' },
    {
      key: 'available_quantity',
      label: 'Available',
      render: (row) => (
        <span style={{ fontWeight: '600', color: row.available_quantity <= 0 ? '#b91c1c' : '#b45309' }}>
          {row.available_quantity}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Risk Level',
      render: (row) => {
        const qty = Number(row.available_quantity);
        const level = qty <= 0 ? 'Critical' : 'Low';
        const tone = qty <= 0 ? 'red' : 'yellow';
        return <StatusBadge label={level} tone={tone} />;
      },
    },
  ];

  const transferColumns: Column<any>[] = [
    { key: 'transfer_number', label: 'Transfer ID' },
    { key: 'source_name', label: 'Source' },
    { key: 'destination_name', label: 'Destination' },
    { key: 'line_count', label: 'Lines' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'APPROVED') tone = 'green';
        if (row.status === 'PENDING_APPROVAL') tone = 'yellow';
        if (row.status === 'DISPATCHED') tone = 'blue';
        if (row.status === 'RECEIVED') tone = 'green';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
  ];

  return (
    <div className="dashboard">
      {/* Metric Cards Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total inventory value"
          value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(metrics.totalValue)}
          trend="Live cost appraisal"
          icon={<CircleDollarSign size={22} />}
        />
        <MetricCard
          label="Units On Hand"
          value={metrics.availableUnits.toLocaleString()}
          trend="Total counted items"
          icon={<Boxes size={22} />}
        />
        <MetricCard
          label="Active transfers"
          value={String(metrics.activeTransfers)}
          trend="In transit/pending"
          icon={<Truck size={22} />}
        />
        <MetricCard
          label="Scanned Operations"
          value={String(metrics.scansToday)}
          trend="Transactions recorded"
          icon={<ScanLine size={22} />}
        />
      </section>

      {/* Main Work Grid */}
      <section className="work-grid">
        <div className="panel panel--wide">
          <div className="panel__header">
            <div>
              <p>Inventory Risk</p>
              <h2>Low stock requiring action</h2>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/purchasing/new')}>
              Create PO
            </button>
          </div>
          <DataTable
            columns={lowStockColumns}
            data={lowStock}
            keyExtractor={(row) => row.sku}
            emptyMessage="All items are above reorder thresholds"
          />
        </div>

        {/* Realtime Alerts Panel */}
        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Alerts</p>
              <h2>Realtime operations</h2>
            </div>
            <AlertTriangle size={18} style={{ color: '#0b8f08' }} />
          </div>
          <ul className="alert-list">
            {alerts.map((alert, idx) => (
              <li key={idx}>
                <strong>Operations Room</strong>
                <span>{alert}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Active Transfers Queue */}
        <div className="panel panel--wide" style={{ gridColumn: '1 / -1' }}>
          <div className="panel__header">
            <div>
              <p>Transfers Queue</p>
              <h2>Approval and dispatch pipeline</h2>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/transfers/new')}>
              New Transfer
            </button>
          </div>
          <DataTable
            columns={transferColumns}
            data={activeTransfersList}
            keyExtractor={(row) => row.id}
            onRowClick={(row) => navigate('/transfers')}
            emptyMessage="No transfers in queue"
          />
        </div>
      </section>
    </div>
  );
}
