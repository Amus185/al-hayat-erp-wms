import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, ArrowLeft, Plus, Trash2, Loader2, Wrench, Info,
  AlertTriangle, CreditCard, DollarSign, Store, Truck, Package
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { ProductItemSelect, type SelectableProduct } from '../components/ProductItemSelect';
import { Modal } from '../components/Modal';
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

interface ProductPriceTier {
  id?: string;
  tier_name: string;
  price: number;
}

interface ProductGroupItem {
  id?: string;
  component_product_id: string;
  quantity: number;
  component_name?: string;
  component_sku?: string;
}

interface ProductLine {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  sellingPrice: number;
  productType?: 'STANDARD' | 'GROUPED';
  priceTiers?: ProductPriceTier[];
  groupItems?: ProductGroupItem[];
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

export function CreateSalesOrderPage() {
  const navigate = useNavigate();
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

  // Fulfillment Mode: ON HAND / PICKUP vs REQUIRES DELIVERY
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');

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

  // Selected lines
  const [lines, setLines] = useState<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    productType?: 'STANDARD' | 'GROUPED';
    priceTiers?: ProductPriceTier[];
    groupItems?: ProductGroupItem[];
    selectedTier?: string;
    fulfillmentType: 'DELIVERY' | 'PICKUP';
  }[]>([]);

  const [submittingAction, setSubmittingAction] = useState<'complete' | 'draft' | null>(null);

  useEffect(() => {
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
            sellingPrice: Number(p.selling_price) || 0,
            productType: p.product_type || 'STANDARD',
            priceTiers: p.price_tiers || [],
            groupItems: p.group_items || [],
          });
        });
        setProducts(flatList);
      } catch (err) {
        console.error('Failed to load Sales Order creation metadata', err);
      }
    }
    loadData();
  }, []);

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
    const prod = products.find((p) => p.id === pid);
    if (prod?.productType === 'GROUPED' && prod.groupItems && prod.groupItems.length > 0) {
      let minBranchSets = Infinity;
      for (const comp of prod.groupItems) {
        const compRows = inventoryStocks.filter(
          (s) => s.product_id === comp.component_product_id && s.owner_type === 'BRANCH' && s.branch_id === targetBranchId
        );
        const compAvailable = compRows.reduce(
          (acc, curr) => acc + (Number(curr.quantity_on_hand) || 0) - (Number(curr.quantity_reserved) || 0),
          0
        );
        const possibleSets = Math.floor(Math.max(0, compAvailable) / (comp.quantity || 1));
        if (possibleSets < minBranchSets) {
          minBranchSets = possibleSets;
        }
      }
      const branchQty = minBranchSets === Infinity ? 0 : Math.max(0, minBranchSets);

      return {
        branchQty,
        otherLocations: [],
        totalOtherQty: 0,
      };
    }

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

    const prod = products.find((p) => p.id === v.id);
    const initialPrice = prod?.sellingPrice ?? (v as any).sellingPrice ?? (v as any).price ?? 0;

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
      {
        productId: v.id,
        sku: v.sku,
        name: v.name,
        quantity: 1,
        unitPrice: initialPrice,
        discount: 0,
        productType: prod?.productType,
        priceTiers: prod?.priceTiers || [],
        groupItems: prod?.groupItems || [],
        selectedTier: '',
        fulfillmentType: fulfillmentType,
      },
    ]);
    addToast('success', `Added "${v.name}" to order`);
  };

  const handleFulfillmentTypeChange = (newType: 'DELIVERY' | 'PICKUP') => {
    setFulfillmentType(newType);
    setLines((prev) => prev.map((l) => ({ ...l, fulfillmentType: newType })));
    if (newType === 'PICKUP') {
      setHasInstallationFee(false);
    }
  };

  const updateLineFulfillment = (idx: number, lineType: 'DELIVERY' | 'PICKUP') => {
    setLines((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], fulfillmentType: lineType };
      return copy;
    });
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSelectTier = (idx: number, tierName: string) => {
    const line = lines[idx];
    const prod = products.find((p) => p.id === line.productId);
    let newPrice = line.unitPrice;
    if (!tierName) {
      newPrice = prod?.sellingPrice || line.unitPrice;
    } else {
      const tier = line.priceTiers?.find((t) => t.tier_name === tierName);
      if (tier) {
        newPrice = Number(tier.price) || 0;
      }
    }
    setLines((prev) => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        selectedTier: tierName,
        unitPrice: newPrice,
      };
      return copy;
    });
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
        ...(field === 'unitPrice' ? { selectedTier: 'CUSTOM' } : {}),
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

  const handleSubmit = async (completeNow: boolean) => {
    if (submittingAction) return;
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
      fulfillmentType,
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
        fulfillmentType: l.fulfillmentType,
      })),
    };

    try {
      setSubmittingAction(completeNow ? 'complete' : 'draft');
      if (!completeNow) {
        await apiPost<any>('/sales/orders', { ...payload, isCreditSale: false });
        addToast('success', 'Sales order saved as draft');
        navigate('/sales');
        return;
      }

      if (isCredit) {
        await apiPost<any>('/sales/orders', payload);
        addToast('success', `Credit sale processed. Remaining customer balance: $${remainingDebtBalance.toFixed(2)}`);
        navigate('/sales');
        return;
      }

      // Cash sale: create and complete in full
      const order = await apiPost<any>('/sales/orders', payload);
      try {
        await apiPost(`/sales/orders/${order.id}/complete`, { isCreditSale: false });
        addToast('success', 'Sale completed in full. Inventory deducted and payment recorded.');
        navigate('/sales');
      } catch (completeErr: any) {
        await apiPost(`/sales/orders/${order.id}/cancel`, {}).catch(() => {});
        throw completeErr;
      }
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit sales order');
    } finally {
      setSubmittingAction(null);
    }
  };

  const selectedCustomerObj = customers.find((c) => c.id === customerId);

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/sales')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Sales
        </button>
      </section>

      <section className="module-header">
        <div className="module-header__icon" style={{ background: '#e9f6e8', color: '#066006' }}>
          <ShoppingCart size={24} />
        </div>
        <div>
          <p>Sales Management</p>
          <h2>New Sales Order</h2>
        </div>
        <div></div>
      </section>

      <div style={{ display: 'grid', gap: '16px' }}>
        {/* Order Setup Header Card */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006', fontSize: '16px' }}>Order Details & Fulfillment</h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
            <FormField label="Retail Branch *">
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
            </FormField>

            <FormField label="Customer *">
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    options={customers.map((c) => ({
                      value: c.id,
                      label: `${c.name}${c.outstanding_balance && c.outstanding_balance > 0 ? ` (Debt: $${Number(c.outstanding_balance).toFixed(2)})` : ''}`,
                    }))}
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="Search or select customer..."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsInlineCustomerOpen(true)}
                  style={{
                    padding: '0 10px',
                    background: '#eefbee',
                    border: '1px solid #c8d8c8',
                    color: '#066006',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                  title="Add New Customer"
                >
                  <Plus size={14} /> New
                </button>
              </div>
              {selectedCustomerObj?.outstanding_balance && selectedCustomerObj.outstanding_balance > 0 ? (
                <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={12} /> Existing unpaid balance: ${Number(selectedCustomerObj.outstanding_balance).toFixed(2)}
                </div>
              ) : null}
            </FormField>

            {/* Payment Terms Selector */}
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

            {/* Fulfillment Mode Selector */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, color: '#1a331e', marginBottom: '6px', display: 'block' }}>
                Fulfillment Mode *
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleFulfillmentTypeChange('PICKUP')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: fulfillmentType === 'PICKUP' ? '2px solid #0b8f08' : '1px solid #d1e8d1',
                    background: fulfillmentType === 'PICKUP' ? '#eefbee' : '#ffffff',
                    color: fulfillmentType === 'PICKUP' ? '#066006' : '#4b5563',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  title="Customer collects directly at store/counter. No logistics delivery scheduled."
                >
                  <Store size={16} /> On Hand / Pickup
                </button>
                <button
                  type="button"
                  onClick={() => handleFulfillmentTypeChange('DELIVERY')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: fulfillmentType === 'DELIVERY' ? '2px solid #2563eb' : '1px solid #d1e8d1',
                    background: fulfillmentType === 'DELIVERY' ? '#eff6ff' : '#ffffff',
                    color: fulfillmentType === 'DELIVERY' ? '#1d4ed8' : '#4b5563',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                  title="Order requires truck logistics dispatch and delivery to customer address."
                >
                  <Truck size={16} /> Requires Delivery
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <TextareaField
              label="Order Notes"
              id="soNotes"
              placeholder="e.g. Special packing instructions, delivery notes, or customer requests..."
              value={notes}
              onChange={setNotes}
              rows={2}
            />
          </div>
        </div>

        {/* Product Catalog Picker */}
        <div className="panel" style={{ padding: '20px' }}>
          <label style={{ fontSize: '15px', fontWeight: 700, color: '#1a331e', marginBottom: '10px', display: 'block' }}>
            Add Furniture Items & Bundles
          </label>
          <ProductItemSelect
            products={products.map((p) => {
              const sInfo = branchId ? getProductStockInfo(p.id, branchId) : null;
              let hint: string | null = null;
              if (sInfo) {
                if (sInfo.branchQty > 0) {
                  if (sInfo.totalOtherQty > 0) {
                    hint = `(+${sInfo.totalOtherQty} in other locations)`;
                  }
                } else {
                  if (sInfo.otherLocations.length > 0) {
                    const locList = sInfo.otherLocations.map((l) => `${l.qty} at ${l.name}`).join(', ');
                    hint = `Available: ${locList}`;
                  } else {
                    hint = 'Out of stock in all locations';
                  }
                }
              }

              return {
                id: p.id,
                sku: p.sku,
                name: p.name,
                price: p.sellingPrice,
                category: p.productType === 'GROUPED' ? 'Bundle' : 'Furniture',
                stock: sInfo ? sInfo.branchQty : undefined,
                stockHint: hint,
                stockWarning: sInfo ? sInfo.branchQty === 0 : false,
              };
            })}
            onSelect={addLine}
            onSelectProduct={addLine}
            existingLines={lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))}
            placeholder="Search products by name, SKU, or barcode..."
          />

          {/* Table of selected lines */}
          <div style={{ marginTop: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '14px', fontWeight: 600, color: '#1a331e', margin: 0, display: 'block' }}>
                Order Line Items ({lines.length})
              </label>
              {lines.length > 0 && (
                <span style={{ fontSize: '12px', color: '#667066' }}>
                  Tip: Toggle fulfillment per line for small items taken on hand without delivery
                </span>
              )}
            </div>

            {lines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', background: '#fbfdfb', border: '1px dashed #c8d8c8', borderRadius: '8px', color: '#667066' }}>
                No items selected yet. Choose products or bundles from the catalog above.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid #d1e8d1', borderRadius: '8px' }}>
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f4fbf4', borderBottom: '1px solid #d1e8d1' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', color: '#066006' }}>Item</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', width: '135px', color: '#066006' }}>Fulfillment</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center', width: '90px', color: '#066006' }}>Quantity</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: '150px', color: '#066006' }}>Unit Price</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: '100px', color: '#066006' }}>Discount</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', width: '110px', color: '#066006' }}>Total</th>
                      <th style={{ padding: '8px 12px', width: '45px' }}></th>
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
                            {l.productType === 'GROUPED' && l.groupItems && l.groupItems.length > 0 && (
                              <div style={{ fontSize: '11px', color: '#047857', marginTop: '3px' }}>
                                Bundle: {l.groupItems.map((g) => `${g.quantity}x ${g.component_name || g.component_sku || 'Item'}`).join(', ')}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => updateLineFulfillment(idx, l.fulfillmentType === 'PICKUP' ? 'DELIVERY' : 'PICKUP')}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                padding: '4px 10px',
                                borderRadius: '16px',
                                fontSize: '11px',
                                fontWeight: 600,
                                border: '1px solid',
                                cursor: 'pointer',
                                background: l.fulfillmentType === 'PICKUP' ? '#e9f6e8' : '#eff6ff',
                                borderColor: l.fulfillmentType === 'PICKUP' ? '#86efac' : '#bfdbfe',
                                color: l.fulfillmentType === 'PICKUP' ? '#15803d' : '#1d4ed8',
                              }}
                              title="Click to toggle: On Hand / Counter Pickup vs Delivery Truck"
                            >
                              {l.fulfillmentType === 'PICKUP' ? <Store size={12} /> : <Truck size={12} />}
                              {l.fulfillmentType === 'PICKUP' ? 'On Hand' : 'Delivery'}
                            </button>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                            <input
                              type="number"
                              min="1"
                              value={l.quantity}
                              onChange={(e) => updateLine(idx, 'quantity', parseInt(e.target.value) || 1)}
                              style={{ width: '65px', padding: '4px 6px', textAlign: 'center', borderRadius: '4px', border: '1px solid #c8d8c8' }}
                            />
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <span style={{ fontSize: '12px', color: '#667066' }}>$</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.unitPrice}
                                  onChange={(e) => updateLine(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                                  style={{ width: '85px', padding: '4px 6px', textAlign: 'right', borderRadius: '4px', border: '1px solid #c8d8c8', fontWeight: 600 }}
                                />
                              </div>
                              {l.priceTiers && l.priceTiers.length > 0 && (
                                <select
                                  value={l.selectedTier || ''}
                                  onChange={(e) => handleSelectTier(idx, e.target.value)}
                                  style={{ fontSize: '11px', padding: '2px 4px', borderRadius: '4px', border: '1px solid #c8d8c8', maxWidth: '125px' }}
                                >
                                  <option value="">Base (${(products.find(p => p.id === l.productId)?.sellingPrice ?? l.unitPrice).toFixed(2)})</option>
                                  {l.priceTiers.map((t) => (
                                    <option key={t.tier_name} value={t.tier_name}>
                                      {t.tier_name} (${Number(t.price).toFixed(2)})
                                    </option>
                                  ))}
                                  {l.selectedTier === 'CUSTOM' && <option value="CUSTOM">Custom</option>}
                                </select>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={l.discount}
                              onChange={(e) => updateLine(idx, 'discount', parseFloat(e.target.value) || 0)}
                              style={{ width: '75px', padding: '4px 6px', textAlign: 'right', borderRadius: '4px', border: '1px solid #c8d8c8' }}
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

                {/* Summary Row */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid #edf1ed', padding: '16px' }}>
                  <div style={{ minWidth: '340px', display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#444' }}>
                      <span>Merchandise Subtotal</span>
                      <span>${subtotalOrder.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#b45309' }}>
                        <span>Total Discount</span>
                        <span>-${totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 600, color: '#166534', borderTop: '1px dashed #e2e8f0', paddingTop: '6px' }}>
                      <span>Merchandise Net</span>
                      <span>${merchandiseNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    {hasInstallationFee && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#d97706', fontWeight: 600, background: '#fffbeb', padding: '6px 8px', borderRadius: '6px', border: '1px solid #fde68a' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Wrench size={13} /> Installation Service Fee
                        </span>
                        <span>+${effectiveInstallFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: 800, color: '#066006', borderTop: '2px solid #bbf7d0', paddingTop: '8px', marginTop: '4px' }}>
                      <span>Customer Total Due</span>
                      <span>${grandTotalOrder.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>

                    {saleType === 'DEBT' && (
                      <div style={{ marginTop: '8px', padding: '10px', background: '#fffbeb', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#92400e', marginBottom: '6px' }}>
                          <span>Upfront Deposit Paid:</span>
                          <span style={{ fontWeight: 700 }}>${effectiveDeposit.toFixed(2)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 800, color: '#b45309' }}>
                          <span>Remaining Debt Added:</span>
                          <span>${remainingDebtBalance.toFixed(2)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Service Installation Fee Panel */}
        <div className="panel" style={{ padding: '20px', border: hasInstallationFee ? '1.5px solid #ca8a04' : '1px solid #e2e8f0', background: hasInstallationFee ? '#fefce8' : '#ffffff', transition: 'all 0.2s ease' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: hasInstallationFee ? '16px' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: hasInstallationFee ? '#fef08a' : '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: hasInstallationFee ? '#854d0e' : '#64748b'
              }}>
                <Wrench size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Service Installation Fee
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748b' }}>
                  Optional technician assembly & setup charge.
                </p>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: '#1e293b' }}>
              <input
                type="checkbox"
                checked={hasInstallationFee}
                onChange={(e) => setHasInstallationFee(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#0b8f08', cursor: 'pointer' }}
              />
              Include Installation Fee
            </label>
          </div>

          {hasInstallationFee && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', paddingTop: '12px', borderTop: '1px solid #fef08a' }}>
              <InputField
                label="Fee Amount ($) *"
                id="installFeeAmount"
                type="number"
                min="0"
                step="0.01"
                value={String(installationFee)}
                onChange={(val) => setInstallationFee(Math.max(0, Number(val) || 0))}
                placeholder="40.00"
                required
              />

              <InputField
                label="Technician / Installer Name"
                id="installerName"
                value={installerName}
                onChange={setInstallerName}
                placeholder="e.g. Jamaal Installer..."
              />

              <InputField
                label="Installation Work Notes"
                id="installerNotes"
                value={installerNotes}
                onChange={setInstallerNotes}
                placeholder="e.g. Assemble dining table on delivery"
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingBottom: '30px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/sales')} disabled={!!submittingAction}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={lines.length === 0 || !!submittingAction}
            onClick={() => handleSubmit(false)}
          >
            {submittingAction === 'draft' ? (
              <><Loader2 size={14} className="spin-icon" /> Saving Draft…</>
            ) : (
              'Save as Draft'
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={lines.length === 0 || !!submittingAction}
            onClick={() => handleSubmit(true)}
            style={{
              background: 'linear-gradient(135deg, #0b8f08, #066006)',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            {submittingAction === 'complete' ? (
              <><Loader2 size={14} className="spin-icon" /> Processing Sale…</>
            ) : (
              saleType === 'DEBT' ? 'Confirm & Record Debt Sale' : 'Complete Sale & Take Payment'
            )}
          </button>
        </div>
      </div>

      {/* Inline Customer Creation Modal */}
      <Modal isOpen={isInlineCustomerOpen} onClose={() => setIsInlineCustomerOpen(false)} title="Add New Customer" size="sm" width="sm">
        <form onSubmit={handleCreateInlineCustomer} style={{ display: 'grid', gap: '14px' }}>
          <InputField
            label="Customer Name *"
            id="custName"
            value={newCustomerForm.name}
            onChange={(val) => setNewCustomerForm((prev) => ({ ...prev, name: val }))}
            placeholder="e.g. Acme Corp, Ali Omar..."
            required
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField
              label="Phone Number"
              id="custPhone"
              value={newCustomerForm.phone}
              onChange={(val) => setNewCustomerForm((prev) => ({ ...prev, phone: val }))}
              placeholder="+252 61..."
            />
            <InputField
              label="Email Address"
              id="custEmail"
              type="email"
              value={newCustomerForm.email}
              onChange={(val) => setNewCustomerForm((prev) => ({ ...prev, email: val }))}
              placeholder="info@acme.com"
            />
          </div>
          <TextareaField
            label="Address"
            id="custAddr"
            value={newCustomerForm.address}
            onChange={(val) => setNewCustomerForm((prev) => ({ ...prev, address: val }))}
            placeholder="Hargeisa, Somaliland..."
            rows={2}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsInlineCustomerOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={savingCustomer} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {savingCustomer ? <><Loader2 size={14} className="spin-icon" /> Saving...</> : 'Save & Select'}
            </button>
          </div>
        </form>
      </Modal>

      {/* SweetAlert-Style Stock Limit Modal */}
      {stockAlert.isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '16px',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={() => setStockAlert((prev) => ({ ...prev, isOpen: false }))}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '430px',
              width: '100%',
              padding: '28px 24px',
              textAlign: 'center',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                background: '#fef3c7',
                border: '3px solid #fde68a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#d97706',
              }}
            >
              <AlertTriangle size={32} />
            </div>

            <h3 style={{ margin: '0 0 8px', fontSize: '19px', fontWeight: 800, color: '#0f172a' }}>
              Insufficient Branch Stock
            </h3>

            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#475569', lineHeight: '1.5' }}>
              Only <strong style={{ color: '#0f172a' }}>{stockAlert.maxAvailable} units</strong> of{' '}
              <strong style={{ color: '#066006' }}>{stockAlert.productName}</strong> are available at{' '}
              <strong style={{ color: '#0f172a' }}>{stockAlert.branchName}</strong>.
            </p>

            {stockAlert.otherLocations.length > 0 && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px',
                  marginBottom: '20px',
                  textAlign: 'left',
                  fontSize: '12px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: '6px' }}>
                  Available at other locations:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {stockAlert.otherLocations.map((loc, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', color: '#334155' }}>
                      <span>• {loc.name}</span>
                      <strong style={{ color: '#0f172a' }}>{loc.qty} available</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setStockAlert((prev) => ({ ...prev, isOpen: false }))}
              autoFocus
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #0b8f08, #066006)',
                borderRadius: '8px',
                boxShadow: '0 2px 8px rgba(6, 96, 6, 0.25)',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
