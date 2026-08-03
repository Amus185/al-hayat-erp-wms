import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { SearchableSelect } from '../components/SearchableSelect';
import { useToast } from '../contexts/ToastContext';

interface Supplier {
  id: string;
  name: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface ProductSearchItem {
  id: string;
  sku: string;
  barcode: string;
  productName: string;
  costPrice: number;
}

export function CreatePOPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [productsList, setProductsList] = useState<ProductSearchItem[]>([]);

  // Form states
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  // Searching variants
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchItem[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ productId: string; sku: string; name: string; quantity: number; unitCost: number; discount: number }[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const sups = await apiGet<Supplier[]>('/purchasing/suppliers');
        const whs = await apiGet<Warehouse[]>('/warehouses');
        const products = await apiGet<any[]>('/products');
        
        setSuppliers(sups || []);
        setWarehouses(whs || []);

        // Build product search list
        const flatList: ProductSearchItem[] = [];
        products?.forEach((p) => {
          flatList.push({
            id: p.id,
            sku: p.sku,
            barcode: p.barcode || '',
            productName: p.name,
            costPrice: p.cost_price,
          });
        });
        setProductsList(flatList);
      } catch (err) {
        console.error('Failed to load PO creation metadata', err);
      }
    }
    loadData();
  }, []);

  // Search filter
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }
    const filtered = productsList.filter(
      (v) =>
        v.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.barcode.includes(searchQuery) ||
        v.productName.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSearchResults(filtered.slice(0, 5));
  }, [searchQuery, productsList]);

  const addLine = (v: ProductSearchItem) => {
    if (lines.some((l) => l.productId === v.id)) {
      addToast('warning', 'Product already added to the order');
      return;
    }
    setLines((prev) => [
      ...prev,
      { productId: v.id, sku: v.sku, name: v.productName, quantity: 1, unitCost: v.costPrice || 0, discount: 0 },
    ]);
    setSearchQuery('');
  };

  const removeLine = (productId: string) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  };

  const updateLine = (productId: string, field: 'quantity' | 'unitCost' | 'discount', value: number) => {
    const num = isNaN(value) ? 0 : value;
    setLines((prev) => prev.map((l) => l.productId === productId ? { 
        ...l, 
        [field]: field === 'quantity' ? Math.max(1, num) : Math.max(0, num) 
    } : l));
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!supplierId) {
      addToast('error', 'Please select a supplier');
      return;
    }
    if (!warehouseId) {
      addToast('error', 'Please select a target receiving warehouse');
      return;
    }
    if (lines.length === 0) {
      addToast('error', 'Please add at least one line item to purchase order');
      return;
    }

    const payload = {
      supplierId,
      warehouseId,
      expectedDate: expectedDate || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        discountAmount: Number(l.discount || 0),
      })),
    };

    try {
      setSubmitting(true);
      await apiPost('/purchasing/orders', payload);
      addToast('success', 'Purchase order created and submitted successfully');
      navigate('/purchasing');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit Purchase Order');
    } finally {
      setSubmitting(false);
    }
  };

  const subtotalPO = lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitCost), 0);
  const totalDiscount = lines.reduce((acc, curr) => acc + (curr.discount || 0), 0);
  const grandTotalPO = subtotalPO - totalDiscount;

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/purchasing')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Procurement
        </button>
      </section>

      <section className="module-header">
        <div className="module-header__icon">
          <PackagePlus size={24} />
        </div>
        <div>
          <p>Procurement Wizard</p>
          <h2>Draft and Submit New Purchase Order (PO)</h2>
        </div>
        <div></div>
      </section>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Supplier & Header Information</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <FormField label="Supplier *">
              <SearchableSelect
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Search Supplier..."
              />
            </FormField>

            <FormField label="Receiving Warehouse *">
              <SearchableSelect
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                value={warehouseId}
                onChange={setWarehouseId}
                placeholder="Search Warehouse..."
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '14px', marginTop: '10px' }}>
            <InputField
              label="Expected Delivery"
              id="expectedDate"
              type="date"
              value={expectedDate}
              onChange={setExpectedDate}
            />
            <TextareaField
              label="Procurement Notes"
              id="poNotes"
              placeholder="e.g. Special import instructions, payment details..."
              value={notes}
              onChange={setNotes}
            />
          </div>
        </div>

        {/* Lines selection */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Line Items</h3>

          <div style={{ position: 'relative' }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search / Scan variant to add to PO..."
            />
            {/* Search autocomplete dropdown */}
            {searchResults.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                right: '0',
                background: '#fff',
                border: '1px solid #d9e2d9',
                borderRadius: '8px',
                boxShadow: '0 6px 20px rgba(0,0,0,0.1)',
                zIndex: '10',
                marginTop: '4px',
                overflow: 'hidden'
              }}>
                {searchResults.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => addLine(v)}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid #edf1ed',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#e9f6e8')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <strong>{v.productName}</strong> <span style={{ color: '#667066' }}>({v.sku} - {v.barcode})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Table of selected lines */}
          <div style={{ marginTop: '20px' }}>
            {lines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#667066', border: '1px dashed #d9e2d9', borderRadius: '8px' }}>
                No variants added to this PO. Scan or search for variants above.
              </div>
            ) : (
              <div>
                <table>
                  <thead>
                    <tr>
                      <th>Product ID</th>
                      <th>Product Description</th>
                      <th>Qty</th>
                      <th>Unit Cost ($)</th>
                      <th>Discount ($)</th>
                      <th>Line Total ($)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.productId}>
                        <td>{l.sku}</td>
                        <td>{l.name}</td>
                        <td>
                          <input
                            type="number"
                            value={l.quantity}
                            min={1}
                            onChange={(e) => updateLine(l.productId, 'quantity', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '70px', minHeight: '32px', textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={l.unitCost}
                            min={0}
                            step="0.01"
                            onChange={(e) => updateLine(l.productId, 'unitCost', Number(e.target.value))}
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
                            onChange={(e) => updateLine(l.productId, 'discount', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '100px', minHeight: '32px', textAlign: 'center' }}
                            placeholder="0.00"
                          />
                        </td>
                        <td>
                          <strong style={{ color: l.discount > 0 ? '#066006' : undefined }}>
                            {((l.quantity * l.unitCost) - (l.discount || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </strong>
                        </td>
                        <td>
                          <button type="button" className="btn btn-secondary" style={{ color: '#ef4444' }} onClick={() => removeLine(l.productId)}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Summary Panel */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '2px solid #edf1ed', paddingTop: '16px', marginTop: '16px' }}>
                  <div style={{ minWidth: '300px', display: 'grid', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#444' }}>
                      <span>Subtotal</span>
                      <span>${subtotalPO.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#b45309' }}>
                      <span>Total Discount</span>
                      <span>-${totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '17px', fontWeight: 700, color: '#066006', borderTop: '1px solid #d1e8d1', paddingTop: '8px', marginTop: '4px' }}>
                      <span>Grand Total</span>
                      <span>${grandTotalPO.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/purchasing')} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={lines.length === 0 || submitting} style={{ display: 'flex', alignItems: 'center' }}>
            {submitting ? (
              <><Loader2 size={14} className="spin-icon" /> Submitting Order…</>
            ) : (
              'Submit Purchase Order'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
