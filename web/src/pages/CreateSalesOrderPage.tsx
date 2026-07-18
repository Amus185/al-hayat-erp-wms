import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { FormField, InputField, TextareaField } from '../components/FormField';
import { SearchInput } from '../components/SearchInput';
import { SearchableSelect } from '../components/SearchableSelect';
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

export function CreateSalesOrderPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<ProductLine[]>([]);

  // Form states
  const [customerId, setCustomerId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [notes, setNotes] = useState('');

  // Searching products
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductLine[]>([]);

  // Selected lines
  const [lines, setLines] = useState<{ productId: string; sku: string; name: string; quantity: number; unitPrice: number }[]>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const custs = await apiGet<Customer[]>('/sales/customers');
        const brs = await apiGet<Branch[]>('/branches');
        const productsResponse = await apiGet<any>('/products?limit=1000');
        const productsList = productsResponse?.data || [];
        
        setCustomers(custs || []);
        setBranches(brs || []);

        const flatList: ProductLine[] = [];
        productsList.forEach((p: any) => {
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

  // Search filter
  useEffect(() => {
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }
    const filtered = products.filter(
      (v) =>
        (v.sku || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.barcode || '').includes(searchQuery) ||
        (v.name || '').toLowerCase().includes(searchQuery.toLowerCase())
    );
    setSearchResults(filtered.slice(0, 5));
  }, [searchQuery, products]);

  const addLine = (v: ProductLine) => {
    if (lines.some((l) => l.productId === v.id)) {
      addToast('warning', 'Product already added to order lines');
      return;
    }
    setLines((prev) => [
      ...prev,
      { productId: v.id, sku: v.sku, name: v.name, quantity: 1, unitPrice: v.sellingPrice || 0 },
    ]);
    setSearchQuery('');
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: 'quantity' | 'unitPrice', val: number) => {
    const num = isNaN(val) ? 0 : val;
    setLines((prev) => {
      const copy = [...prev];
      copy[idx] = {
        ...copy[idx],
        [field]: field === 'quantity' ? Math.max(1, num) : Math.max(0, num),
      };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      })),
    };

    try {
      const order = await apiPost<any>('/sales/orders', payload);
      if (completeNow) {
        await apiPost(`/sales/orders/${order.id}/complete`, {});
        addToast('success', '✅ Sale completed! Invoice issued and payment recorded.');
      } else {
        addToast('success', 'Sales order saved as draft');
      }
      navigate('/sales');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to submit Sales Order');
    }
  };

  const totalOrderAmount = lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);

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
              <SearchableSelect
                value={customerId}
                onChange={(val) => setCustomerId(val)}
                options={customers.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select Customer..."
              />
            </FormField>

            <FormField label="Originating Branch *">
              <SearchableSelect
                value={branchId}
                onChange={(val) => setBranchId(val)}
                options={branches.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select Branch..."
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

          <div style={{ position: 'relative' }}>
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search / Scan product to add to Order..."
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
                    <strong>{v.name}</strong> <span style={{ color: '#667066' }}>({v.sku} - {v.barcode})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                      <th>Qty Ordered</th>
                      <th>Unit Price ($)</th>
                      <th>Subtotal ($)</th>
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
                            onChange={(e) => updateLine(index, 'quantity', Number(e.target.value))}
                            className="form-input"
                            style={{ width: '80px', minHeight: '32px', textAlign: 'center' }}
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
                          <strong>{(l.quantity * l.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
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
                    Total Order Value: <strong>${totalOrderAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/sales')}>
            Cancel
          </button>
          <button type="submit" className="btn btn-secondary" disabled={lines.length === 0}
            onClick={() => (document.getElementById('completeNowFlag') as HTMLInputElement).value = '0'}>
            Save as Draft
          </button>
          <button type="submit" className="btn btn-primary" disabled={lines.length === 0}
            onClick={() => (document.getElementById('completeNowFlag') as HTMLInputElement).value = '1'}
            style={{ background: 'linear-gradient(135deg, #0b8f08, #066006)' }}>
            ⚡ Create & Complete
          </button>
          <input type="hidden" id="completeNowFlag" name="completeNow" defaultValue="1" />
        </div>
      </form>
    </div>
  );
}
