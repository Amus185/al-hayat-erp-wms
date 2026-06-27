import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowLeft, Plus, Trash2, Search } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { useToast } from '../contexts/ToastContext';

interface Warehouse {
  id: string;
  name: string;
}

interface Branch {
  id: string;
  name: string;
}

interface ProductVariant {
  id: string;
  sku: string;
  barcode: string;
  productName: string;
}

export function CreateTransferPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  
  // Selection state
  const [sourceType, setSourceType] = useState<'WAREHOUSE' | 'BRANCH'>('WAREHOUSE');
  const [sourceId, setSourceId] = useState('');
  const [destType, setDestType] = useState<'WAREHOUSE' | 'BRANCH'>('BRANCH');
  const [destId, setDestId] = useState('');

  // Searching variants
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductVariant[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ variantId: string; sku: string; name: string; quantity: number }[]>([]);

  useEffect(() => {
    async function loadMetadata() {
      try {
        const whs = await apiGet<Warehouse[]>('/warehouses');
        const brs = await apiGet<Branch[]>('/branches');
        const products = await apiGet<any[]>('/products');
        
        setWarehouses(whs || []);
        setBranches(brs || []);

        // Build flat variant list
        const flatList: ProductVariant[] = [];
        products?.forEach((p) => {
          p.variants?.forEach((v: any) => {
            flatList.push({
              id: v.id,
              sku: v.sku,
              barcode: v.barcode,
              productName: p.name,
            });
          });
        });
        setVariants(flatList);
      } catch (err) {
        console.error('Failed to load transfer metadata', err);
      }
    }
    loadMetadata();
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
      addToast('warning', 'Variant already added to transfer lines');
      return;
    }
    setLines((prev) => [...prev, { variantId: v.id, sku: v.sku, name: v.productName, quantity: 1 }]);
    setSearchQuery('');
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLineQty = (idx: number, qty: number) => {
    setLines((prev) => {
      const copy = [...prev];
      copy[idx].quantity = Math.max(1, qty);
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceId) {
      addToast('error', 'Please select a source');
      return;
    }
    if (!destId) {
      addToast('error', 'Please select a destination');
      return;
    }
    if (sourceType === destType && sourceId === destId) {
      addToast('error', 'Source and Destination cannot be the same');
      return;
    }
    if (lines.length === 0) {
      addToast('error', 'Please add at least one line item to transfer');
      return;
    }

    const payload = {
      sourceOwnerType: sourceType,
      sourceWarehouseId: sourceType === 'WAREHOUSE' ? sourceId : undefined,
      sourceBranchId: sourceType === 'BRANCH' ? sourceId : undefined,
      destinationOwnerType: destType,
      destinationWarehouseId: destType === 'WAREHOUSE' ? destId : undefined,
      destinationBranchId: destType === 'BRANCH' ? destId : undefined,
      lines: lines.map((l) => ({
        variantId: l.variantId,
        quantityRequested: l.quantity,
      })),
    };

    try {
      await apiPost('/transfers', payload);
      addToast('success', 'Transfer order created successfully');
      navigate('/transfers');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create transfer');
    }
  };

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn--outline"
          onClick={() => navigate('/transfers')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        >
          <ArrowLeft size={16} /> Back to Transfers
        </button>
      </section>

      <section className="module-header">
        <div className="module-header__icon">
          <Truck size={24} />
        </div>
        <div>
          <p>Movement Wizard</p>
          <h2>Create Warehouse-to-Branch / Branch-to-Branch Stock Transfer</h2>
        </div>
        <div></div>
      </section>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {/* Source Panel */}
          <div className="panel" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Source Origin</h3>
            
            <FormField label="Owner Type">
              <select
                className="form-select"
                value={sourceType}
                onChange={(e) => {
                  setSourceType(e.target.value as any);
                  setSourceId('');
                }}
              >
                <option value="WAREHOUSE">Warehouse</option>
                <option value="BRANCH">Branch</option>
              </select>
            </FormField>

            <div style={{ marginTop: '10px' }}>
              <FormField label={sourceType === 'WAREHOUSE' ? 'Select Warehouse' : 'Select Branch'}>
                <select
                  className="form-select"
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  required
                >
                  <option value="">Select Origin...</option>
                  {sourceType === 'WAREHOUSE'
                    ? warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)
                    : branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </FormField>
            </div>
          </div>

          {/* Destination Panel */}
          <div className="panel" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Destination Site</h3>

            <FormField label="Owner Type">
              <select
                className="form-select"
                value={destType}
                onChange={(e) => {
                  setDestType(e.target.value as any);
                  setDestId('');
                }}
              >
                <option value="WAREHOUSE">Warehouse</option>
                <option value="BRANCH">Branch</option>
              </select>
            </FormField>

            <div style={{ marginTop: '10px' }}>
              <FormField label={destType === 'WAREHOUSE' ? 'Select Warehouse' : 'Select Branch'}>
                <select
                  className="form-select"
                  value={destId}
                  onChange={(e) => setDestId(e.target.value)}
                  required
                >
                  <option value="">Select Destination...</option>
                  {destType === 'WAREHOUSE'
                    ? warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)
                    : branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </FormField>
            </div>
          </div>
        </div>

        {/* Search & Add Items Panel */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Items to Transfer</h3>
          
          <div style={{ position: 'relative' }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search / Scan barcode of product variant..."
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

          {/* Added lines list */}
          <div style={{ marginTop: '20px' }}>
            {lines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#667066', border: '1px dashed #d9e2d9', borderRadius: '8px' }}>
                No variants added yet. Scan or search for variants above to add lines.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Variant SKU</th>
                    <th>Product Description</th>
                    <th>Transfer Qty</th>
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
                          onChange={(e) => updateLineQty(index, Number(e.target.value))}
                          className="form-input"
                          style={{ width: '80px', minHeight: '32px', textAlign: 'center' }}
                        />
                      </td>
                      <td>
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => removeLine(index)}>
                          <Trash2 size={14} />
                        </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn--outline" onClick={() => navigate('/transfers')}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={lines.length === 0}>
            Submit Transfer Request
          </button>
        </div>
      </form>
    </div>
  );
}
