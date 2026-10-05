import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Plus, Trash2, Loader2, Wrench, Info, ShieldCheck, AlertTriangle } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { SearchableSelect } from '../components/SearchableSelect';
import { ProductItemSelect, type SelectableProduct } from '../components/ProductItemSelect';
import { Modal } from '../components/Modal';
import { useToast } from '../contexts/ToastContext';

interface Customer {
  id: string;
  name: string;
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

  // Service Installation Fee states (Technician pass-through)
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

      // Reload customers list & auto select
      const updatedCusts = await apiGet<Customer[]>('/sales/customers');
      setCustomers(updatedCusts || []);
      setCustomerId(created.id);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create customer');
    } finally {
      setSavingCustomer(false);
    }
  };

  // Searching products
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductLine[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ productId: string; sku: string; name: string; quantity: number; unitPrice: number; discount: number }[]>([]);

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
  }, []);

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

  const insufficientItems = branchId
    ? lines
        .map((l) => {
          const sInfo = getProductStockInfo(l.productId, branchId);
          return {
            ...l,
            branchQty: sInfo.branchQty,
            otherLocations: sInfo.otherLocations,
            totalOtherQty: sInfo.totalOtherQty,
            isInsufficient: sInfo.branchQty < l.quantity,
          };
        })
        .filter((item) => item.isInsufficient)
    : [];

  const hasInsufficientStock = insufficientItems.length > 0;

  // Search filter
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter(
      (v) =>
        (v.sku && String(v.sku).toLowerCase().includes(q)) ||
        (v.barcode && String(v.barcode).toLowerCase().includes(q)) ||
        (v.name && String(v.name).toLowerCase().includes(q))
    );
    setSearchResults(filtered.slice(0, 5));
  }, [searchQuery, products]);

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

  const [submittingAction, setSubmittingAction] = useState<'complete' | 'draft' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingAction) return;
    const completeNow = (document.getElementById('completeNowFlag') as HTMLInputElement)?.value !== '0';
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

    const payload = {
      customerId,
      branchId,
      notes: notes.trim() || undefined,
      installationFee: hasInstallationFee ? Number(installationFee || 0) : 0,
      installerName: hasInstallationFee ? installerName.trim() : null,
      installerNotes: hasInstallationFee ? installerNotes.trim() : null,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discountAmount: Number(l.discount || 0),
      })),
    };

    try {
      setSubmittingAction(completeNow ? 'complete' : 'draft');
      const order = await apiPost<any>('/sales/orders', payload);
      if (completeNow) {
        try {
          await apiPost(`/sales/orders/${order.id}/complete`, {});
          addToast('success', 'Sale completed. Invoice issued and payment recorded.');
        } catch (err: any) {
          // If completion fails (e.g. stock validation), cancel the draft order so orphan DRAFT orders don't linger
          await apiPost(`/sales/orders/${order.id}/cancel`, {}).catch(() => {});
          throw err;
        }
      } else {
        addToast('success', 'Sales order saved as draft');
      }
      navigate('/sales');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit Sales Order');
    } finally {
      setSubmittingAction(null);
    }
  };

  const subtotalOrder = lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
  const totalDiscount = lines.reduce((acc, curr) => acc + (curr.discount || 0), 0);
  const merchandiseNet = Math.max(0, subtotalOrder - totalDiscount);
  const effectiveInstallFee = hasInstallationFee ? Math.max(0, Number(installationFee || 0)) : 0;
  const grandTotalOrder = merchandiseNet + effectiveInstallFee;

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
        <div className="module-header__icon">
          <ShoppingCart size={24} />
        </div>
        <div>
          <p>Revenue Wizard</p>
          <h2>Draft and Issue New Sales Order (SO)</h2>
        </div>
        <div></div>
      </section>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Customer & Branch Information</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <FormField label="Customer *">
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    options={customers.map((c) => ({ value: c.id, label: c.name }))}
                    value={customerId}
                    onChange={setCustomerId}
                    placeholder="Search Customer..."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsInlineCustomerOpen(true)}
                  style={{
                    padding: '0 10px',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    color: '#065f46',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                  title="Add New Customer"
                >
                  <Plus size={14} /> New
                </button>
              </div>
            </FormField>

            <FormField label="Branch *">
              <SearchableSelect
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
                value={branchId}
                onChange={setBranchId}
                placeholder="Search Branch..."
              />
            </FormField>
          </div>

          <div style={{ marginTop: '10px' }}>
            <TextareaField
              label="Order Notes"
              id="soNotes"
              placeholder="e.g. Scheduled delivery dates, special item packing instructions..."
              value={notes}
              onChange={setNotes}
            />
          </div>
        </div>

        {/* Lines selection */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Ordered Items</h3>

          {hasInsufficientStock && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                marginBottom: '14px',
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#92400e',
              }}
            >
              <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0 }} />
              <span>
                <strong>Notice:</strong> One or more items have 0 stock at {selectedBranchName}. Click <strong>Save as Draft</strong> to save without immediate stock deduction.
              </span>
            </div>
          )}

          <ProductItemSelect
            products={products.map((p) => {
              const stockInfo = branchId ? getProductStockInfo(p.id, branchId) : null;
              let hint: string | null = null;
              if (stockInfo) {
                if (stockInfo.branchQty > 0) {
                  if (stockInfo.totalOtherQty > 0) {
                    hint = `(+${stockInfo.totalOtherQty} in other locations)`;
                  }
                } else {
                  if (stockInfo.otherLocations.length > 0) {
                    const locList = stockInfo.otherLocations.map((l) => `${l.qty} at ${l.name}`).join(', ');
                    hint = `Available: ${locList}`;
                  } else {
                    hint = 'Out of stock in all locations';
                  }
                }
              }

              return {
                id: p.id,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode,
                price: p.sellingPrice,
                priceLabel: 'Price',
                stock: stockInfo ? stockInfo.branchQty : undefined,
                stockHint: hint,
                stockWarning: stockInfo ? stockInfo.branchQty === 0 : false,
              };
            })}
            onSelect={addLine}
            placeholder="Search products by name, SKU, or barcode..."
            existingLines={lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))}
          />

          {/* Table of selected lines */}
          <div style={{ marginTop: '20px' }}>
            {lines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#667066', border: '1px dashed #d9e2d9', borderRadius: '8px' }}>
                No products added to this order. Scan or search for products above.
              </div>
            ) : (
              <div>
                <table>
                  <thead>
                    <tr>
                      <th>Product ID</th>
                      <th>Product Description</th>
                      <th>Qty</th>
                      <th>Unit Price ($)</th>
                      <th>Discount ($)</th>
                      <th>Line Total ($)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, index) => {
                      const stockInfo = branchId ? getProductStockInfo(l.productId, branchId) : null;
                      const hasEnough = stockInfo ? stockInfo.branchQty >= l.quantity : true;

                      return (
                        <tr key={l.productId}>
                          <td>{l.sku}</td>
                          <td>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{l.name}</div>
                            {stockInfo && (
                              <div style={{ marginTop: '3px' }}>
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    background: stockInfo.branchQty > 0 ? '#ecfdf5' : '#fef2f2',
                                    color: stockInfo.branchQty > 0 ? '#065f46' : '#991b1b',
                                    border: stockInfo.branchQty > 0 ? '1px solid #a7f3d0' : '1px solid #fecaca',
                                  }}
                                >
                                  {stockInfo.branchQty > 0
                                    ? `${stockInfo.branchQty} in stock at ${selectedBranchName}`
                                    : `0 in stock at ${selectedBranchName}`}
                                </span>
                              </div>
                            )}
                          </td>
                        <td>
                          <input
                            type="number"
                            value={l.quantity}
                            min={1}
                            max={branchId ? Math.max(1, stockInfo?.branchQty || 1) : undefined}
                            onChange={(e) => updateLine(index, 'quantity', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '70px', minHeight: '32px', textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={l.unitPrice}
                            min={0}
                            step="0.01"
                            onChange={(e) => updateLine(index, 'unitPrice', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '100px', minHeight: '32px', textAlign: 'center', backgroundColor: '#f0f0f0' }}
                            disabled
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={l.discount}
                            min={0}
                            step="0.01"
                            onChange={(e) => updateLine(index, 'discount', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '100px', minHeight: '32px', textAlign: 'center' }}
                            placeholder="0.00"
                          />
                        </td>
                        <td>
                          <strong style={{ color: l.discount > 0 ? '#066006' : undefined }}>
                            {((l.quantity * l.unitPrice) - (l.discount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </strong>
                        </td>
                        <td>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(index)}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Summary Panel */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid #edf1ed', paddingTop: '16px', marginTop: '16px' }}>
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
                      <span>Company Sales Revenue</span>
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
                  Collected from customer and paid to technician.
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
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 1fr', gap: '14px', paddingTop: '12px', borderTop: '1px solid #fef08a' }}>
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
                placeholder="e.g. Jamaal Installer, Hassan Electrician..."
              />

              <InputField
                label="Installation Work Notes"
                id="installerNotes"
                value={installerNotes}
                onChange={setInstallerNotes}
                placeholder="e.g. Assemble dining table & 6 chairs on delivery"
              />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/sales')} disabled={!!submittingAction}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={lines.length === 0 || !!submittingAction}
            onClick={() => (document.getElementById('completeNowFlag') as HTMLInputElement).value = '0'}
          >
            {submittingAction === 'draft' ? (
              <><Loader2 size={14} className="spin-icon" /> Saving Draft…</>
            ) : (
              'Save as Draft'
            )}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={lines.length === 0 || !!submittingAction || hasInsufficientStock}
            title={hasInsufficientStock ? `Cannot complete immediately: some items have 0 stock at ${selectedBranchName}. Save as Draft or transfer stock first.` : ''}
            onClick={() => (document.getElementById('completeNowFlag') as HTMLInputElement).value = '1'}
            style={{
              background: hasInsufficientStock ? '#9ca3af' : 'linear-gradient(135deg, #0b8f08, #066006)',
              display: 'flex',
              alignItems: 'center',
              cursor: hasInsufficientStock ? 'not-allowed' : 'pointer',
              opacity: hasInsufficientStock ? 0.6 : 1,
            }}
          >
            {submittingAction === 'complete' ? (
              <><Loader2 size={14} className="spin-icon" /> Processing Sale…</>
            ) : (
              'Create & Complete'
            )}
          </button>
        </div>
      </form>

      {/* Inline Customer Creation Modal */}
      <Modal isOpen={isInlineCustomerOpen} onClose={() => setIsInlineCustomerOpen(false)} title="Add New Customer">
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
            placeholder="Mogadishu, Somalia..."
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
            {/* SweetAlert Circular Warning Badge */}
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
