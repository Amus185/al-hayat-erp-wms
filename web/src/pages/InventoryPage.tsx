import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, History } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { ListToolbar } from '../components/ListToolbar';
import { useColumnChooser } from '../components/ColumnChooser';
import { useServerList } from '../utils/serverList';
import { searchProducts } from '../utils/lookups';
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
  // joined by the transactions list
  destination_owner_type?: string | null;
  destination_warehouse?: string | null;
  destination_branch?: string | null;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  user_name?: string | null;
}

export function InventoryPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [activeTab, setActiveTab] = useState<'stock' | 'transactions'>('stock');
  // Both lists page, search, filter and sort on the server (every record reachable).
  const stockList = useServerList<InventoryStock>('/inventory/stock', {
    key: 'inventory-stock',
    filters: ['location', 'categoryId', 'status', 'state'],
    defaultSort: 'name',
    defaultDir: 'asc',
    enabled: activeTab === 'stock',
  });
  const txList = useServerList<InventoryTransaction>('/inventory/transactions', {
    key: 'inventory-movements',
    prefix: 'tx',
    filters: ['type', 'location', 'dateFrom', 'dateTo'],
    defaultSort: 'date',
    defaultDir: 'desc',
    enabled: activeTab === 'transactions',
  });
  const [txTypes, setTxTypes] = useState<string[]>([]);
  const [productResults, setProductResults] = useState<{ id: string; label: string }[]>([]);
  // where the product picked in Adjust Stock is stocked (for the "on hand" hints)
  const [productStock, setProductStock] = useState<InventoryStock[]>([]);

  // Metadata for adjustment
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);


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

  const loadStock = () => stockList.refresh();
  useEffect(() => {
    if (activeTab === 'transactions' && !txTypes.length) apiGet<string[]>('/inventory/transaction-types').then((t) => setTxTypes(t || [])).catch(() => {});
  }, [activeTab, txTypes.length]);

  // Adjust Stock: products are searched on the server as the user types.
  useEffect(() => {
    if (!isAdjustOpen || adjustForm.productId || !productQuery.trim()) { setProductResults([]); return; }
    let stale = false;
    const t = setTimeout(() => {
      searchProducts(productQuery.trim())
        .then((rows) => { if (!stale) setProductResults(rows.map((p: any) => ({ id: p.id, label: `${p.name} (${p.sku}${p.barcode ? ' - ' + p.barcode : ''})` }))); })
        .catch(() => {});
    }, 250);
    return () => { stale = true; clearTimeout(t); };
  }, [productQuery, isAdjustOpen, adjustForm.productId]);

  const [categories, setCategories] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      apiGet<any[]>('/products/categories'),
      apiGet<any[]>('/warehouses'),
      apiGet<any[]>('/branches'),
    ]).then(([cats, whs, brs]) => {
      setCategories(cats || []);
      setWarehouses(whs || []);
      setBranches(brs || []);
    }).catch(console.error);
  }, []);
        
  // Load selection helper data on modal open
  useEffect(() => {
    async function loadHelperData() {
      try {
        const whs = await apiGet<any[]>('/warehouses');
        const brs = await apiGet<any[]>('/branches');
        
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

  const stockColumns: Column<any>[] = [
    { key: 'sku', label: 'Product ID', sortable: true, sortKey: 'sku' },
    { key: 'name', label: 'Product', sortable: true, sortKey: 'name' },
    { key: 'category_name', label: 'Category', sortable: true, sortKey: 'category', render: (row) => row.category_name || 'N/A' },
    {
      key: 'location', sortable: true, sortKey: 'location',
      label: 'Location',
      render: (row) => {
        if (row.owner_type === 'WAREHOUSE') {
          const bin = [row.aisle, row.rack, row.shelf, row.bin].filter(Boolean).join('-');
          return `${row.warehouse || 'Warehouse'} ${bin ? `(${bin})` : ''}`;
        } else {
          return row.branch || 'Branch';
        }
      },
    },
    { key: 'quantity_on_hand', label: 'On Hand', sortable: true, sortKey: 'onHand' },
    { key: 'quantity_reserved', label: 'Reserved', sortable: true, sortKey: 'reserved' },
    {
      key: 'available', sortable: true, sortKey: 'available',
      label: 'Available',
      render: (row) => Number(row.quantity_on_hand || 0) - Number(row.quantity_reserved || 0),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 700,
            background: row.is_active !== 0 ? '#ecfdf5' : '#f3f4f6',
            color: row.is_active !== 0 ? '#065f46' : '#6b7280',
            border: `1px solid ${row.is_active !== 0 ? '#a7f3d0' : '#d1d5db'}`,
          }}
        >
          {row.is_active !== 0 ? '● Active' : '○ Inactive'}
        </span>
      ),
    },
  ];

  const transactionColumns: Column<InventoryTransaction>[] = [
    { key: 'sku', label: 'Product ID' },
    { key: 'name', label: 'Product', sortable: true, sortKey: 'product' },
    {
      key: 'transaction_type', sortable: true, sortKey: 'type',
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
      key: 'user', sortable: true, sortKey: 'user',
      label: 'User',
      render: (row) => row.user_name || 'System',
    },
    {
      key: 'quantity', sortable: true, sortKey: 'quantity',
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
      key: 'created_at', sortable: true, sortKey: 'date',
      label: 'Timestamp',
      render: (row) => new Date(row.created_at).toLocaleString(),
    },
  ];

  const tabItems = [
    { key: 'stock', label: 'Stock Ledger' },
    { key: 'transactions', label: 'Ledger Audit / History' },
  ];

  const { columns: shown_stockColumns, chooser: chooser_stockColumns } = useColumnChooser('inventory-stock', stockColumns, []);

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
            <ListToolbar
              id="stock-toolbar"
          columns={chooser_stockColumns}
              list={stockList}
              searchPlaceholder="Search by product name, SKU or barcode…"
              filters={[
                {
                  key: 'location',
                  label: 'All locations',
                  options: [
                    ...warehouses.map((w: any) => ({ value: `W:${w.id}`, label: `Warehouse: ${w.name}` })),
                    ...branches.map((b: any) => ({ value: `B:${b.id}`, label: `Branch: ${b.name}` })),
                  ],
                },
                { key: 'categoryId', label: 'All categories', options: categories.map((c: any) => ({ value: c.id, label: c.name })) },
                { key: 'state', label: 'Any stock level', options: [{ value: 'low', label: 'Low (at or below reorder level)' }, { value: 'reserved', label: 'Has reserved units' }] },
                { key: 'status', label: 'Active & inactive', options: [{ value: 'active', label: 'Active products' }, { value: 'inactive', label: 'Inactive products' }] },
              ]}
            />
            {stockList.totals && stockList.total > 0 && (
              <div className="list-summary">
                <span>Products: <strong>{stockList.totals.products?.toLocaleString()}</strong></span>
                <span>Units on hand: <strong>{stockList.totals.units?.toLocaleString()}</strong></span>
                <span>Reserved: <strong>{stockList.totals.reserved?.toLocaleString()}</strong></span>
                {stockList.totals.value !== undefined && <span>Value at cost: <strong>${Number(stockList.totals.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></span>}
              </div>
            )}
            <DataTable
              id="stock-table"
              columns={shown_stockColumns}
              data={stockList.items}
              server={stockList}
              keyExtractor={(row) => row.id}
              emptyMessage={stockList.activeFilters ? 'No stock matches your filters' : 'No stock recorded yet'}
            />
          </>
        ) : (
          <>
            <ListToolbar
              id="movements-toolbar"
              list={txList}
              searchPlaceholder="Search by product, SKU, barcode, reference or note…"
              dateRange
              filters={[
                { key: 'type', label: 'All movement types', options: txTypes.map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) })) },
                {
                  key: 'location',
                  label: 'All locations',
                  options: [
                    ...warehouses.map((w: any) => ({ value: `W:${w.id}`, label: `Warehouse: ${w.name}` })),
                    ...branches.map((b: any) => ({ value: `B:${b.id}`, label: `Branch: ${b.name}` })),
                  ],
                },
              ]}
            />
            <DataTable
              id="movements-table"
              columns={transactionColumns}
              data={txList.items}
              server={txList}
              keyExtractor={(row) => row.id}
              emptyMessage={txList.activeFilters ? 'No movements match your filters' : 'No stock movements yet'}
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
                    {productResults
                      .map((p) => (
                        <div
                          key={p.id}
                          onClick={async () => {
                            setAdjustForm((prev) => ({ ...prev, productId: p.id }));
                            setProductQuery(p.label);
                            // where this product is stocked (any page): preselect that location
                            const rows = await apiGet<{ items: InventoryStock[] }>('/inventory/stock', { page: 1, pageSize: 25, productId: p.id, sort: 'onHand', dir: 'desc' })
                              .then((r) => r.items).catch(() => [] as InventoryStock[]);
                            setProductStock(rows);
                            const activeStock = rows.find(s => s.quantity_on_hand > 0) || rows[0];
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
                    {productResults.length === 0 && (
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
                      const stockItem = productStock.find(s => s.product_id === adjustForm.productId && s.warehouse_id === w.id);
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
                    const stockItem = productStock.find(s => s.product_id === adjustForm.productId && s.branch_id === b.id);
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
