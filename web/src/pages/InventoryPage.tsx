import { useEffect, useState } from 'react';
import { ClipboardCheck, Plus, History } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { FormField, InputField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
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

  // Adjustment Modal state
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
    try {
      setLoading(true);
      const data = await apiGet<InventoryStock[]>('/inventory/stock');
      setStocks(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch inventory stock');
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const data = await apiGet<InventoryTransaction[]>('/inventory/transactions');
      setTransactions(data || []);
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
          <DataTable
            columns={stockColumns}
            data={stocks}
            keyExtractor={(row) => row.id}
            loading={loading}
            emptyMessage="No stock levels recorded"
          />
        ) : (
          <DataTable
            columns={transactionColumns}
            data={transactions}
            keyExtractor={(row) => row.id}
            loading={loading}
            emptyMessage="No transactions ledger history"
          />
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
                            setAdjustForm((prev) => ({ ...prev, productId: p.id }));
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
                  <select
                    className="form-select"
                    value={adjustForm.warehouseId}
                    onChange={(e) => setAdjustForm((prev) => ({ ...prev, warehouseId: e.target.value, warehouseLocationId: '' }))}
                    required
                  >
                    <option value="">Select Warehouse...</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Bin Location (Optional)">
                  <select
                    className="form-select"
                    value={adjustForm.warehouseLocationId}
                    onChange={(e) => setAdjustForm((prev) => ({ ...prev, warehouseLocationId: e.target.value }))}
                  >
                    <option value="">Select Location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.aisle}-{loc.rack}-{loc.shelf}-{loc.bin}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>
            ) : (
              <FormField label="Select Branch">
                <select
                  className="form-select"
                  value={adjustForm.branchId}
                  onChange={(e) => setAdjustForm((prev) => ({ ...prev, branchId: e.target.value }))}
                  required
                >
                  <option value="">Select Branch...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
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
