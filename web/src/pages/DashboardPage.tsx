import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Boxes, CircleDollarSign, ScanLine, Truck, TrendingDown, PackageSearch } from 'lucide-react';
import { apiGet } from '../api/client';
import { MetricCard } from '../components/MetricCard';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import type { SalesFinancialSummary, PurchasingFinancialSummary } from '../types';

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
  const [salesSummary, setSalesSummary] = useState<SalesFinancialSummary | null>(null);
  const [purchasingSummary, setPurchasingSummary] = useState<PurchasingFinancialSummary | null>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        setLoading(true);
        // Fetch all dashboard data in parallel — individual failures are tolerated
        const [invValueData, lowStockData, transfersData, transactions, salesSum, purchasingSum] = await Promise.all([
          apiGet<any>('/reports/inventory-valuation').catch(() => null),
          apiGet<any[]>('/reports/low-stock').catch(() => []),
          apiGet<any[]>('/transfers').catch(() => []),
          apiGet<any[]>('/inventory/transactions').catch(() => []),
          apiGet<SalesFinancialSummary>('/sales/summary').catch(() => null),
          apiGet<PurchasingFinancialSummary>('/purchasing/summary').catch(() => null),
        ]);
        setSalesSummary(salesSum);
        setPurchasingSummary(purchasingSum);

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
    { key: 'product_name', label: 'Product Name' },
    { key: 'reorder_level', label: 'Reorder Level' },
    {
      key: 'quantity_on_hand',
      label: 'Available',
      render: (row) => (
        <span style={{ fontWeight: '600', color: Number(row.quantity_on_hand) <= 0 ? '#b91c1c' : '#b45309' }}>
          {row.quantity_on_hand}
        </span>
      ),
    },
    {
      key: 'status_risk',
      label: 'Risk Level',
      render: (row) => {
        const isCritical = row.status_risk === 'CRITICAL' || Number(row.quantity_on_hand) <= 0;
        return <StatusBadge label={isCritical ? 'Critical' : 'Low'} tone={isCritical ? 'red' : 'yellow'} />;
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

  const fmtCcy = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

  return (
    <div className="dashboard">
      {/* Inventory Metric Cards */}
      <section className="metric-grid">
        <MetricCard
          label="Total inventory value"
          value={fmtCcy(metrics.totalValue)}
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

      {/* Financial Metric Cards */}
      {(salesSummary || purchasingSummary) && (
        <section className="metric-grid">
          <MetricCard
            label="Outstanding Customer Balance"
            value={fmtCcy(salesSummary?.total_outstanding_balance ?? 0)}
            trend={`${salesSummary?.count_unpaid ?? 0} unpaid · ${salesSummary?.count_partially_paid ?? 0} partial`}
            icon={<TrendingDown size={22} />}
          />
          <MetricCard
            label="Unpaid Invoices"
            value={String(salesSummary?.count_unpaid ?? 0)}
            trend={`Balance: ${fmtCcy(salesSummary?.total_unpaid_amount ?? 0)}`}
            icon={<CircleDollarSign size={22} />}
          />
          <MetricCard
            label="Supplier Liabilities"
            value={fmtCcy(purchasingSummary?.total_outstanding_balance ?? 0)}
            trend={`${purchasingSummary?.count_unpaid ?? 0} unpaid · ${purchasingSummary?.count_partially_paid ?? 0} partial`}
            icon={<PackageSearch size={22} />}
          />
          <MetricCard
            label="Deposits Paid"
            value={fmtCcy(purchasingSummary?.deposits_total ?? 0)}
            trend="Supplier advance payments"
            icon={<Truck size={22} />}
          />
        </section>
      )}

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
