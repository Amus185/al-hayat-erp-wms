import { useEffect, useState } from 'react';
import { BarChart3, AlertTriangle, Building, CircleDollarSign, TrendingUp } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { MetricCard } from '../components/MetricCard';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

export function ReportsPage() {
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState('low-stock');
  const [loading, setLoading] = useState(true);

  // Report states
  const [lowStockData, setLowStockData] = useState<any[]>([]);
  const [branchPerfData, setBranchPerfData] = useState<any[]>([]);
  const [invValue, setInvValue] = useState<any>(null);
  const [profitVal, setProfitVal] = useState<any>(null);
  const [salesTrend, setSalesTrend] = useState<any[]>([]);

  useEffect(() => {
    async function loadReportData() {
      try {
        setLoading(true);
        if (activeTab === 'low-stock') {
          const res = await apiGet<any[]>('/reports/low-stock');
          setLowStockData(res || []);
        } else if (activeTab === 'branch-perf') {
          const res = await apiGet<any[]>('/reports/branches');
          setBranchPerfData(res || []);
        } else if (activeTab === 'inv-value') {
          const res = await apiGet<any>('/reports/inventory-value');
          setInvValue(res);
        } else if (activeTab === 'profit') {
          const prof = await apiGet<any>('/reports/profit');
          const trend = await apiGet<any[]>('/reports/sales');
          setProfitVal(prof);
          setSalesTrend(trend || []);
        }
      } catch (err: any) {
        addToast('error', err?.message || 'Failed to fetch report statistics');
      } finally {
        setLoading(false);
      }
    }
    loadReportData();
  }, [activeTab]);

  const tabsConfig = [
    { key: 'low-stock', label: 'Low Stock Risk' },
    { key: 'branch-perf', label: 'Branch Performance' },
    { key: 'inv-value', label: 'Inventory Asset Valuation' },
    { key: 'profit', label: 'Sales & Profit Analysis' },
  ];

  // Low Stock Table Columns
  const lowStockColumns: Column<any>[] = [
    { key: 'sku', label: 'Product ID' },
    {
      key: 'product_name',
      label: 'Product',
      render: (row) => row.product_name || row.name || '—',
    },
    {
      key: 'location',
      label: 'Location',
      render: (row) => row.warehouse_name ? `${row.warehouse_name} (WH)` : row.branch_name ? `${row.branch_name} (Branch)` : row.owner_type || '—',
    },
    { key: 'reorder_level', label: 'Reorder Threshold' },
    {
      key: 'quantity_on_hand',
      label: 'Quantity Available',
      render: (row) => {
        const qty = row.quantity_on_hand ?? row.available_quantity ?? 0;
        return <span style={{ fontWeight: '700', color: '#991b1b' }}>{qty}</span>;
      },
    },
    {
      key: 'risk',
      label: 'Risk',
      render: (row) => {
        const qty = row.quantity_on_hand ?? row.available_quantity ?? 0;
        const isCritical = qty <= 0;
        return (
          <span style={{ fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isCritical ? '🔴 Critical' : '🟡 Low'}
          </span>
        );
      },
    },
  ];

  // Branch Performance Table Columns
  const branchPerfColumns: Column<any>[] = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Branch Name' },
    { key: 'orders', label: 'Total Sales Orders' },
    {
      key: 'revenue',
      label: 'Invoiced Revenue',
      render: (row) => `$${Number(row.revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
    },
  ];

  // Sales trend / profit Columns
  const salesTrendColumns: Column<any>[] = [
    {
      key: 'day',
      label: 'Day / Period',
      render: (row) => new Date(row.day).toLocaleDateString(),
    },
    { key: 'invoices', label: 'Invoices Issued' },
    {
      key: 'revenue',
      label: 'Gross Turnover',
      render: (row) => `$${Number(row.revenue).toLocaleString()}`,
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <BarChart3 size={24} />
        </div>
        <div className="module-header__info">
          <p>Management</p>
          <h2>Analytical overview of low stock, branch operations, values, and profitability</h2>
        </div>
        <div></div>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabsConfig} activeTab={activeTab} onTabChange={setActiveTab} />
      </section>

      {loading ? (
        <LoadingSpinner label="Compiling report data tables..." />
      ) : (
        <section className="panel" style={{ padding: '24px' }}>
          {/* Subview 1: Low Stock Risk */}
          {activeTab === 'low-stock' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <AlertTriangle size={20} style={{ color: '#b45309' }} />
                <h3 style={{ margin: '0' }}>Products Below Reorder Target</h3>
              </div>
              <DataTable
                columns={lowStockColumns}
                data={lowStockData}
                keyExtractor={(row) => row.sku}
                emptyMessage="No variants are currently below their reorder limits"
              />
            </div>
          )}

          {/* Subview 2: Branch Performance */}
          {activeTab === 'branch-perf' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <Building size={20} style={{ color: '#0b8f08' }} />
                <h3 style={{ margin: '0' }}>Branch Revenue Leaderboard</h3>
              </div>
              <DataTable
                columns={branchPerfColumns}
                data={branchPerfData}
                keyExtractor={(row) => row.code}
                emptyMessage="No branch performance data recorded"
              />
            </div>
          )}

          {/* Subview 3: Inventory Asset Valuation */}
          {activeTab === 'inv-value' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <CircleDollarSign size={20} style={{ color: '#0b8f08' }} />
                <h3 style={{ margin: '0' }}>Balance Sheet Asset Value</h3>
              </div>

              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Total Estimated Cost Value"
                  value={`$${Number(invValue?.inventory_value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  trend="Calculated based on actual variant cost"
                  icon={<CircleDollarSign size={22} />}
                />
                <MetricCard
                  label="Total Units On Hand"
                  value={Number(invValue?.units_on_hand || 0).toLocaleString()}
                  trend="Aggregate warehouse & branch count"
                  icon={<BarChart3 size={22} />}
                />
              </div>

              <div style={{ background: '#f7f9f7', padding: '16px', borderRadius: '8px', border: '1px solid #e1e8e1' }}>
                <h4 style={{ margin: '0 0 10px', color: '#066006' }}>Fulfillment and Appraisal Rules</h4>
                <p style={{ margin: '0', fontSize: '13px', color: '#667066', lineHeight: '1.5' }}>
                  Inventory values are calculated using current quantities on hand multiplied by each product's recorded cost price. The balance includes stock held across warehouses and branches based on live inventory records.
                </p>
              </div>
            </div>
          )}

          {/* Subview 4: Sales & Profit Analysis */}
          {activeTab === 'profit' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
                <TrendingUp size={20} style={{ color: '#0b8f08' }} />
                <h3 style={{ margin: '0' }}>Profitability Margin & Sales Trend</h3>
              </div>

              <div className="metric-grid" style={{ marginBottom: '24px' }}>
                <MetricCard
                  label="Gross profit amount"
                  value={`$${Number(profitVal?.gross_profit || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  trend="Sum of all invoiced profit lines"
                  icon={<TrendingUp size={22} />}
                />
              </div>

              <h4 style={{ margin: '0 0 12px', color: '#066006' }}>Daily Sales Turnover (Last 30 Days)</h4>
              <DataTable
                columns={salesTrendColumns}
                data={salesTrend}
                keyExtractor={(row) => row.day}
                emptyMessage="No sales invoices posted in this range"
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
