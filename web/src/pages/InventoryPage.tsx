import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, History } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { getCached, setCached } from '../api/cache';
import { DataTable, type Column } from '../components/DataTable';
import { FilterBar } from '../components/FilterBar';
import { Modal } from '../components/Modal';
import { FormField, InputField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { SearchableSelect } from '../components/SearchableSelect';
import { Tabs } from '../components/Tabs';
// Loading is handled inline by DataTable
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
}

export function InventoryPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'stock' | 'transactions'>('stock');
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Metadata for adjustment
  const [productsList, setProductsList] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // FilterBar state
  const [stockSearch, setStockSearch] = useState('');
  const [stockFilters, setStockFilters] = useState<Record<string, string>>({ locType: '', warehouse: '', branch: '' });
  const [txSearch, setTxSearch] = useState('');
  const [txFilters, setTxFilters] = useState<Record<string, string>>({ txType: '' });

  // Adjustment Modal state
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [productQuery, setProductQuery] = useState('');
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

  const loadStock = async () => {
    const cached = getCached<InventoryStock[]>('inventory:stock');
    if (cached) { setStocks(cached); setLoading(false); } else { setLoading(true); }
    try {
      const data = await apiGet<InventoryStock[]>('/inventory/stock');
      const rows = data || [];
      setCached('inventory:stock', rows);
      setStocks(rows);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch inventory stock');
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    const cached = getCached<InventoryTransaction[]>('inventory:transactions');
    if (cached) { setTransactions(cached); setLoading(false); } else { setLoading(true); }
    try {
      const data = await apiGet<InventoryTransaction[]>('/inventory/transactions');
      const rows = data || [];
      setCached('inventory:transactions', rows);
      setTransactions(rows);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch inventory transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'stock') {
      loadStock();
    } else {
      loadTransactions();
    }
  }, [activeTab]);

  // Load selection helper data on modal open
  useEffect(() => {
    async function loadHelperData() {
      try {
        const prods = await apiGet<any[]>('/products');
        const whs = await apiGet<any[]>('/warehouses');
        const brs = await apiGet<any[]>('/branches');
        
        // Map products
        const productsListMapped: any[] = [];
        prods?.forEach((p) => {
          productsListMapped.push({
            id: p.id,
            label: `${p.name} (${p.sku} - ${p.barcode})`,
          });
        });

        setProductsList(productsListMapped);
        setWarehouses(whs || []);
        setBranches(brs || []);
      } catch (err) {
        console.error('Failed to load helpers', err);
      }
    }
    if (isAdjustOpen) {
      loadHelperData();
    }
  }, [isAdjustOpen]);

  // Fetch locations when warehouse changes
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
      if (adjustForm.warehouseLocationId) {
        payload.warehouseLocationId = adjustForm.warehouseLocationId;
      }
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
        productId: '',
        direction: 'INCREASE',
        quantity: 1,
        ownerType: 'WAREHOUSE',
        warehouseId: '',
        branchId: '',
        warehouseLocationId: '',
        notes: '',
      });
      loadStock();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record adjustment');
    }
  };

  const stockColumns: Column<InventoryStock>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product' },
    {
      key: 'location',
      label: 'Location',
      render: (row) => {
        if (row.owner_type === 'WAREHOUSE') {
          return `${row.warehouse || 'Warehouse'} (${row.aisle || 'A'}-${row.rack || 'R'}-${row.shelf || 'S'}-${row.bin || 'B'})`;
        } else {
          return row.branch || 'Branch';
        }
      },
    },
    { key: 'quantity_on_hand', label: 'On Hand' },
    { key: 'quantity_reserved', label: 'Reserved' },
    {
      key: 'available',
      label: 'Available',
      render: (row) => row.quantity_on_hand - row.quantity_reserved,
    },
  ];

  const transactionColumns: Column<InventoryTransaction>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product' },
    {
      key: 'transaction_type',
      label: 'Type',
      render: (row) => (
        <span style={{ fontWeight: '700', fontSize: '12px' }}>
          {row.transaction_type}
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
    {
      key: 'user',
      label: 'User',
      render: (row) => row.user_name || 'System',
    },
    {
      key: 'quantity',
      label: 'Qty Change',
      render: (row) => {
        const isPositive = ['GOODS_RECEIPT', 'TRANSFER_IN', 'ADJUSTMENT_POSITIVE'].includes(row.transaction_type);
        const prefix = isPositive ? '+' : '-';
        const color = isPositive ? '#066006' : '#991b1b';
        return <span style={{ color, fontWeight: '700' }}>{prefix}{Math.abs(row.quantity)}</span>;
      },
    },
    { key: 'notes', label: 'Notes', render: (row) => row.notes || '—' },
    {
      key: 'created_at',
      label: 'Timestamp',
      render: (row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  const filteredStocks = stocks.filter((s) => {
    const q = stockSearch.trim().toLowerCase();
    if (q && !String(s.name || '').toLowerCase().includes(q) && !String(s.sku || '').toLowerCase().includes(q)) return false;
    if (stockFilters.locType && s.owner_type !== stockFilters.locType) return false;
    if (stockFilters.warehouse && s.warehouse_id !== stockFilters.warehouse) return false;
    if (stockFilters.branch && s.branch_id !== stockFilters.branch) return false;
    return true;
  });

  const filteredTransactions = transactions.filter((t) => {
    const q = txSearch.trim().toLowerCase();
    if (q && !String(t.name || '').toLowerCase().includes(q) && !String(t.sku || '').toLowerCase().includes(q)) return false;
    if (txFilters.txType && t.transaction_type !== txFilters.txType) return false;
    return true;
  });

  const tabItems = [
    { key: 'stock', label: 'Stock Ledger' },
    { key: 'transactions', label: 'Ledger Audit / History' },
  ];

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
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={(key: any) => setActiveTab(key)} />
      </section>

      <section className="panel">
        {activeTab === 'stock' ? (
          <>
            <FilterBar
              searchValue={stockSearch}
              onSearchChange={setStockSearch}
              searchPlaceholder="Search by product name or SKU…"
              filters={[
                {
                  key: 'locType',
                  label: 'All Location Types',
                  options: [
                    { value: 'WAREHOUSE', label: 'Warehouse' },
                    { value: 'BRANCH', label: 'Branch' },
                  ],
                },
                {
                  key: 'warehouse',
                  label: 'All Warehouses',
                  options: warehouses.map((w: any) => ({ value: w.id, label: w.name })),
                },
                {
                  key: 'branch',
                  label: 'All Branches',
                  options: branches.map((b: any) => ({ value: b.id, label: b.name })),
                },
              ]}
              filterValues={stockFilters}
              onFilterChange={(key, val) => setStockFilters(prev => ({ ...prev, [key]: val }))}
            />
            <DataTable
              columns={stockColumns}
              data={filteredStocks}
              keyExtractor={(row) => row.id}
              loading={loading}
              emptyMessage="No stock levels match your filters"
            />
          </>
        ) : (
          <>
            <FilterBar
              searchValue={txSearch}
              onSearchChange={setTxSearch}
              searchPlaceholder="Search by product name or SKU…"
              filters={[
                {
                  key: 'txType',
                  label: 'All Transaction Types',
                  options: [
                    { value: 'PURCHASE_RECEIPT', label: 'Purchase Receipt' },
                    { value: 'ADJUSTMENT_POSITIVE', label: 'Adjustment (+)' },
                    { value: 'ADJUSTMENT_NEGATIVE', label: 'Adjustment (-)' },
                    { value: 'TRANSFER_OUT', label: 'Transfer Out' },
                    { value: 'TRANSFER_IN', label: 'Transfer In' },
                    { value: 'SALE', label: 'Sale' },
                  ],
                },
              ]}
              filterValues={txFilters}
              onFilterChange={(key, val) => setTxFilters(prev => ({ ...prev, [key]: val }))}
            />
            <DataTable
              columns={transactionColumns}
              data={filteredTransactions}
              keyExtractor={(row) => row.id}
              loading={loading}
              emptyMessage="No transaction history matches your filters"
            />
          </>
        )}
      </section>

      {/* Adjust Stock Modal */}
      <Modal isOpen={isAdjustOpen} onClose={() => setIsAdjustOpen(false)} title="Post Stock Adjustment" width="md">
        <form onSubmit={handleAdjustmentSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <FormField label="Search & Select Product">
              <div style={{ position: 'relative' }}>
                <SearchInput
                  value={productQuery}
                  onChange={(val) => {
                    setProductQuery(val);
                    if (!val) setAdjustForm((prev) => ({ ...prev, productId: '' }));
                  }}
                  placeholder="Search by Product Name, SKU or scan Barcode..."
                />
                {productQuery && !adjustForm.productId && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #d9e2d9',
                      borderRadius: '8px',
                      boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                      zIndex: 30,
                      marginTop: '4px',
                      maxHeight: '220px',
                      overflowY: 'auto',
                    }}
                  >
                    {productsList
                      .filter((p) => p.label.toLowerCase().includes(productQuery.toLowerCase()))
                      .map((p) => (
                        <div
                          key={p.id}
                          onClick={() => {
                            const activeStock = stocks.find(s => s.product_id === p.id && s.quantity_on_hand > 0) || stocks.find(s => s.product_id === p.id);
                            if (activeStock) {
                              if (activeStock.owner_type === 'WAREHOUSE') {
                                setAdjustForm((prev) => ({
                                  ...prev,
                                  productId: p.id,
                                  ownerType: 'WAREHOUSE',
                                  warehouseId: activeStock.warehouse_id || '',
                                  warehouseLocationId: activeStock.warehouse_location_id || '',
                                  branchId: '',
                                }));
                              } else {
                                setAdjustForm((prev) => ({
                                  ...prev,
                                  productId: p.id,
                                  ownerType: 'BRANCH',
                                  branchId: activeStock.branch_id || '',
                                  warehouseId: '',
                                  warehouseLocationId: '',
                                }));
                              }
                            } else {
                              setAdjustForm((prev) => ({ ...prev, productId: p.id }));
                            }
                            setProductQuery(p.label);
                          }}
                          style={{
                            padding: '10px 14px',
                            borderBottom: '1px solid #edf1ed',
                            cursor: 'pointer',
                            fontSize: '13px',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#e9f6e8')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <strong>{p.label}</strong>
                        </div>
                      ))}
                    {productsList.filter((p) => p.label.toLowerCase().includes(productQuery.toLowerCase())).length === 0 && (
                      <div style={{ padding: '12px', color: '#667066', fontSize: '13px', textAlign: 'center' }}>
                        No matching product found
                      </div>
                    )}
                  </div>
                )}
              </div>
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormField label="Direction">
                <select
                  className="form-select"
                  value={adjustForm.direction}
                  onChange={(e) => setAdjustForm((prev) => ({ ...prev, direction: e.target.value as any }))}
                  required
                >
                  <option value="INCREASE">Increase (+)</option>
                  <option value="DECREASE">Decrease (-)</option>
                </select>
              </FormField>

              <InputField
                label="Quantity"
                id="quantity"
                type="number"
                min={1}
                value={adjustForm.quantity}
                onChange={(val) => setAdjustForm((prev) => ({ ...prev, quantity: Number(val) }))}
                required
              />
            </div>

            <FormField label="Location Ownership">
              <select
                className="form-select"
                value={adjustForm.ownerType}
                onChange={(e) => setAdjustForm((prev) => ({ ...prev, ownerType: e.target.value as any, warehouseId: '', branchId: '', warehouseLocationId: '' }))}
                required
              >
                <option value="WAREHOUSE">Warehouse</option>
                <option value="BRANCH">Branch</option>
              </select>
            </FormField>

            {adjustForm.ownerType === 'WAREHOUSE' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <FormField label="Select Warehouse">
                  <SearchableSelect
                    options={warehouses.map((w) => {
                      const stockItem = stocks.find(s => s.product_id === adjustForm.productId && s.warehouse_id === w.id);
                      const qtyBadge = stockItem ? ` (${stockItem.quantity_on_hand} on hand)` : '';
                      return { value: w.id, label: `${w.name}${qtyBadge}` };
                    })}
                    value={adjustForm.warehouseId}
                    onChange={(val) => setAdjustForm((prev) => ({ ...prev, warehouseId: val, warehouseLocationId: '' }))}
                    placeholder="Search Warehouse..."
                  />
                </FormField>

                <FormField label="Bin Location (Optional)">
                  <SearchableSelect
                    options={locations.map((loc) => ({ value: loc.id, label: `${loc.aisle}-${loc.rack}-${loc.shelf}-${loc.bin}` }))}
                    value={adjustForm.warehouseLocationId}
                    onChange={(val) => setAdjustForm((prev) => ({ ...prev, warehouseLocationId: val }))}
                    placeholder="Search Location..."
                  />
                </FormField>
              </div>
            ) : (
              <FormField label="Select Branch">
                <SearchableSelect
                  options={branches.map((b) => {
                    const stockItem = stocks.find(s => s.product_id === adjustForm.productId && s.branch_id === b.id);
                    const qtyBadge = stockItem ? ` (${stockItem.quantity_on_hand} on hand)` : '';
                    return { value: b.id, label: `${b.name}${qtyBadge}` };
                  })}
                  value={adjustForm.branchId}
                  onChange={(val) => setAdjustForm((prev) => ({ ...prev, branchId: val }))}
                  placeholder="Search Branch..."
                />
              </FormField>
            )}

            <InputField
              label="Adjustment Notes / Reason"
              id="notes"
              placeholder="e.g. Damaged stock, count correction..."
              value={adjustForm.notes}
              onChange={(val) => setAdjustForm((prev) => ({ ...prev, notes: val }))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsAdjustOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Post Transaction
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
