import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, Download, Search, Filter, X } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField, InputField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { Tabs } from '../components/Tabs';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface InventoryStock {
  id: string;
  product_id: string;
  owner_type: 'WAREHOUSE' | 'BRANCH';
  warehouse_id: string | null;
  branch_id: string | null;
  warehouse_location_id: string | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
  name?: string;
  sku?: string;
  barcode?: string;
  warehouse?: string;
  branch?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
}

interface InventoryTransaction {
  id: string;
  product_id: string;
  transaction_type: string;
  quantity: number;
  notes: string | null;
  created_by: string;
  created_at: string;
  name?: string;
  sku?: string;
  barcode?: string;
  user_name?: string;
  destination_owner_type?: string;
  destination_warehouse?: string;
  destination_branch?: string;
  aisle?: string;
  rack?: string;
  shelf?: string;
  bin?: string;
}

export function InventoryPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'stock' | 'transactions'>('stock');
  const [loading, setLoading] = useState(true);

  // Stock State
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLocation, setStockLocation] = useState('');
  const [stockCategory, setStockCategory] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [stockSortBy, setStockSortBy] = useState('p.name');
  const [stockSortDir, setStockSortDir] = useState<'asc' | 'desc'>('asc');
  const [stockPage, setStockPage] = useState(1);
  const [stockTotal, setStockTotal] = useState(0);
  const [stockTotalPages, setStockTotalPages] = useState(1);

  // Transactions State
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [txnStartDate, setTxnStartDate] = useState('');
  const [txnEndDate, setTxnEndDate] = useState('');
  const [txnUser, setTxnUser] = useState('');
  const [txnAction, setTxnAction] = useState('');
  const [txnProduct, setTxnProduct] = useState('');
  const [txnLocation, setTxnLocation] = useState('');
  const [txnSortBy, setTxnSortBy] = useState('t.created_at');
  const [txnSortDir, setTxnSortDir] = useState<'asc' | 'desc'>('desc');
  const [txnPage, setTxnPage] = useState(1);
  const [txnTotal, setTxnTotal] = useState(0);
  const [txnTotalPages, setTxnTotalPages] = useState(1);

  // Filter Data
  const [productsList, setProductsList] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);

  // Adjust Stock Modal
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    productId: '',
    direction: 'INCREASE' as 'INCREASE' | 'DECREASE',
    quantity: 1,
    ownerType: 'WAREHOUSE' as 'WAREHOUSE' | 'BRANCH',
    warehouseId: '',
    branchId: '',
    warehouseLocationId: '',
    notes: '',
  });

  // Init filter data
  useEffect(() => {
    async function init() {
      try {
        const [cats, usrs, whs, brs, prods] = await Promise.all([
          apiGet<any[]>('/products/categories').catch(() => []),
          apiGet<any[]>('/users').catch(() => []),
          apiGet<any[]>('/warehouses').catch(() => []),
          apiGet<any[]>('/branches').catch(() => []),
          apiGet<any[]>('/products').catch(() => [])
        ]);
        setCategories(cats || []);
        setUsers(usrs || []);
        setWarehouses(whs || []);
        setBranches(brs || []);
        setProductsList(prods?.map((p: any) => ({ value: p.id, label: `${p.name} (${p.sku})` })) || []);
      } catch (err) {
        console.error('Init failed', err);
      }
    }
    init();
  }, []);

  const loadStock = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(stockPage),
        limit: '50',
        sort_by: stockSortBy,
        sort_dir: stockSortDir.toUpperCase(),
      });
      if (stockSearch) params.append('search', stockSearch);
      if (stockLocation) params.append('location_id', stockLocation);
      if (stockCategory) params.append('category_id', stockCategory);
      if (stockStatus) params.append('status', stockStatus);

      const res = await apiGet<any>(`/inventory/stock?${params.toString()}`);
      setStocks(res.data || []);
      setStockTotal(res.total || 0);
      setStockTotalPages(res.totalPages || 1);
    } catch (err: any) {
      addToast('error', 'Failed to load stock ledger');
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(txnPage),
        limit: '50',
        sort_by: txnSortBy,
        sort_dir: txnSortDir.toUpperCase(),
      });
      if (txnStartDate) params.append('start_date', txnStartDate);
      if (txnEndDate) params.append('end_date', txnEndDate);
      if (txnUser) params.append('user_id', txnUser);
      if (txnAction) params.append('action', txnAction);
      if (txnProduct) params.append('product_id', txnProduct);
      if (txnLocation) params.append('location_id', txnLocation);

      const res = await apiGet<any>(`/inventory/transactions?${params.toString()}`);
      setTransactions(res.data || []);
      setTxnTotal(res.total || 0);
      setTxnTotalPages(res.totalPages || 1);
    } catch (err: any) {
      addToast('error', 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  // Debounce stock fetch
  useEffect(() => {
    if (activeTab === 'stock') {
      const timeout = setTimeout(loadStock, 300);
      return () => clearTimeout(timeout);
    }
  }, [activeTab, stockPage, stockSortBy, stockSortDir, stockSearch, stockLocation, stockCategory, stockStatus]);

  // Debounce transactions fetch
  useEffect(() => {
    if (activeTab === 'transactions') {
      const timeout = setTimeout(loadTransactions, 300);
      return () => clearTimeout(timeout);
    }
  }, [activeTab, txnPage, txnSortBy, txnSortDir, txnStartDate, txnEndDate, txnUser, txnAction, txnProduct, txnLocation]);

  const handleExportStock = () => {
    const params = new URLSearchParams();
    if (stockSearch) params.append('search', stockSearch);
    if (stockLocation) params.append('location_id', stockLocation);
    if (stockCategory) params.append('category_id', stockCategory);
    if (stockStatus) params.append('status', stockStatus);
    params.append('sort_by', stockSortBy);
    params.append('sort_dir', stockSortDir.toUpperCase());
    params.append('export', 'csv');
    // We can assume the API is mounted at /api/v1 (or fallback to import.meta.env)
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/inventory/stock?${params.toString()}`;
  };

  const handleExportTransactions = () => {
    const params = new URLSearchParams();
    if (txnStartDate) params.append('start_date', txnStartDate);
    if (txnEndDate) params.append('end_date', txnEndDate);
    if (txnUser) params.append('user_id', txnUser);
    if (txnAction) params.append('action', txnAction);
    if (txnProduct) params.append('product_id', txnProduct);
    if (txnLocation) params.append('location_id', txnLocation);
    params.append('sort_by', txnSortBy);
    params.append('sort_dir', txnSortDir.toUpperCase());
    params.append('export', 'csv');
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/inventory/transactions?${params.toString()}`;
  };

  useEffect(() => {
    async function fetchLocations() {
      if (adjustForm.warehouseId) {
        try {
          const locs = await apiGet<any[]>(`/warehouses/${adjustForm.warehouseId}/locations`);
          setLocations(locs || []);
        } catch {
          setLocations([]);
        }
      } else {
        setLocations([]);
      }
    }
    fetchLocations();
  }, [adjustForm.warehouseId]);

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustForm.productId || !adjustForm.quantity) {
      addToast('error', 'Product and Quantity are required');
      return;
    }
    const payload: any = {
      productId: adjustForm.productId,
      direction: adjustForm.direction,
      quantity: Number(adjustForm.quantity),
      notes: adjustForm.notes,
    };
    if (adjustForm.ownerType === 'WAREHOUSE') {
      if (!adjustForm.warehouseId) {
        addToast('error', 'Warehouse is required');
        return;
      }
      payload.warehouseId = adjustForm.warehouseId;
      if (adjustForm.warehouseLocationId) payload.warehouseLocationId = adjustForm.warehouseLocationId;
    } else {
      if (!adjustForm.branchId) {
        addToast('error', 'Branch is required');
        return;
      }
      payload.branchId = adjustForm.branchId;
    }

    try {
      await apiPost('/inventory/adjust', payload);
      addToast('success', 'Stock adjustment recorded');
      setIsAdjustOpen(false);
      setAdjustForm({
        productId: '', direction: 'INCREASE', quantity: 1, ownerType: 'WAREHOUSE',
        warehouseId: '', branchId: '', warehouseLocationId: '', notes: '',
      });
      loadStock();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record adjustment');
    }
  };

  const stockColumns: Column<InventoryStock>[] = [
    { key: 'sku', label: 'Product ID', sortable: true },
    { key: 'name', label: 'Product', sortable: true },
    {
      key: 'location',
      label: 'Location',
      render: (row) => {
        if (row.owner_type === 'WAREHOUSE') {
          return `${row.warehouse || 'Warehouse'} ${row.aisle ? `(${row.aisle}-${row.rack}-${row.shelf}-${row.bin})` : ''}`;
        } else {
          return row.branch || 'Branch';
        }
      },
    },
    { key: 'quantity_on_hand', label: 'On Hand', sortable: true },
    { key: 'quantity_reserved', label: 'Reserved', sortable: true },
    {
      key: 'available',
      label: 'Available',
      render: (row) => <strong style={{ color: (row.quantity_on_hand - row.quantity_reserved) <= 0 ? '#b91c1c' : 'inherit' }}>{row.quantity_on_hand - row.quantity_reserved}</strong>,
    },
  ];

  const transactionColumns: Column<InventoryTransaction>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product', sortable: true },
    {
      key: 'transaction_type',
      label: 'Type',
      render: (row) => (
        <span style={{ fontWeight: '700', fontSize: '12px', color: '#4b5563' }}>
          {row.transaction_type.replace(/_/g, ' ')}
        </span>
      ),
    },
    {
      key: 'location',
      label: 'Location',
      render: (row) => {
        if (row.destination_owner_type === 'WAREHOUSE') {
          return `${row.destination_warehouse || 'Warehouse'} ${row.aisle ? `(${row.aisle}-${row.rack}-${row.shelf}-${row.bin})` : ''}`;
        } else {
          return row.destination_branch || 'Branch';
        }
      },
    },
    { key: 'user', label: 'User', render: (row) => row.user_name || 'System' },
    {
      key: 'quantity',
      label: 'Qty Change',
      sortable: true,
      render: (row) => {
        const isPositive = ['GOODS_RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_POSITIVE'].includes(row.transaction_type);
        const prefix = isPositive ? '+' : '-';
        const color = isPositive ? '#059669' : '#dc2626';
        return <span style={{ color, fontWeight: '700' }}>{prefix}{Math.abs(row.quantity)}</span>;
      },
    },
    { key: 'notes', label: 'Notes', render: (row) => row.notes || '—' },
    { key: 'created_at', label: 'Timestamp', sortable: true, render: (row) => new Date(row.created_at).toLocaleString() },
  ];

  const handleStockSort = (key: string) => {
    let dbKey = key;
    if (key === 'sku') dbKey = 'p.sku';
    if (key === 'name') dbKey = 'p.name';
    if (key === 'quantity_on_hand') dbKey = 's.quantity_on_hand';
    if (key === 'quantity_reserved') dbKey = 's.quantity_reserved';
    
    if (stockSortBy === dbKey) {
      setStockSortDir(stockSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setStockSortBy(dbKey);
      setStockSortDir('asc');
    }
  };

  const handleTxnSort = (key: string) => {
    let dbKey = key;
    if (key === 'name') dbKey = 'p.name';
    if (key === 'quantity') dbKey = 't.quantity';
    if (key === 'created_at') dbKey = 't.created_at';
    
    if (txnSortBy === dbKey) {
      setTxnSortDir(txnSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setTxnSortBy(dbKey);
      setTxnSortDir('desc');
    }
  };

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <ClipboardCheck size={24} />
        </div>
        <div className="module-header__info">
          <p>Stock Ledger</p>
          <h2>Realtime stock levels, adjustments, counts, and history</h2>
        </div>
        {hasPermission('manage_inventory') && (
          <button type="button" className="btn btn-primary" onClick={() => setIsAdjustOpen(true)}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Adjust Stock
          </button>
        )}
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={[
          { key: 'stock', label: 'Stock Ledger' },
          { key: 'transactions', label: 'Ledger Audit / History' }
        ]} activeTab={activeTab} onTabChange={(k: any) => setActiveTab(k)} />
      </section>

      {/* FILTER BAR - STOCK */}
      {activeTab === 'stock' && (
        <section className="panel" style={{ marginBottom: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px' }}>
          <div style={{ flex: '1 1 250px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Search Product</label>
            <div style={{ position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '9px', color: '#9ca3af' }} />
              <input type="text" className="form-input" style={{ paddingLeft: '34px' }} placeholder="Product ID, Name, or Barcode" value={stockSearch} onChange={e => setStockSearch(e.target.value)} />
            </div>
          </div>
          <div style={{ width: '180px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Location</label>
            <select className="form-select" value={stockLocation} onChange={e => setStockLocation(e.target.value)}>
              <option value="">All Locations</option>
              <optgroup label="Warehouses">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
              <optgroup label="Branches">{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
            </select>
          </div>
          <div style={{ width: '180px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Category</label>
            <select className="form-select" value={stockCategory} onChange={e => setStockCategory(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Stock Status</label>
            <select className="form-select" value={stockStatus} onChange={e => setStockStatus(e.target.value)}>
              <option value="">All</option>
              <option value="IN_STOCK">In Stock</option>
              <option value="LOW_STOCK">Low Stock</option>
              <option value="OUT_OF_STOCK">Out of Stock</option>
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => { setStockSearch(''); setStockLocation(''); setStockCategory(''); setStockStatus(''); setStockPage(1); }}>
            <X size={16} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExportStock}>
            <Download size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> CSV
          </button>
        </section>
      )}

      {/* FILTER BAR - TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <section className="panel" style={{ marginBottom: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ width: '140px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Start Date</label>
              <input type="date" className="form-input" value={txnStartDate} onChange={e => setTxnStartDate(e.target.value)} />
            </div>
            <div style={{ width: '140px' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>End Date</label>
              <input type="date" className="form-input" value={txnEndDate} onChange={e => setTxnEndDate(e.target.value)} />
            </div>
          </div>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>User</label>
            <select className="form-select" value={txnUser} onChange={e => setTxnUser(e.target.value)}>
              <option value="">All Users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Product</label>
            <SearchableSelect options={productsList} value={txnProduct} onChange={setTxnProduct} placeholder="Any Product" />
          </div>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Action</label>
            <select className="form-select" value={txnAction} onChange={e => setTxnAction(e.target.value)}>
              <option value="">All Actions</option>
              <option value="GOODS_RECEIPT">Goods Receipt</option>
              <option value="TRANSFER_OUT">Transfer Out</option>
              <option value="TRANSFER_IN">Transfer In</option>
              <option value="ADJUSTMENT_POSITIVE">Adjustment (+)</option>
              <option value="ADJUSTMENT_NEGATIVE">Adjustment (-)</option>
              <option value="ORDER_FULFILLMENT">Order Fulfillment</option>
            </select>
          </div>
          <div style={{ width: '160px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Location</label>
            <select className="form-select" value={txnLocation} onChange={e => setTxnLocation(e.target.value)}>
              <option value="">All Locations</option>
              <optgroup label="Warehouses">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</optgroup>
              <optgroup label="Branches">{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</optgroup>
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => { setTxnStartDate(''); setTxnEndDate(''); setTxnUser(''); setTxnAction(''); setTxnProduct(''); setTxnLocation(''); setTxnPage(1); }}>
            <X size={16} />
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExportTransactions}>
            <Download size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> CSV
          </button>
        </section>
      )}

      <section className="panel" style={{ padding: 0 }}>
        {activeTab === 'stock' ? (
          <DataTable
            columns={stockColumns}
            data={stocks}
            keyExtractor={(row) => row.id}
            loading={loading}
            emptyMessage="No stock levels found matching your filters"
            sortBy={stockSortBy === 'p.name' ? 'name' : stockSortBy === 'p.sku' ? 'sku' : stockSortBy === 's.quantity_on_hand' ? 'quantity_on_hand' : 'quantity_reserved'}
            sortOrder={stockSortDir}
            onSort={handleStockSort}
            pagination={{ page: stockPage, total: stockTotal, limit: 50, totalPages: stockTotalPages, onPageChange: setStockPage }}
          />
        ) : (
          <DataTable
            columns={transactionColumns}
            data={transactions}
            keyExtractor={(row) => row.id}
            loading={loading}
            emptyMessage="No transactions found matching your filters"
            sortBy={txnSortBy === 't.created_at' ? 'created_at' : txnSortBy === 'p.name' ? 'name' : 'quantity'}
            sortOrder={txnSortDir}
            onSort={handleTxnSort}
            pagination={{ page: txnPage, total: txnTotal, limit: 50, totalPages: txnTotalPages, onPageChange: setTxnPage }}
          />
        )}
      </section>

      {/* Adjust Stock Modal */}
      <Modal isOpen={isAdjustOpen} onClose={() => setIsAdjustOpen(false)} title="Post Stock Adjustment" width="md">
        <form onSubmit={handleAdjustmentSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <FormField label="Select Product">
              <SearchableSelect
                value={adjustForm.productId}
                onChange={(val) => setAdjustForm((prev) => ({ ...prev, productId: val }))}
                options={productsList}
                placeholder="Select a product..."
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormField label="Direction">
                <select className="form-select" value={adjustForm.direction} onChange={(e) => setAdjustForm((prev) => ({ ...prev, direction: e.target.value as any }))} required>
                  <option value="INCREASE">Increase (+)</option>
                  <option value="DECREASE">Decrease (-)</option>
                </select>
              </FormField>
              <InputField label="Quantity" id="quantity" type="number" min={1} value={adjustForm.quantity} onChange={(val) => setAdjustForm((prev) => ({ ...prev, quantity: Number(val) }))} required />
            </div>

            <FormField label="Location Ownership">
              <select className="form-select" value={adjustForm.ownerType} onChange={(e) => setAdjustForm((prev) => ({ ...prev, ownerType: e.target.value as any, warehouseId: '', branchId: '', warehouseLocationId: '' }))} required>
                <option value="WAREHOUSE">Warehouse</option>
                <option value="BRANCH">Branch</option>
              </select>
            </FormField>

            {adjustForm.ownerType === 'WAREHOUSE' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <FormField label="Select Warehouse">
                  <SearchableSelect
                    value={adjustForm.warehouseId}
                    onChange={(val) => setAdjustForm((prev) => ({ ...prev, warehouseId: val, warehouseLocationId: '' }))}
                    options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                    placeholder="Select Warehouse..."
                  />
                </FormField>
                <FormField label="Bin Location (Optional)">
                  <SearchableSelect
                    value={adjustForm.warehouseLocationId}
                    onChange={(val) => setAdjustForm((prev) => ({ ...prev, warehouseLocationId: val }))}
                    options={locations.map(loc => ({ value: loc.id, label: `${loc.aisle}-${loc.rack}-${loc.shelf}-${loc.bin}` }))}
                    placeholder="Select Location..."
                  />
                </FormField>
              </div>
            ) : (
              <FormField label="Select Branch">
                <SearchableSelect
                  value={adjustForm.branchId}
                  onChange={(val) => setAdjustForm((prev) => ({ ...prev, branchId: val }))}
                  options={branches.map(b => ({ value: b.id, label: b.name }))}
                  placeholder="Select Branch..."
                />
              </FormField>
            )}

            <FormField label="Adjustment Notes">
              <textarea className="form-input" style={{ minHeight: '80px', resize: 'vertical' }} value={adjustForm.notes} onChange={(e) => setAdjustForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Reason for adjustment..." />
            </FormField>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsAdjustOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Submit Adjustment</button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
