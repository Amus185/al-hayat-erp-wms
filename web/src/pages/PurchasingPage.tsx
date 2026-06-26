import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackagePlus, Plus, UserPlus, Eye, CheckCircle, Truck, FileText } from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '../api/client';
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
    contactName: '',
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
  const [receiptLines, setReceiptLines] = useState<Record<string, number>>({}); // variantId -> quantityReceived
  const [receiptLocations, setReceiptLocations] = useState<Record<string, string>>({}); // variantId -> locationId
  const [locationsList, setLocationsList] = useState<any[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      const orders = await apiGet<PurchaseOrder[]>('/purchase-orders');
      
      // Resolve supplier name mappings
      const sups = await apiGet<Supplier[]>('/suppliers');
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
      await apiPost('/suppliers', supplierForm);
      addToast('success', 'Supplier registered successfully');
      setIsSupplierOpen(false);
      setSupplierForm({ name: '', contactName: '', email: '', phone: '', address: '' });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to register supplier');
    }
  };

  const handleApprovePO = async (poId: string) => {
    try {
      setPoDetailsLoading(true);
      await apiPatch(`/purchase-orders/${poId}/approve`);
      addToast('success', 'Purchase order approved');
      setSelectedPO(null);
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
        variantId: l.variant_id,
        quantityReceived: Number(receiptLines[l.variant_id] || 0),
        warehouseLocationId: receiptLocations[l.variant_id] || undefined,
      })).filter((l: any) => l.quantityReceived > 0),
    };

    if (payload.lines.length === 0) {
      addToast('error', 'At least one line item must receive units (Qty > 0)');
      return;
    }

    try {
      setPoDetailsLoading(true);
      await apiPost('/goods-receipts', payload);
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

  const viewPoDetails = async (po: PurchaseOrder) => {
    setPoDetailsLoading(true);
    try {
      // Fetch matching lines for this PO
      const res = await apiGet<any>(`/purchase-orders`);
      const details = res?.find((r: any) => r.id === po.id);
      
      // If lines are returned, setup default receiving quantities
      if (details) {
        setSelectedPO(details);
        const initialReceipt: Record<string, number> = {};
        details.lines?.forEach((l: any) => {
          initialReceipt[l.variant_id] = l.quantity_ordered - (l.quantity_received || 0);
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
        <button type="button" className="btn btn--outline btn--sm" onClick={() => viewPoDetails(row)}>
          <Eye size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Details
        </button>
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
          <button type="button" className="btn btn--outline" onClick={() => setIsSupplierOpen(true)}>
            <UserPlus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Add Supplier
          </button>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/purchasing/new')}>
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
              label="Contact Name"
              id="supContact"
              value={supplierForm.contactName}
              onChange={(val) => setSupplierForm((prev) => ({ ...prev, contactName: val }))}
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
            <button type="button" className="btn btn--outline" onClick={() => setIsSupplierOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary">
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
                        <td>SAR {Number(line.unit_cost).toLocaleString()}</td>
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
                        <tr key={l.variant_id}>
                          <td>{l.variant_sku}</td>
                          <td>
                            <input
                              type="number"
                              className="form-input"
                              style={{ width: '80px', minHeight: '32px' }}
                              value={receiptLines[l.variant_id] ?? 0}
                              min={0}
                              max={l.quantity_ordered - (l.quantity_received || 0)}
                              onChange={(e) => setReceiptLines(prev => ({ ...prev, [l.variant_id]: Number(e.target.value) }))}
                            />
                          </td>
                          <td>
                            <select
                              className="form-select"
                              style={{ minHeight: '32px' }}
                              value={receiptLocations[l.variant_id] || ''}
                              onChange={(e) => setReceiptLocations(prev => ({ ...prev, [l.variant_id]: e.target.value }))}
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
                  <button type="button" className="btn btn--outline" onClick={() => setIsReceiptOpen(false)}>
                    Back
                  </button>
                  <button type="submit" className="btn btn--primary">
                    Post Goods Receipt
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #edf1ed', paddingTop: '16px' }}>
                <button type="button" className="btn btn--outline" onClick={() => setSelectedPO(null)}>
                  Close
                </button>

                {selectedPO.status === 'SUBMITTED' && hasPermission('purchasing.approve') && (
                  <button type="button" className="btn btn--primary" onClick={() => handleApprovePO(selectedPO.id)}>
                    Approve PO
                  </button>
                )}

                {selectedPO.status === 'APPROVED' && (
                  <button type="button" className="btn btn--primary" onClick={() => setIsReceiptOpen(true)}>
                    <Truck size={14} style={{ marginRight: '4px', inlineSize: 'auto' }} /> Receive Goods
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
