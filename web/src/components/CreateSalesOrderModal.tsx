import { useEffect, useState } from 'react';
import { ShoppingCart, Plus, Trash2, Loader2, Wrench, Info, AlertTriangle, CreditCard, DollarSign, Wallet } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from './FormField';
import { SearchInput } from './SearchInput';
import { SearchableSelect } from './SearchableSelect';
import { ProductItemSelect, type SelectableProduct } from './ProductItemSelect';
import { Modal } from './Modal';
import { useToast } from '../contexts/ToastContext';

interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  outstanding_balance?: number;
}

interface Branch {
  id: string;
  name: string;
}

interface ProductLine {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  sellingPrice: number;
}

interface StockRecord {
  product_id: string;
  owner_type: 'BRANCH' | 'WAREHOUSE';
  warehouse_id?: string | null;
  branch_id?: string | null;
  warehouse?: string | null;
  branch?: string | null;
  quantity_on_hand: number;
  quantity_reserved: number;
}

interface CreateSalesOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCreated?: (order?: any) => void;
}

export function CreateSalesOrderModal({ isOpen, onClose, onOrderCreated }: CreateSalesOrderModalProps) {
  const { addToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [inventoryStocks, setInventoryStocks] = useState<StockRecord[]>([]);

  // SweetAlert modal for stock limitation
  const [stockAlert, setStockAlert] = useState<{
    isOpen: boolean;
    productName: string;
    maxAvailable: number;
    branchName: string;
    otherLocations: { name: string; type: string; qty: number }[];
  }>({
    isOpen: false,
    productName: '',
    maxAvailable: 0,
    branchName: '',
    otherLocations: [],
  });

  // Form states
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');

  // Sale Type: CASH_SALE vs DEBT_SALE
  const [saleType, setSaleType] = useState<'CASH' | 'DEBT'>('CASH');
  const [initialDeposit, setInitialDeposit] = useState<number>(0);
  const [depositPaymentMethod, setDepositPaymentMethod] = useState<'CASH' | 'CARD' | 'BANK_TRANSFER'>('CASH');

  // Service Installation Fee states
  const [hasInstallationFee, setHasInstallationFee] = useState(false);
  const [installationFee, setInstallationFee] = useState<number>(40);
  const [installerName, setInstallerName] = useState('');
  const [installerNotes, setInstallerNotes] = useState('');

  // Inline Customer Modal state
  const [isInlineCustomerOpen, setIsInlineCustomerOpen] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
  });
  const [savingCustomer, setSavingCustomer] = useState(false);

  // Searching products
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductLine[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ productId: string; sku: string; name: string; quantity: number; unitPrice: number; discount: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    async function loadData() {
      try {
        const [custs, brs, productsList, stockList] = await Promise.all([
          apiGet<Customer[]>('/sales/customers'),
          apiGet<Branch[]>('/branches'),
          apiGet<any[]>('/products?status=active'),
          apiGet<StockRecord[]>('/inventory/stock').catch(() => []),
        ]);
        
        setCustomers(custs || []);
        setBranches(brs || []);
        setInventoryStocks(stockList || []);

        if (brs && brs.length > 0 && !branchId) {
          setBranchId(brs[0].id);
        }

        const flatList: ProductLine[] = [];
        (productsList || []).filter((p) => p.is_active !== 0).forEach((p) => {
          flatList.push({
            id: p.id,
            sku: p.sku,
            barcode: p.barcode,
            name: p.name,
            sellingPrice: p.selling_price,
          });
        });
        setProducts(flatList);
      } catch (err) {
        console.error('Failed to load Sales Order creation metadata', err);
      }
    }
    loadData();
  }, [isOpen]);

  const handleCreateInlineCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerForm.name || !newCustomerForm.name.trim()) return;
    try {
      setSavingCustomer(true);
      const created: any = await apiPost('/sales/customers', {
        name: newCustomerForm.name.trim(),
        phone: newCustomerForm.phone.trim() || null,
        email: newCustomerForm.email.trim() || null,
        address: newCustomerForm.address.trim() || null,
      });

      addToast('success', `Customer "${created.name || newCustomerForm.name}" created`);
      setIsInlineCustomerOpen(false);
      setNewCustomerForm({ name: '', phone: '', email: '', address: '' });

      const updatedCusts = await apiGet<Customer[]>('/sales/customers');
      setCustomers(updatedCusts || []);
      setCustomerId(created.id);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  const getProductStockInfo = (pid: string, targetBranchId: string) => {
    const branchRows = inventoryStocks.filter(
      (s) => s.product_id === pid && s.owner_type === 'BRANCH' && s.branch_id === targetBranchId
    );
    const branchQty = branchRows.reduce(
      (acc, curr) => acc + (Number(curr.quantity_on_hand) || 0) - (Number(curr.quantity_reserved) || 0),
      0
    );

    const otherRows = inventoryStocks.filter(
      (s) => s.product_id === pid && !(s.owner_type === 'BRANCH' && s.branch_id === targetBranchId) && (Number(s.quantity_on_hand) > 0)
    );
    const otherLocations = otherRows.map((s) => ({
      name: s.warehouse || s.branch || (s.owner_type === 'WAREHOUSE' ? 'Warehouse' : 'Branch'),
      type: s.owner_type,
      qty: (Number(s.quantity_on_hand) || 0) - (Number(s.quantity_reserved) || 0),
    }));

    const totalOtherQty = otherLocations.reduce((acc, curr) => acc + curr.qty, 0);

    return {
      branchQty: Math.max(0, branchQty),
      otherLocations,
      totalOtherQty: Math.max(0, totalOtherQty),
    };
  };

  const selectedBranchObj = branches.find((b) => b.id === branchId);
  const selectedBranchName = selectedBranchObj?.name || 'Selected Branch';

  const addLine = (v: SelectableProduct | ProductLine) => {
    if (branchId) {
      const sInfo = getProductStockInfo(v.id, branchId);
      const existing = lines.find((l) => l.productId === v.id);
      const currentQty = existing ? existing.quantity : 0;
      if (sInfo.branchQty <= 0) {
        setStockAlert({
          isOpen: true,
          productName: v.name,
          maxAvailable: 0,
          branchName: selectedBranchName,
          otherLocations: sInfo.otherLocations,
        });
        return;
      }
      if (currentQty + 1 > sInfo.branchQty) {
        setStockAlert({
          isOpen: true,
          productName: v.name,
          maxAvailable: sInfo.branchQty,
          branchName: selectedBranchName,
          otherLocations: sInfo.otherLocations,
        });
        return;
      }
    }

    const existingIndex = lines.findIndex((l) => l.productId === v.id);
    if (existingIndex !== -1) {
      setLines((prev) =>
        prev.map((l, i) =>
          i === existingIndex ? { ...l, quantity: l.quantity + 1 } : l
        )
      );
      addToast('info', `Incremented "${v.name}" quantity to ${lines[existingIndex].quantity + 1}`);
      return;
    }
    setLines((prev) => [
      ...prev,
      { productId: v.id, sku: v.sku, name: v.name, quantity: 1, unitPrice: (v as any).sellingPrice ?? (v as any).price ?? 0, discount: 0 },
    ]);
    addToast('success', `Added "${v.name}" to order`);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: 'quantity' | 'unitPrice' | 'discount', val: number) => {
    let num = isNaN(val) ? 0 : val;
    if (field === 'quantity' && branchId) {
      const line = lines[idx];
      const sInfo = getProductStockInfo(line.productId, branchId);
      if (sInfo.branchQty > 0 && num > sInfo.branchQty) {
        setStockAlert({
          isOpen: true,
          productName: line.name,
          maxAvailable: sInfo.branchQty,
          branchName: selectedBranchName,
          otherLocations: sInfo.otherLocations,
        });
        num = sInfo.branchQty;
      }
    }

    setLines((prev) => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        [field]: field === 'quantity' ? Math.max(1, num) : Math.max(0, num),
      };
      return copy;
    });
  };

  const subtotalOrder = lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
  const totalDiscount = lines.reduce((acc, curr) => acc + (curr.discount || 0), 0);
  const merchandiseNet = Math.max(0, subtotalOrder - totalDiscount);
  const effectiveInstallFee = hasInstallationFee ? Math.max(0, Number(installationFee || 0)) : 0;
  const grandTotalOrder = merchandiseNet + effectiveInstallFee;

  const effectiveDeposit = saleType === 'DEBT' ? Math.min(grandTotalOrder, Math.max(0, Number(initialDeposit || 0))) : grandTotalOrder;
  const remainingDebtBalance = Math.max(0, grandTotalOrder - effectiveDeposit);

  const handleSubmit = async (action: 'COMPLETE' | 'DRAFT') => {
    if (submitting) return;
    if (!customerId) {
      addToast('error', 'Please select a customer');
      return;
    }
    if (!branchId) {
      addToast('error', 'Please select a retail branch');
      return;
    }
    if (lines.length === 0) {
      addToast('error', 'Please add at least one line item to sales order');
      return;
    }

    const isCredit = saleType === 'DEBT';
    const payload = {
      customerId,
      branchId,
      notes: notes.trim() || undefined,
      installationFee: hasInstallationFee ? Number(installationFee || 0) : 0,
      installerName: hasInstallationFee ? installerName.trim() : null,
      installerNotes: hasInstallationFee ? installerNotes.trim() : null,
      isCreditSale: isCredit,
      initialDeposit: isCredit ? effectiveDeposit : 0,
      depositPaymentMethod,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountAmount: Number(l.discount || 0),
      })),
    };

    try {
      setSubmitting(true);
      if (action === 'DRAFT') {
        const order = await apiPost<any>('/sales/orders', { ...payload, isCreditSale: false });
        addToast('success', 'Sales order saved as draft');
        onOrderCreated?.(order);
        onClose();
        return;
      }

      // If credit sale, POST /orders directly deducts inventory and handles deposit & invoice!
      if (isCredit) {
        const order = await apiPost<any>('/sales/orders', payload);
        addToast('success', `Credit sale processed. Remaining customer balance: $${remainingDebtBalance.toFixed(2)}`);
        onOrderCreated?.(order);
        onClose();
        return;
      }

      // Cash sale: create and complete in full
      const order = await apiPost<any>('/sales/orders', payload);
      try {
        await apiPost(`/sales/orders/${order.id}/complete`, { isCreditSale: false });
        addToast('success', 'Sale completed in full. Inventory deducted and payment recorded.');
        onOrderCreated?.(order);
        onClose();
      } catch (completeErr: any) {
        await apiPost(`/sales/orders/${order.id}/cancel`, {}).catch(() => {});
        throw completeErr;
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit sales order');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCustomerObj = customers.find((c) => c.id === customerId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New Furniture Order"
      size="xl"
      id="new-order-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Branch, Customer, and Sale Type Header Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', marginBottom: '6px', display: 'block' }}>
              Customer *
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={customers.map((c) => ({
                    value: c.id,
                    label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
                  }))}
                  value={customerId}
                  onChange={(val) => setCustomerId(val)}
                  placeholder="Search customer..."
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsInlineCustomerOpen(true)}
                style={{ padding: '0 12px', fontSize: '12px' }}
                title="Create New Customer"
              >
                <Plus size={16} />
              </button>
            </div>
            {selectedCustomerObj?.outstanding_balance !== undefined && (
              <div style={{ fontSize: '12px', color: '#667066', marginTop: '4px' }}>
                Current Balance:{' '}
                <span style={{ fontWeight: 600, color: Number(selectedCustomerObj.outstanding_balance) > 0 ? '#b45309' : '#0b8f08' }}>
                  ${Number(selectedCustomerObj.outstanding_balance).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', marginBottom: '6px', display: 'block' }}>
              Dispatch Branch *
            </label>
            <select
              className="form-control"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              style={{ width: '100%', height: '38px', borderRadius: '6px', border: '1px solid #c8d8c8', padding: '0 10px' }}
            >
              <option value="">Select Retail Branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Sale Type Selector */}
          <div>
            <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', marginBottom: '6px', display: 'block' }}>
              Payment Terms *
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setSaleType('CASH')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: saleType === 'CASH' ? '2px solid #0b8f08' : '1px solid #d1e8d1',
                  background: saleType === 'CASH' ? '#eefbee' : '#ffffff',
                  color: saleType === 'CASH' ? '#066006' : '#4b5563',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <DollarSign size={16} /> Paid in Full
              </button>
              <button
                type="button"
                onClick={() => setSaleType('DEBT')}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: saleType === 'DEBT' ? '2px solid #b45309' : '1px solid #d1e8d1',
                  background: saleType === 'DEBT' ? '#fffbeb' : '#ffffff',
                  color: saleType === 'DEBT' ? '#92400e' : '#4b5563',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <CreditCard size={16} /> Credit / Debt Sale
              </button>
            </div>
          </div>
        </div>

        {/* Product Catalog Picker */}
        <div style={{ borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#1a331e', marginBottom: '8px', display: 'block' }}>
            Add Furniture Items
          </label>
          <ProductItemSelect
            products={products.map((p) => {
              const sInfo = branchId ? getProductStockInfo(p.id, branchId) : { branchQty: 0, otherLocations: [], totalOtherQty: 0 };
              return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                price: p.sellingPrice,
                category: 'Furniture',
                stockOnHand: sInfo.branchQty,
                otherLocations: sInfo.otherLocations,
              };
            })}
            onSelectProduct={(p) => addLine(p)}
          />
        </div>

        {/* Order Items Table */}
        <div>
          <label style={{ fontSize: '14px', fontWeight: 600, color: '#1a331e', marginBottom: '8px', display: 'block' }}>
            Order Line Items ({lines.length})
          </label>
          {lines.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', background: '#fbfdfb', border: '1px dashed #c8d8c8', borderRadius: '8px', color: '#667066' }}>
              No items selected yet. Choose products from the catalog above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid #d1e8d1', borderRadius: '8px' }}>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f4fbf4', borderBottom: '1px solid #d1e8d1' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: '#066006' }}>Item</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', width: '100px', color: '#066006' }}>Quantity</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: '120px', color: '#066006' }}>Unit Price</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: '110px', color: '#066006' }}>Discount</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', width: '120px', color: '#066006' }}>Total</th>
                    <th style={{ padding: '8px 12px', width: '50px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => {
                    const rowTotal = (l.quantity * l.unitPrice) - l.discount;
                    return (
                      <tr key={l.productId} style={{ borderBottom: '1px solid #edf1ed' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#1a331e' }}>{l.name}</div>
                          <div style={{ fontSize: '11px', color: '#667066' }}>SKU: {l.sku}</div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <input
                            type="number"
                            min="1"
                            value={l.quantity}
                            onChange={(e) => updateLine(idx, 'quantity', parseInt(e.target.value) || 1)}
                            style={{ width: '70px', padding: '4px 6px', textAlign: 'center', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500 }}>
                          ${l.unitPrice.toFixed(2)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.discount}
                            onChange={(e) => updateLine(idx, 'discount', parseFloat(e.target.value) || 0)}
                            style={{ width: '80px', padding: '4px 6px', textAlign: 'right', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: '#0b8f08' }}>
                          ${rowTotal.toFixed(2)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => removeLine(idx)}
                            style={{ border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', padding: '4px' }}
                            title="Remove item"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Technician Installation Fee Pass-Through */}
        <div style={{ background: '#f7fcf7', border: '1px solid #d1e8d1', borderRadius: '8px', padding: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: hasInstallationFee ? '12px' : 0 }}>
            <input
              type="checkbox"
              id="installCheck"
              checked={hasInstallationFee}
              onChange={(e) => setHasInstallationFee(e.target.checked)}
              style={{ width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <label htmlFor="installCheck" style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Wrench size={15} style={{ color: '#0b8f08' }} /> Include Furniture Assembly & Installation Fee
            </label>
          </div>

          {hasInstallationFee && (
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 1fr', gap: '12px', marginTop: '8px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#667066', display: 'block', marginBottom: '4px' }}>Fee Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={installationFee}
                  onChange={(e) => setInstallationFee(parseFloat(e.target.value) || 0)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#667066', display: 'block', marginBottom: '4px' }}>Installer / Technician Name</label>
                <input
                  type="text"
                  placeholder="e.g. Master Carpenter Hassan"
                  value={installerName}
                  onChange={(e) => setInstallerName(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#667066', display: 'block', marginBottom: '4px' }}>Assembly Notes</label>
                <input
                  type="text"
                  placeholder="e.g. 6-door wardrobe assembly on 2nd floor"
                  value={installerNotes}
                  onChange={(e) => setInstallerNotes(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Credit Sale Deposit Section (Requirement 2) */}
        {saleType === 'DEBT' && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Wallet size={18} style={{ color: '#d97706' }} />
              <div style={{ fontWeight: 600, color: '#92400e', fontSize: '14px' }}>Furniture Debt & Deposit Terms</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#78350f', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Upfront Deposit / Down Payment ($)
                </label>
                <input
                  type="number"
                  min="0"
                  max={grandTotalOrder}
                  step="0.01"
                  value={initialDeposit}
                  onChange={(e) => setInitialDeposit(Math.min(grandTotalOrder, Math.max(0, parseFloat(e.target.value) || 0)))}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fcd34d', fontWeight: 600 }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#78350f', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Deposit Payment Method
                </label>
                <select
                  value={depositPaymentMethod}
                  onChange={(e) => setDepositPaymentMethod(e.target.value as any)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '4px', border: '1px solid #fcd34d' }}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card / POS</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ fontSize: '12px', color: '#78350f' }}>Remaining Unpaid Balance:</span>
                <span style={{ fontSize: '18px', fontWeight: 700, color: remainingDebtBalance > 0 ? '#b45309' : '#0b8f08' }}>
                  ${remainingDebtBalance.toFixed(2)}
                </span>
              </div>
            </div>
            <p style={{ fontSize: '12px', color: '#92400e', margin: '10px 0 0 0' }}>
              Sold furniture quantities will be immediately deducted from the warehouse inventory upon order creation.
            </p>
          </div>
        )}

        {/* Order Notes */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', marginBottom: '4px', display: 'block' }}>
            Notes / Special Requests
          </label>
          <textarea
            rows={2}
            className="form-control"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add delivery instructions, customer preferences, or payment notes..."
            style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #c8d8c8' }}
          />
        </div>

        {/* Order Financial Summary Box */}
        <div style={{ background: '#f4fbf4', border: '1px solid #c8d8c8', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
            <span style={{ color: '#667066' }}>Items Subtotal:</span>
            <span>${subtotalOrder.toFixed(2)}</span>
          </div>
          {totalDiscount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#b45309' }}>
              <span>Total Discount:</span>
              <span>-${totalDiscount.toFixed(2)}</span>
            </div>
          )}
          {hasInstallationFee && effectiveInstallFee > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ color: '#667066' }}>Assembly & Installation Fee:</span>
              <span>+${effectiveInstallFee.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #d1e8d1', paddingTop: '10px', fontSize: '16px', fontWeight: 700, color: '#1a331e' }}>
            <span>Total Order Amount:</span>
            <span style={{ color: '#0b8f08' }}>${grandTotalOrder.toFixed(2)}</span>
          </div>

          {saleType === 'DEBT' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '14px', fontWeight: 600, color: '#b45309' }}>
              <span>Unpaid Debt Balance:</span>
              <span>${remainingDebtBalance.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleSubmit('DRAFT')}
            disabled={submitting || lines.length === 0}
          >
            Save as Draft
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit('COMPLETE')}
            disabled={submitting || lines.length === 0}
            style={{ minWidth: '160px' }}
          >
            {submitting ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 className="animate-spin" size={16} /> Processing...
              </span>
            ) : saleType === 'DEBT' ? (
              'Create Credit Sale'
            ) : (
              'Complete Sale'
            )}
          </button>
        </div>
      </div>

      {/* Inline Create Customer Modal */}
      <Modal
        isOpen={isInlineCustomerOpen}
        onClose={() => setIsInlineCustomerOpen(false)}
        title="Add New Customer"
        size="md"
        id="inline-customer-modal"
      >
        <form onSubmit={handleCreateInlineCustomer}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <InputField
              label="Full Name *"
              value={newCustomerForm.name}
              onChange={(e) => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })}
              required
            />
            <InputField
              label="Phone Number"
              value={newCustomerForm.phone}
              onChange={(e) => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })}
            />
            <InputField
              label="Email Address"
              type="email"
              value={newCustomerForm.email}
              onChange={(e) => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })}
            />
            <TextareaField
              label="Delivery / Residential Address"
              value={newCustomerForm.address}
              onChange={(e) => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })}
              rows={2}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsInlineCustomerOpen(false)}
                disabled={savingCustomer}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={savingCustomer || !newCustomerForm.name.trim()}
              >
                {savingCustomer ? 'Saving...' : 'Save Customer'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Stock alert modal */}
      {stockAlert.isOpen && (
        <Modal
          isOpen={stockAlert.isOpen}
          onClose={() => setStockAlert({ ...stockAlert, isOpen: false })}
          title="Stock Availability Alert"
          size="md"
          id="stock-alert-modal"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b45309' }}>
              <AlertTriangle size={20} />
              <span style={{ fontWeight: 600 }}>Limited Stock Available at {stockAlert.branchName}</span>
            </div>
            <p style={{ fontSize: '13px', color: '#4b5563', margin: 0 }}>
              The selected item <strong>{stockAlert.productName}</strong> has only <strong>{stockAlert.maxAvailable} units</strong> available in this branch.
            </p>
            {stockAlert.otherLocations.length > 0 && (
              <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
                  Available in other locations:
                </div>
                <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#4b5563' }}>
                  {stockAlert.otherLocations.map((loc, i) => (
                    <li key={i}>{loc.name}: <strong>{loc.qty} units</strong></li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStockAlert({ ...stockAlert, isOpen: false })}
              >
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
