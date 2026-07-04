import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { useToast } from '../contexts/ToastContext';

interface Supplier {
  id: string;
  name: string;
}

interface Warehouse {
  id: string;
  name: string;
}

interface ProductVariant {
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
  const [variants, setVariants] = useState<ProductVariant[]>([]);

  // Form states
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  // Searching variants
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductVariant[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ variantId: string; sku: string; name: string; quantity: number; unitCost: number }[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const sups = await apiGet<Supplier[]>('/suppliers');
        const whs = await apiGet<Warehouse[]>('/warehouses');
        const products = await apiGet<any[]>('/products');
        
        setSuppliers(sups || []);
        setWarehouses(whs || []);

        // Build flat variant list
        const flatList: ProductVariant[] = [];
        products?.forEach((p) => {
          p.variants?.forEach((v: any) => {
            flatList.push({
              id: v.id,
              sku: v.sku,
              barcode: v.barcode,
              productName: p.name,
              costPrice: p.cost_price,
            });
          });
        });
        setVariants(flatList);
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
    const filtered = variants.filter(
      (v) =>
        v.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.barcode.includes(searchQuery) ||
        v.productName.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSearchResults(filtered.slice(0, 5));
  }, [searchQuery, variants]);

  const addLine = (v: ProductVariant) => {
    if (lines.some((l) => l.variantId === v.id)) {
      addToast('warning', 'Variant already added to purchase order lines');
      return;
    }
    setLines((prev) => [
      ...prev,
      { variantId: v.id, sku: v.sku, name: v.productName, quantity: 1, unitCost: v.costPrice || 0 },
    ]);
    setSearchQuery('');
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: 'quantity' | 'unitCost', val: number) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        [field]: field === 'quantity' ? Math.max(1, val) : Math.max(0, val),
      };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      notes: notes || undefined,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        quantityOrdered: l.quantity,
        unitCost: l.unitCost,
      })),
    };

    try {
      await apiPost('/purchase-orders', payload);
      addToast('success', 'Purchase order created and submitted successfully');
      navigate('/purchasing');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit Purchase Order');
    }
  };

  const totalPOAmount = lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitCost), 0);

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
              <select
                className="form-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
              >
                <option value="">Select Supplier...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Receiving Warehouse *">
              <select
                className="form-select"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
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
                      <th>Variant SKU</th>
                      <th>Product Description</th>
                      <th>Qty Ordered</th>
                      <th>Unit Cost (SAR)</th>
                      <th>Subtotal (SAR)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, index) => (
                      <tr key={l.variantId}>
                        <td>{l.sku}</td>
                        <td>{l.name}</td>
                        <td>
                          <input
                            type="number"
                            value={l.quantity}
                            min={1}
                            onChange={(e) => updateLine(index, 'quantity', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '80px', minHeight: '32px', textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={l.unitCost}
                            min={0}
                            step="0.01"
                            onChange={(e) => updateLine(index, 'unitCost', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '100px', minHeight: '32px', textAlign: 'center' }}
                          />
                        </td>
                        <td>
                          <strong>{(l.quantity * l.unitCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                        </td>
                        <td>
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(index)}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Summary Panel */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  borderTop: '1px solid #edf1ed',
                  paddingTop: '16px',
                  marginTop: '16px'
                }}>
                  <div style={{ fontSize: '18px', color: '#066006' }}>
                    Total Estimated Amount: <strong>SAR {totalPOAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/purchasing')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={lines.length === 0}>
            Submit Purchase Order
          </button>
        </div>
      </form>
    </div>
  );
}
