import { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, ArrowLeft, Plus, Trash2, Search, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { SearchableSelect } from '../components/SearchableSelect';
import { ProductItemSelect, type SelectableProduct } from '../components/ProductItemSelect';
import { useProductCatalog } from '../utils/productCatalog';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface Warehouse {
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
}

export function CreateTransferPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  // Products are searched on the server; their stock comes along so the
  // picker shows what the source location has.
  const catalog = useProductCatalog({ withStock: true, status: 'active' });
  const { isAdmin, branchId: userBranchId } = useAuth();
  const products = useMemo<ProductLine[]>(() => catalog.items.map((p) => ({ id: p.id, sku: p.sku, barcode: p.barcode, name: p.name })), [catalog.items]);
  
  // Selection state
  const [sourceType, setSourceType] = useState<'WAREHOUSE' | 'BRANCH'>('WAREHOUSE');
  const [sourceId, setSourceId] = useState('');
  const [destType, setDestType] = useState<'WAREHOUSE' | 'BRANCH'>('BRANCH');
  const [destId, setDestId] = useState('');

  // Searching variants
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductLine[]>([]);

  // Transfer Details
  const [transferDate, setTransferDate] = useState('');

  // Selected lines
  const [lines, setLines] = useState<{ productId: string; sku: string; name: string; quantity: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    async function loadMetadata() {
      try {
        const whs = await apiGet<Warehouse[]>('/warehouses');
        // A branch user cannot list every branch: the server gives the other branches to send to.
        const brs = await apiGet<Branch[]>('/transfers/destinations').catch(() => apiGet<Branch[]>('/branches'));

        setWarehouses(whs || []);
        setBranches(brs || []);

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
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter(
      (v) =>
        (v.sku && String(v.sku).toLowerCase().includes(q)) ||
        (v.barcode && String(v.barcode).toLowerCase().includes(q)) ||
        (v.name && String(v.name).toLowerCase().includes(q))
    );
    setSearchResults(filtered.slice(0, 5));
  }, [searchQuery, products]);

  const addLine = (v: ProductLine | SelectableProduct) => {
    const existingIndex = lines.findIndex((l) => l.productId === v.id);
    if (existingIndex !== -1) {
      setLines((prev) =>
        prev.map((l, i) =>
          i === existingIndex ? { ...l, quantity: l.quantity + 1 } : l
        )
      );
      addToast('info', `Incremented "${v.name}" quantity`);
      return;
    }
    setLines((prev) => [...prev, { productId: v.id, sku: v.sku, name: v.name, quantity: 1 }]);
    addToast('success', `Added "${v.name}" to transfer`);
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
    if (submitting) return;
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
      transferDate: transferDate || undefined,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantityRequested: l.quantity,
      })),
    };

    // A ref, not only state: two quick taps arrive before the re-render that
    // disables the buttons, and would create two transfers.
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    let created: any = null;
    try {
      created = await apiPost<any>('/transfers', payload);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create Transfer Order');
      inFlight.current = false;
      setSubmitting(false);
      return;
    }
    // One step: nothing moves now. The receiver accepts (stock moves then) or declines.
    addToast('success', `Sent${created?.transfer_number ? ` (${created.transfer_number})` : ''}. The receiving branch will accept or decline it; the stock moves when they accept.`);
    navigate('/transfers');
  };

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button
          type="button"
          className="btn btn-secondary"
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
                <SearchableSelect
                  options={
                    sourceType === 'WAREHOUSE'
                      ? warehouses.map((w) => ({ value: w.id, label: w.name }))
                      : branches.map((b) => ({ value: b.id, label: b.name }))
                  }
                  value={sourceId}
                  onChange={setSourceId}
                  placeholder="Search Origin..."
                />
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
                <SearchableSelect
                  options={
                    destType === 'WAREHOUSE'
                      ? warehouses.map((w) => ({ value: w.id, label: w.name }))
                      : branches.map((b) => ({ value: b.id, label: b.name }))
                  }
                  value={destId}
                  onChange={setDestId}
                  placeholder="Search Destination..."
                />
              </FormField>
            </div>
          </div>
        </div>

        {/* Schedule Panel */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Schedule</h3>
          <div style={{ maxWidth: '300px' }}>
            <InputField
              label="Transfer Date"
              id="transferDate"
              type="date"
              value={transferDate}
              onChange={setTransferDate}
            />
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#667066' }}>
              Transfers scheduled for a future date will remain pending until the date arrives.
            </p>
          </div>
        </div>

        {/* Search & Add Items Panel */}
        <div className="panel" style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 14px', color: '#066006' }}>Items to Transfer</h3>
          
          <ProductItemSelect
            products={products.map((p) => {
              // available at the chosen source (on hand - reserved)
              // (branch staff only receive their own branch's stock: elsewhere it is unknown)
              const known = isAdmin || (sourceType === 'BRANCH' && sourceId === userBranchId);
              const avail = sourceId && known
                ? catalog.stockRows
                    .filter((r: any) => r.product_id === p.id && r.owner_type === sourceType && (sourceType === 'WAREHOUSE' ? r.warehouse_id : r.branch_id) === sourceId)
                    .reduce((n: number, r: any) => n + Number(r.quantity_on_hand || 0) - Number(r.quantity_reserved || 0), 0)
                : null;
              return {
                id: p.id,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode,
                stock: avail ?? undefined, // nothing shown until a source is chosen
                stockHint: avail === 0 ? 'None available at the source' : null,
                stockWarning: avail === 0,
              };
            })}
            onSelect={addLine}
            onSearch={catalog.search}
            searching={catalog.searching}
            placeholder="Search / click to select product to transfer..."
            existingLines={lines.map((l) => ({ productId: l.productId, quantity: l.quantity }))}
          />

          {/* Added lines list */}
          <div style={{ marginTop: '20px' }}>
            {lines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: '#667066', border: '1px dashed #d9e2d9', borderRadius: '8px' }}>
                No products added yet. Scan or search for products above to add lines.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Product ID</th>
                    <th>Product Description</th>
                    <th>Transfer Qty</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => (
                    <tr key={l.productId}>
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
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeLine(index)}>
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
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/transfers')} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            id="send-transfer"
            className="btn btn-primary"
            onClick={(e) => handleSubmit(e)}
            disabled={lines.length === 0 || submitting}
            title="The receiving location accepts it (all or part) and the stock moves in one step"
          >
            {submitting ? <><Loader2 size={14} className="spin-icon" /> Sending…</> : <>Send to receiver</>}
          </button>
        </div>
      </form>
    </div>
  );
}
