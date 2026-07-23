import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, Plus, UserPlus, Eye, CheckCircle, Truck, FileText, Printer } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  status: string;
  expected_date: string | null;
  created_at: string;
  supplier_name?: string;
  line_count?: number;
  total_amount?: number;
}

export function PurchasingPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');

  // Supplier modal state
  const [isSupplierOpen, setIsSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
  });

  // PO details modal state
  const [selectedPO, setSelectedPO] = useState<any | null>(null);
  const [poDetailsLoading, setPoDetailsLoading] = useState(false);
  
  // Goods receipt sub-form within PO details
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [selectedWHId, setSelectedWHId] = useState('');
  const [receiptLines, setReceiptLines] = useState<Record<string, number>>({}); // productId -> quantityReceived
  const [receiptLocations, setReceiptLocations] = useState<Record<string, string>>({}); // productId -> locationId
  const [locationsList, setLocationsList] = useState<any[]>([]);

  const loadData = async () => {
    try {
      const [orders, sups] = await Promise.all([
        apiGet<PurchaseOrder[]>('/purchasing/orders'),
        apiGet<Supplier[]>('/purchasing/suppliers'),
      ]);
      setSuppliers(sups || []);

      const ordersWithSupplier = orders?.map(po => {
        const sup = sups?.find(s => s.id === po.supplier_id);
        return {
          ...po,
          supplier_name: sup ? sup.name : 'Unknown Supplier',
        };
      }) || [];
      
      setPos(ordersWithSupplier);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load purchasing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Fetch warehouse list when goods receipt is triggered
  useEffect(() => {
    async function loadWHs() {
      if (isReceiptOpen) {
        try {
          const whs = await apiGet<any[]>('/warehouses');
          setWarehouses(whs || []);
        } catch {}
      }
    }
    loadWHs();
  }, [isReceiptOpen]);

  // Fetch location list when receipt warehouse selection changes
  useEffect(() => {
    async function loadLocations() {
      if (selectedWHId) {
        try {
          const locs = await apiGet<any[]>(`/warehouses/${selectedWHId}/locations`);
          setLocationsList(locs || []);
        } catch {
          setLocationsList([]);
        }
      } else {
        setLocationsList([]);
      }
    }
    loadLocations();
  }, [selectedWHId]);

  const handleSupplierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) {
      addToast('error', 'Supplier name is required');
      return;
    }
    try {
      await apiPost('/purchasing/suppliers', supplierForm);
      addToast('success', 'Supplier registered successfully');
      setIsSupplierOpen(false);
      setSupplierForm({ name: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register supplier');
    }
  };

  const handleApprovePO = async (poId: string) => {
    try {
      setPoDetailsLoading(true);
      const result = await apiPost<any>(`/purchasing/orders/${poId}/approve`, {});
      addToast('success', '✅ PO Approved! Inventory updated and Purchase Invoice generated.');
      // Reload PO details so invoice section appears immediately
      await viewPoDetails({ id: poId } as any);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve PO');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  const handleCreateReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWHId) {
      addToast('error', 'Please select a receiving warehouse');
      return;
    }

    const payload = {
      purchaseOrderId: selectedPO.id,
      warehouseId: selectedWHId,
      lines: selectedPO.lines.map((l: any) => ({
        productId: l.product_id,
        quantityReceived: Number(receiptLines[l.product_id] || 0),
        warehouseLocationId: receiptLocations[l.product_id] || undefined,
      })).filter((l: any) => l.quantityReceived > 0),
    };

    if (payload.lines.length === 0) {
      addToast('error', 'At least one line item must receive units (Qty > 0)');
      return;
    }

    try {
      setPoDetailsLoading(true);
      await apiPost('/purchasing/receipts', payload);
      addToast('success', 'Goods Receipt generated and inventory updated');
      setIsReceiptOpen(false);
      setSelectedPO(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create Goods Receipt');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  const handlePrintPurchaseInvoice = async (poId: string) => {
    try {
      const data = await apiGet<any>(`/purchasing/orders/${poId}/print-invoice`);
      if (!data || !data.invoice) {
        addToast('error', 'No invoice found for this purchase order.');
        return;
      }
      const w = window.open('', '_blank');
      if (!w) {
        addToast('error', 'Pop-up blocked. Please allow pop-ups to print invoice.');
        return;
      }

      const subtotal = data.lines.reduce((acc: number, l: any) => acc + (Number(l.quantity_ordered) * Number(l.unit_cost)), 0);
      const totalDiscount = data.lines.reduce((acc: number, l: any) => acc + Number(l.discount_amount || 0), 0);
      const grandTotal = Number(data.invoice.total_amount);

      w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Purchase Invoice ${data.invoice.invoice_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1e293b; max-width: 850px; margin: 0 auto; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #066006; padding-bottom: 20px; margin-bottom: 24px; }
    .company-title { color: #066006; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .doc-type { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .inv-num { font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; }
    .card p { font-size: 13px; margin: 3px 0; color: #334155; }
    .card p.bold { font-weight: 700; color: #0f172a; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { background: #066006; color: white; padding: 10px 14px; text-align: left; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
    td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    tr:nth-child(even) { background: #f8fafc; }
    .text-right { text-align: right; }
    .summary-box { display: flex; justify-content: flex-end; margin-bottom: 30px; }
    .summary-table { min-width: 280px; display: grid; gap: 6px; font-size: 13px; }
    .summary-row { display: flex; justify-content: space-between; padding: 4px 0; }
    .grand-total { font-size: 18px; font-weight: 800; color: #066006; border-top: 2px solid #066006; padding-top: 10px; margin-top: 4px; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 11px; margin-top: 30px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #dcfce7; color: #166534; }
    .btn-print { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background: #066006; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 700; font-size: 13px; box-shadow: 0 4px 12px rgba(6,96,6,0.3); }
    .btn-print:hover { background: #044804; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <button class="btn-print no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>

  <div class="header">
    <div>
      <div class="company-title">AL-HAYAT ERP</div>
      <div class="doc-type">OFFICIAL PURCHASE INVOICE</div>
    </div>
    <div style="text-align: right;">
      <div class="inv-num">${data.invoice.invoice_number}</div>
      <p style="font-size: 12px; color: #64748b; margin-top: 2px;">PO Ref: <strong>${data.po.po_number}</strong></p>
      <p style="font-size: 12px; color: #64748b;">Date: <strong>${new Date(data.invoice.issued_at).toLocaleDateString()}</strong></p>
    </div>
  </div>

  <div class="meta-grid">
    <div class="card">
      <div class="card-title">Vendor / Supplier</div>
      <p class="bold">${data.supplier.name}</p>
      ${data.supplier.contactName ? `<p>Contact: ${data.supplier.contactName}</p>` : ''}
      ${data.supplier.phone ? `<p>Tel: ${data.supplier.phone}</p>` : ''}
      ${data.supplier.email ? `<p>Email: ${data.supplier.email}</p>` : ''}
      ${data.supplier.address ? `<p>${data.supplier.address}</p>` : ''}
    </div>
    <div class="card">
      <div class="card-title">Receiving Location &amp; Status</div>
      <p class="bold">Destination: ${data.warehouse.name}</p>
      ${data.warehouse.address ? `<p>${data.warehouse.address}</p>` : ''}
      <p style="margin-top: 8px;">Status: <span class="badge">${data.invoice.status}</span></p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 50%;">Product Description</th>
        <th>SKU</th>
        <th class="text-right">Qty</th>
        <th class="text-right">Unit Cost</th>
        <th class="text-right">Discount</th>
        <th class="text-right">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${data.lines.map((l: any) => `
        <tr>
          <td><strong>${l.product_name}</strong></td>
          <td style="color: #64748b; font-family: monospace;">${l.variant_sku}</td>
          <td class="text-right">${l.quantity_ordered}</td>
          <td class="text-right">$${Number(l.unit_cost).toFixed(2)}</td>
          <td class="text-right" style="color: #b45309;">-${Number(l.discount_amount || 0).toFixed(2)}</td>
          <td class="text-right" style="font-weight: 700;">$${Number(l.line_total || ((l.quantity_ordered * l.unit_cost) - Number(l.discount_amount || 0))).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="summary-box">
    <div class="summary-table">
      <div class="summary-row">
        <span>Subtotal:</span>
        <span>$${subtotal.toFixed(2)}</span>
      </div>
      <div class="summary-row" style="color: #b45309;">
        <span>Total Discount:</span>
        <span>-$${totalDiscount.toFixed(2)}</span>
      </div>
      <div class="summary-row grand-total">
        <span>Grand Total:</span>
        <span>$${grandTotal.toFixed(2)}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>This is an official Purchase Invoice sheet generated by Al-Hayat ERP. Goods received into stock.</p>
    <p>Generated on ${new Date().toLocaleString()}</p>
  </div>
</body>
</html>`);
      w.document.close();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to generate printable purchase invoice.');
    }
  };

  const viewPoDetails = async (po: PurchaseOrder) => {
    setPoDetailsLoading(true);
    try {
      // Fetch matching lines for this PO
      const details = await apiGet<any>(`/purchasing/orders/${po.id}`);
      
      // If lines are returned, setup default receiving quantities
      if (details) {
        setSelectedPO(details);
        const initialReceipt: Record<string, number> = {};
        details.lines?.forEach((l: any) => {
          initialReceipt[l.product_id] = l.quantity_ordered - (l.quantity_received || 0);
        });
        setReceiptLines(initialReceipt);
      } else {
        setSelectedPO(po);
      }
    } catch (err: any) {
      addToast('error', 'Failed to fetch PO lines');
    } finally {
      setPoDetailsLoading(false);
    }
  };

  const filteredPOs = pos.filter((po) => {
    if (activeTab === 'ALL') return true;
    return po.status === activeTab;
  });

  const tabItems = [
    { key: 'ALL', label: 'All POs', count: pos.length },
    { key: 'DRAFT', label: 'Drafts', count: pos.filter(p => p.status === 'DRAFT').length },
    { key: 'SUBMITTED', label: 'Submitted', count: pos.filter(p => p.status === 'SUBMITTED').length },
    { key: 'APPROVED', label: 'Approved', count: pos.filter(p => p.status === 'APPROVED').length },
    { key: 'FULLY_RECEIVED', label: 'Fully Received', count: pos.filter(p => p.status === 'FULLY_RECEIVED').length },
  ];

  const columns: Column<PurchaseOrder>[] = [
    { key: 'po_number', label: 'PO Number' },
    { key: 'supplier_name', label: 'Supplier' },
    {
      key: 'expected_date',
      label: 'Expected Date',
      render: (row) => row.expected_date ? new Date(row.expected_date).toLocaleDateString() : 'N/A',
    },
    {
      key: 'created_at',
      label: 'Created At',
      render: (row) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'APPROVED' || row.status === 'FULLY_RECEIVED') tone = 'green';
        if (row.status === 'SUBMITTED') tone = 'blue';
        if (row.status === 'DRAFT') tone = 'neutral';
        if (row.status === 'PARTIALLY_RECEIVED') tone = 'yellow';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewPoDetails(row)}>
            <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
          </button>
          {row.status === 'RECEIVED' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              title="Print Purchase Invoice Sheet"
              onClick={(e) => {
                e.stopPropagation();
                handlePrintPurchaseInvoice(row.id);
              }}
            >
              <Printer size={14} style={{ inlineSize: 'auto' }} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <PackagePlus size={24} />
        </div>
        <div>
          <p>Procurement</p>
          <h2>Suppliers, purchase orders, receipts, and payments</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setIsSupplierOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Add Supplier
          </button>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/purchasing/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Create PO
          </button>
        </div>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredPOs}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => viewPoDetails(row)}
          emptyMessage="No purchase orders recorded"
        />
      </section>

      {/* Supplier Modal Form */}
      <Modal isOpen={isSupplierOpen} onClose={() => setIsSupplierOpen(false)} title="Register New Supplier" width="sm">
        <form onSubmit={handleSupplierSubmit}>
          <div style={{ display: 'grid', gap: '14px' }}>
            <InputField
              label="Supplier Name"
              id="supName"
              value={supplierForm.name}
              onChange={(val) => setSupplierForm((prev) => ({ ...prev, name: val }))}
              required
            />
            <InputField
              label="Email Address"
              id="supEmail"
              type="email"
              value={supplierForm.email}
              onChange={(val) => setSupplierForm((prev) => ({ ...prev, email: val }))}
            />
            <InputField
              label="Phone Number"
              id="supPhone"
              value={supplierForm.phone}
              onChange={(val) => setSupplierForm((prev) => ({ ...prev, phone: val }))}
            />
            <TextareaField
              label="Business Address"
              id="supAddress"
              value={supplierForm.address}
              onChange={(val) => setSupplierForm((prev) => ({ ...prev, address: val }))}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsSupplierOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Register
            </button>
          </div>
        </form>
      </Modal>

      {/* PO Details Modal */}
      <Modal
        isOpen={!!selectedPO}
        onClose={() => {
          setSelectedPO(null);
          setIsReceiptOpen(false);
        }}
        title={selectedPO ? `Purchase Order: ${selectedPO.po_number}` : 'PO Details'}
        width="lg"
      >
        {selectedPO && (
          <div style={{ display: 'grid', gap: '18px' }}>
            {/* Metadata Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px', background: '#f7f9f7', padding: '12px', borderRadius: '8px' }}>
              <div>
                <span style={{ color: '#667066' }}>Supplier:</span>
                <p style={{ margin: '2px 0 0', fontWeight: '700' }}>{selectedPO.supplier_name || 'N/A'}</p>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Current Status:</span>
                <div style={{ marginTop: '2px' }}>
                  <StatusBadge label={selectedPO.status.replace('_', ' ')} tone={selectedPO.status === 'APPROVED' ? 'green' : 'neutral'} />
                </div>
              </div>
            </div>

            {/* PO Line Items */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006' }}>Ordered Items</h4>
              {poDetailsLoading ? (
                <LoadingSpinner label="Fetching lines..." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Ordered Qty</th>
                      <th>Received Qty</th>
                      <th>Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPO.lines?.map((line: any) => (
                      <tr key={line.id}>
                        <td><strong>{line.product_name}</strong><br /><span style={{ color: '#667066', fontSize: '12px' }}>{line.variant_sku}</span></td>
                        <td>{line.quantity_ordered}</td>
                        <td>{line.quantity_received || 0}</td>
                        <td>${Number(line.unit_cost).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Goods Receipt Section */}
            {isReceiptOpen ? (
              <form onSubmit={handleCreateReceipt} style={{ borderTop: '1px solid #edf1ed', paddingTop: '16px', marginTop: '10px' }}>
                <h4 style={{ margin: '0 0 12px', color: '#b45309' }}>Record Goods Receipt</h4>
                <div style={{ display: 'grid', gap: '14px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                    <InputField
                      label="Select Warehouse"
                      id="recWarehouse"
                      type="text"
                      disabled
                      value={warehouses[0]?.name || 'Central Warehouse'}
                      onChange={() => {}}
                    />
                    <div className="form-field">
                      <label className="form-field__label">Target Location</label>
                      <select
                        className="form-select"
                        value={selectedWHId}
                        onChange={(e) => setSelectedWHId(e.target.value)}
                        required
                      >
                        <option value="">Choose Warehouse...</option>
                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <h5 style={{ margin: '10px 0 6px' }}>Verify Received Quantities</h5>
                  <table>
                    <thead>
                      <tr>
                        <th>Variant</th>
                        <th>Qty to Receive</th>
                        <th>Bin Location</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.lines?.map((l: any) => (
                        <tr key={l.product_id}>
                          <td>{l.variant_sku}</td>
                          <td>
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: '80px', minHeight: '32px' }}
                              value={receiptLines[l.product_id] ?? 0}
                              min={0}
                              max={l.quantity_ordered - (l.quantity_received || 0)}
                              onChange={(e) => setReceiptLines(prev => ({ ...prev, [l.product_id]: Number(e.target.value) }))}
                            />
                          </td>
                          <td>
                            <select
                              className="form-select"
                              style={{ minHeight: '32px' }}
                              value={receiptLocations[l.product_id] || ''}
                              onChange={(e) => setReceiptLocations(prev => ({ ...prev, [l.product_id]: e.target.value }))}
                            >
                              <option value="">Default/System</option>
                              {locationsList.map(loc => (
                                <option key={loc.id} value={loc.id}>{loc.aisle}-{loc.rack}-{loc.shelf}-{loc.bin}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setIsReceiptOpen(false)}>
                    Back
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Post Goods Receipt
                  </button>
                </div>
              </form>
            ) : null}
            {/* Purchase Invoice Section — shown once the PO is received */}
            {selectedPO.invoice && (
              <div style={{ borderTop: '2px solid #d1e8d1', paddingTop: '16px', marginTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                  <FileText size={18} style={{ color: '#066006' }} />
                  <h4 style={{ margin: 0, color: '#066006' }}>Purchase Invoice</h4>
                  <span style={{ fontSize: '13px', color: '#667066' }}>{selectedPO.invoice.invoice_number}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                    onClick={() => handlePrintPurchaseInvoice(selectedPO.id)}
                  >
                    <Printer size={14} /> Print / Export PDF
                  </button>
                </div>
                <div style={{ background: '#f7fef7', border: '1px solid #d1e8d1', borderRadius: '8px', padding: '14px' }}>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th style={{ textAlign: 'right' }}>Qty</th>
                        <th style={{ textAlign: 'right' }}>Unit Cost</th>
                        <th style={{ textAlign: 'right' }}>Discount</th>
                        <th style={{ textAlign: 'right' }}>Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.lines?.map((line: any) => (
                        <tr key={line.id}>
                          <td><strong>{line.product_name}</strong></td>
                          <td style={{ color: '#667066', fontSize: '12px' }}>{line.variant_sku}</td>
                          <td style={{ textAlign: 'right' }}>{line.quantity_ordered}</td>
                          <td style={{ textAlign: 'right' }}>${Number(line.unit_cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', color: '#b45309' }}>-${Number(line.discount_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>${Number(line.line_total || ((line.quantity_ordered * line.unit_cost) - (line.discount_amount || 0))).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #d1e8d1' }}>
                    <div style={{ minWidth: '240px', display: 'grid', gap: '4px', fontSize: '13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#667066' }}>Invoice No.</span>
                        <span>{selectedPO.invoice.invoice_number}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#667066' }}>Issued</span>
                        <span>{new Date(selectedPO.invoice.issued_at).toLocaleDateString()}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', fontWeight: 700, color: '#066006', borderTop: '1px solid #d1e8d1', paddingTop: '6px', marginTop: '4px' }}>
                        <span>Grand Total</span>
                        <span>${Number(selectedPO.invoice.total_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedPO(null)}>
                Close
              </button>

              {selectedPO.invoice && (
                <button type="button" className="btn btn-secondary" onClick={() => handlePrintPurchaseInvoice(selectedPO.id)}>
                  <Printer size={14} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Print Invoice Sheet
                </button>
              )}

              {selectedPO.status === 'SUBMITTED' && hasPermission('manage_purchasing') && (
                <button type="button" className="btn btn-primary" onClick={() => handleApprovePO(selectedPO.id)} disabled={poDetailsLoading}>
                  <CheckCircle size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Approve &amp; Receive
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
