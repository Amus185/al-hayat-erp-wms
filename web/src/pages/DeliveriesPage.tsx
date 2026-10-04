import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Truck, Plus, Search, Filter, CheckCircle2, Clock, AlertTriangle,
  MapPin, Phone, User, Calendar, Eye, Send, CheckCheck, Printer,
  FileText, Wrench, ShieldCheck, ChevronRight, X, Loader2
} from 'lucide-react';
import { apiGet, apiPost, apiPatch } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { InputField, TextareaField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner, PageSkeleton } from '../components/LoadingSpinner';
import { MetricCard } from '../components/MetricCard';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { confirmAction } from '../utils/swal';

interface DeliveryItem {
  id: string;
  product_id: string;
  product_name?: string;
  product_sku?: string;
  quantity: number;
  notes?: string;
}

interface Delivery {
  id: string;
  delivery_number: string;
  sales_order_id: string | null;
  order_number?: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  city: string;
  source_warehouse_id: string | null;
  warehouse_name?: string;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  status: 'PENDING' | 'SCHEDULED' | 'DISPATCHED' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
  scheduled_date: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  recipient_signature_name: string | null;
  installation_required: number;
  installer_name: string | null;
  installation_fee: number;
  notes: string | null;
  created_at: string;
  total_items?: number;
  total_units?: number;
  items?: DeliveryItem[];
}

interface Stats {
  total: number;
  pending: number;
  dispatched: number;
  deliveredToday: number;
}

export function DeliveriesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, dispatched: 0, deliveredToday: 0 });
  const [loading, setLoading] = useState(true);

  // Filter states
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDispatchOpen, setIsDispatchOpen] = useState(false);
  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null);

  // Form states for creation
  const [salesOrders, setSalesOrders] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [createForm, setCreateForm] = useState({
    salesOrderId: '',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    city: 'Hargeisa',
    sourceWarehouseId: '',
    driverName: '',
    driverPhone: '',
    vehiclePlate: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    installationRequired: false,
    installerName: '',
    installationFee: 40,
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Dispatch / Complete form states
  const [dispatchForm, setDispatchForm] = useState({ driverName: '', vehiclePlate: '' });
  const [completeForm, setCompleteForm] = useState({ recipientName: '', notes: '' });

  const loadData = async () => {
    try {
      setLoading(true);
      const [delRes, statsRes] = await Promise.all([
        apiGet<Delivery[]>('/deliveries'),
        apiGet<Stats>('/deliveries/stats'),
      ]);
      setDeliveries(delRes || []);
      setStats(statsRes || { total: 0, pending: 0, dispatched: 0, deliveredToday: 0 });
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Pre-load Sales Orders & Warehouses for creation modal
  useEffect(() => {
    async function loadAux() {
      try {
        const [ordersRes, whRes] = await Promise.all([
          apiGet<any[]>('/sales/orders'),
          apiGet<any[]>('/warehouses'),
        ]);
        setSalesOrders(ordersRes || []);
        setWarehouses(whRes || []);

        // If URL has ?orderId=..., open create modal pre-filled
        const orderIdParam = searchParams.get('orderId');
        if (orderIdParam) {
          const matched = (ordersRes || []).find((o) => o.id === orderIdParam);
          if (matched) {
            if (matched.status === 'DELIVERED' || matched.delivery_status === 'DELIVERED') {
              addToast('info', `Order ${matched.order_number} is already marked as DELIVERED.`);
              setSearchQuery(matched.delivery_number || matched.order_number || '');
            } else {
              handleOpenCreateWithOrder(matched);
            }
          }
        }
      } catch (err) {
        console.error('Aux load error', err);
      }
    }
    loadAux();
  }, [searchParams]);

  const handleOpenCreateWithOrder = (order: any) => {
    setCreateForm({
      salesOrderId: order.id,
      customerName: order.customer_name || '',
      customerPhone: order.customer_phone || '',
      deliveryAddress: order.customer_address || '',
      city: 'Hargeisa',
      sourceWarehouseId: warehouses[0]?.id || '',
      driverName: '',
      driverPhone: '',
      vehiclePlate: '',
      scheduledDate: new Date().toISOString().split('T')[0],
      installationRequired: Number(order.installation_fee || 0) > 0,
      installerName: order.installer_name || '',
      installationFee: Number(order.installation_fee || 40),
      notes: `Delivery for Sales Order #${order.order_number}`,
    });
    setIsCreateOpen(true);
  };

  const handleSelectSalesOrder = (soId: string) => {
    const matched = salesOrders.find((s) => s.id === soId);
    if (!matched) {
      setCreateForm((prev) => ({ ...prev, salesOrderId: soId }));
      return;
    }
    if (matched.status === 'DELIVERED' || matched.delivery_status === 'DELIVERED') {
      addToast('warning', `Order ${matched.order_number} has already been delivered and cannot be registered again.`);
      return;
    }
    setCreateForm((prev) => ({
      ...prev,
      salesOrderId: soId,
      customerName: matched.customer_name || prev.customerName,
      customerPhone: matched.customer_phone || prev.customerPhone,
      deliveryAddress: matched.customer_address || prev.deliveryAddress,
      installationRequired: Number(matched.installation_fee || 0) > 0,
      installerName: matched.installer_name || prev.installerName,
      installationFee: Number(matched.installation_fee || 40),
      notes: `Delivery for Sales Order #${matched.order_number}`,
    }));
  };

  const handleCreateDelivery = async (e: React.FormEvent, dispatchImmediately = false) => {
    e.preventDefault();
    if (!createForm.customerName || !createForm.customerPhone || !createForm.deliveryAddress) {
      addToast('error', 'Please complete customer contact and address details.');
      return;
    }
    try {
      setSubmitting(true);
      const created = await apiPost<any>('/deliveries', createForm);
      if (dispatchImmediately && created?.id) {
        await apiPost(`/deliveries/${created.id}/dispatch`, {
          driverName: createForm.driverName || 'Assigned Driver',
          vehiclePlate: createForm.vehiclePlate || undefined,
        });
        addToast('success', 'Delivery scheduled and dispatched immediately!');
      } else {
        addToast('success', 'Delivery scheduled successfully');
      }
      setIsCreateOpen(false);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create delivery');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDispatch = async (d: Delivery) => {
    if (!d.driver_name) {
      handleOpenDispatch(d);
      return;
    }
    const confirmed = await confirmAction(
      'Dispatch Delivery?',
      `Dispatch Delivery #${d.delivery_number} with driver ${d.driver_name} (${d.vehicle_plate || 'No plate'})?`,
      'Yes, Dispatch 🚚',
      'info'
    );
    if (!confirmed) return;
    try {
      setSubmitting(true);
      await apiPost(`/deliveries/${d.id}/dispatch`, {
        driverName: d.driver_name,
        vehiclePlate: d.vehicle_plate,
      });
      addToast('success', `Delivery #${d.delivery_number} marked as DISPATCHED!`);
      if (isDetailsOpen && selectedDelivery?.id === d.id) {
        const full = await apiGet<Delivery>(`/deliveries/${d.id}`);
        if (full) setSelectedDelivery(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch delivery');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickComplete = async (d: Delivery) => {
    const confirmed = await confirmAction(
      'Confirm Delivered?',
      `Mark Delivery #${d.delivery_number} as DELIVERED to ${d.customer_name}?`,
      'Yes, Confirm Received ✅',
      'success'
    );
    if (!confirmed) return;
    try {
      setSubmitting(true);
      await apiPost(`/deliveries/${d.id}/complete`, {
        recipientSignatureName: d.customer_name,
        notes: 'Delivered in good condition and accepted by customer.',
      });
      addToast('success', `Delivery #${d.delivery_number} completed & confirmed!`);
      if (isDetailsOpen && selectedDelivery?.id === d.id) {
        const full = await apiGet<Delivery>(`/deliveries/${d.id}`);
        if (full) setSelectedDelivery(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete delivery');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetails = async (d: Delivery) => {
    try {
      const full = await apiGet<Delivery>(`/deliveries/${d.id}`);
      setSelectedDelivery(full || d);
      setIsDetailsOpen(true);
    } catch {
      setSelectedDelivery(d);
      setIsDetailsOpen(true);
    }
  };

  const handleOpenDispatch = (d: Delivery) => {
    setSelectedDelivery(d);
    setDispatchForm({
      driverName: d.driver_name || '',
      vehiclePlate: d.vehicle_plate || '',
    });
    setIsDispatchOpen(true);
  };

  const handleConfirmDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDelivery) return;
    try {
      setSubmitting(true);
      await apiPost(`/deliveries/${selectedDelivery.id}/dispatch`, dispatchForm);
      addToast('success', `Delivery ${selectedDelivery.delivery_number} marked as DISPATCHED!`);
      setIsDispatchOpen(false);
      if (isDetailsOpen) {
        const full = await apiGet<Delivery>(`/deliveries/${selectedDelivery.id}`);
        setSelectedDelivery(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch delivery');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenComplete = (d: Delivery) => {
    setSelectedDelivery(d);
    setCompleteForm({
      recipientName: d.customer_name || '',
      notes: 'Delivered in good condition and accepted by customer.',
    });
    setIsCompleteOpen(true);
  };

  const handleConfirmComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDelivery) return;
    try {
      setSubmitting(true);
      await apiPost(`/deliveries/${selectedDelivery.id}/complete`, {
        recipientSignatureName: completeForm.recipientName,
        notes: completeForm.notes,
      });
      addToast('success', `Delivery ${selectedDelivery.delivery_number} completed & confirmed!`);
      setIsCompleteOpen(false);
      if (isDetailsOpen) {
        const full = await apiGet<Delivery>(`/deliveries/${selectedDelivery.id}`);
        setSelectedDelivery(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete delivery');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintSlip = (d: Delivery) => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`
      <html>
      <head>
        <title>Delivery Consignment Note - ${d.delivery_number}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 30px; color: #1e293b; }
          .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0b8f08; padding-bottom: 12px; margin-bottom: 20px; }
          .company { font-size: 24px; font-weight: 800; color: #066006; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; background: #e2e8f0; font-weight: 700; font-size: 13px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
          .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
          .box h4 { margin: 0 0 8px; color: #066006; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { background: #f1f5f9; padding: 8px 12px; text-align: left; font-size: 12px; border: 1px solid #cbd5e1; }
          td { padding: 8px 12px; font-size: 13px; border: 1px solid #e2e8f0; }
          .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 50px; }
          .sig-box { border-top: 1px solid #475569; padding-top: 8px; text-align: center; font-size: 12px; color: #475569; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="company">AL-HAYAT TRADING & FURNITURE</div>
            <div style="font-size: 13px; color: #64748b;">Official Product Delivery Waybill & Consignment Note</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; font-size: 18px; color: #0f172a;">${d.delivery_number}</div>
            <div style="font-size: 13px; color: #64748b;">Order: #${d.order_number || 'Direct'}</div>
            <div class="badge" style="margin-top: 4px;">${d.status}</div>
          </div>
        </div>

        <div class="grid">
          <div class="box">
            <h4>Customer & Destination</h4>
            <div><strong>${d.customer_name}</strong></div>
            <div>Phone: ${d.customer_phone}</div>
            <div>Address: ${d.delivery_address}, ${d.city}</div>
          </div>
          <div class="box">
            <h4>Fulfillment & Logistics</h4>
            <div>Origin: ${d.warehouse_name || 'Central Distribution Warehouse'}</div>
            <div>Assigned Driver: ${d.driver_name || 'Pending assignment'} (${d.driver_phone || '—'})</div>
            <div>Vehicle Plate: ${d.vehicle_plate || '—'}</div>
            <div>Scheduled: ${d.scheduled_date || 'Standard Delivery'}</div>
          </div>
        </div>

        ${d.installation_required ? `
          <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
            <strong style="color: #854d0e;">🛠️ On-Site Installation Service Included</strong>
            <div style="font-size: 12px; color: #713f12; margin-top: 4px;">
              Technician: ${d.installer_name || 'Assigned Technician'} | Installation Fee: $${Number(d.installation_fee).toFixed(2)} (Pass-through service)
            </div>
          </div>
        ` : ''}

        <h4 style="margin: 0 0 6px; color: #066006;">Shipped Items & Quantities</h4>
        <table>
          <thead>
            <tr>
              <th>Item / Product</th>
              <th>SKU</th>
              <th>Qty Shipped</th>
              <th>Condition Notes</th>
            </tr>
          </thead>
          <tbody>
            ${(d.items || []).map((i) => `
              <tr>
                <td><strong>${i.product_name || 'Standard Merchandise'}</strong></td>
                <td>${i.product_sku || '—'}</td>
                <td><strong>${i.quantity} units</strong></td>
                <td>${i.notes || 'Good Condition'}</td>
              </tr>
            `).join('')}
            ${(!d.items || d.items.length === 0) ? `
              <tr>
                <td colspan="4" style="text-align: center; color: #64748b;">Associated with Sales Order #${d.order_number || d.sales_order_id}</td>
              </tr>
            ` : ''}
          </tbody>
        </table>

        ${d.notes ? `<div style="margin-top: 14px; font-size: 13px; color: #475569;"><strong>Notes / Delivery Instructions:</strong> ${d.notes}</div>` : ''}

        <div class="sig-row">
          <div class="sig-box">
            <div style="height: 40px;"></div>
            Driver Signature & Date
          </div>
          <div class="sig-box">
            <div style="height: 40px;"></div>
            Customer Receipt Confirmation & Signature
          </div>
        </div>
      </body>
      </html>
    `);
    w.document.close();
  };

  // Filtered deliveries
  const deliveryList = Array.isArray(deliveries) ? deliveries : [];
  const filtered = deliveryList.filter((d) => {
    if (activeTab !== 'ALL' && d.status !== activeTab) return false;
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matchNum = d.delivery_number.toLowerCase().includes(q);
      const matchCust = d.customer_name.toLowerCase().includes(q);
      const matchPhone = d.customer_phone.toLowerCase().includes(q);
      const matchOrder = String(d.order_number || '').toLowerCase().includes(q);
      const matchDriver = String(d.driver_name || '').toLowerCase().includes(q);
      if (!matchNum && !matchCust && !matchPhone && !matchOrder && !matchDriver) return false;
    }
    return true;
  });

  const tabItems = [
    { key: 'ALL', label: 'All Deliveries', count: deliveryList.length },
    { key: 'PENDING', label: 'Pending', count: deliveryList.filter((d) => d.status === 'PENDING').length },
    { key: 'SCHEDULED', label: 'Scheduled', count: deliveryList.filter((d) => d.status === 'SCHEDULED').length },
    { key: 'DISPATCHED', label: 'In Transit', count: deliveryList.filter((d) => d.status === 'DISPATCHED').length },
    { key: 'DELIVERED', label: 'Delivered', count: deliveryList.filter((d) => d.status === 'DELIVERED').length },
  ];

  const columns: Column<Delivery>[] = [
    {
      key: 'delivery_number',
      label: 'Delivery #',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 700, color: '#0b8f08', fontFamily: 'monospace' }}>
            {row.delivery_number}
          </span>
          {row.order_number && (
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              SO: #{row.order_number}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'customer_name',
      label: 'Customer & Destination',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{row.customer_name}</div>
          <div style={{ fontSize: '12px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Phone size={11} /> {row.customer_phone}
          </div>
          <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <MapPin size={11} /> {row.delivery_address}, {row.city}
          </div>
        </div>
      ),
    },
    {
      key: 'driver_name',
      label: 'Fleet & Driver',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 500, color: row.driver_name ? '#1e293b' : '#94a3b8' }}>
            {row.driver_name || 'Unassigned'}
          </div>
          {row.vehicle_plate && (
            <span style={{ fontSize: '11px', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', border: '1px solid #e2e8f0', color: '#475569' }}>
              🚗 {row.vehicle_plate}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'scheduled_date',
      label: 'Scheduled Date',
      render: (row) => (
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>
            {row.scheduled_date ? new Date(row.scheduled_date).toLocaleDateString() : 'Immediate'}
          </div>
          {row.dispatched_at && (
            <div style={{ fontSize: '11px', color: '#0284c7' }}>
              Dispatched: {new Date(row.dispatched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'installation',
      label: 'Installation',
      render: (row) => (
        <div>
          {row.installation_required ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
              <Wrench size={11} /> ${Number(row.installation_fee).toFixed(0)} Install
            </span>
          ) : (
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>None</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' = 'neutral';
        if (row.status === 'SCHEDULED') tone = 'yellow';
        if (row.status === 'DISPATCHED') tone = 'blue';
        if (row.status === 'DELIVERED') tone = 'green';
        if (row.status === 'FAILED') tone = 'red';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleViewDetails(row)}
            title="View Details"
          >
            <Eye size={13} style={{ marginRight: '3px' }} /> View
          </button>

          {['PENDING', 'SCHEDULED'].includes(row.status) && hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleQuickDispatch(row)}
              style={{ background: '#0284c7', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              title="Quick Dispatch to Driver"
            >
              <Send size={12} /> Dispatch
            </button>
          )}

          {row.status === 'DISPATCHED' && hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleQuickComplete(row)}
              style={{ background: '#16a34a', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              title="Quick Confirm Delivered"
            >
              <CheckCheck size={12} /> Delivered
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handlePrintSlip(row)}
            title="Print Delivery Waybill"
            style={{ padding: '4px 8px' }}
          >
            <Printer size={13} />
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="module-page">
      {/* Module Header */}
      <section className="module-header">
        <div className="module-header__icon" style={{ background: '#e9f6e8', color: '#066006' }}>
          <Truck size={24} />
        </div>
        <div className="module-header__info">
          <p>Logistics & Fulfillment</p>
          <h2>Product Deliveries & Fleet Management</h2>
        </div>
        <div className="module-header__actions">
          {hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setIsCreateOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={16} /> Schedule Delivery
            </button>
          )}
        </div>
      </section>

      {/* KPI Stats Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Total Deliveries"
          value={String(stats.total)}
          trend="Total delivery waybills"
          icon={<Truck size={20} />}
        />
        <MetricCard
          label="Pending / Scheduled"
          value={String(stats.pending)}
          trend="Awaiting fleet dispatch"
          icon={<Clock size={20} />}
        />
        <MetricCard
          label="Out for Delivery"
          value={String(stats.dispatched)}
          trend="Active transit shipments"
          icon={<Send size={20} />}
        />
        <MetricCard
          label="Delivered Today"
          value={String(stats.deliveredToday)}
          trend="Successfully completed"
          icon={<CheckCircle2 size={20} />}
        />
      </section>

      {/* Tabs & Search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
        <div style={{ position: 'relative', width: '280px' }}>
          <Search size={16} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search tracking, order, customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '34px', minHeight: '36px' }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: '0', overflow: 'hidden' }}>
        <DataTable
          data={filtered}
          columns={columns}
          keyExtractor={(row) => row.id}
          emptyMessage="No delivery records found matching current criteria."
        />
      </div>

      {/* ── CREATE DELIVERY MODAL ── */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Schedule New Delivery" width="lg">
        <form onSubmit={handleCreateDelivery} style={{ display: 'grid', gap: '16px' }}>
          {/* Link to sales order */}
          <div>
            <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
              Link to Sales Order (Optional)
            </label>
            <SearchableSelect
              options={[
                { value: '', label: '— No Sales Order (Direct Delivery) —' },
                ...(Array.isArray(salesOrders) ? salesOrders : [])
                  .filter((s) => s.status !== 'DELIVERED' && s.delivery_status !== 'DELIVERED')
                  .map((s) => ({
                    value: s.id,
                    label: `${s.order_number} (${s.customer_name || 'Walk-in'} - ${s.status})`,
                  })),
              ]}
              value={createForm.salesOrderId}
              onChange={handleSelectSalesOrder}
              placeholder="Search Sales Order (undelivered only)..."
            />
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Only undelivered sales orders are listed. Delivered sales cannot have duplicate delivery registrations.
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField
              label="Customer Name *"
              id="delCustName"
              value={createForm.customerName}
              onChange={(val) => setCreateForm((p) => ({ ...p, customerName: val }))}
              placeholder="Full name..."
              required
            />
            <InputField
              label="Customer Phone *"
              id="delCustPhone"
              value={createForm.customerPhone}
              onChange={(val) => setCreateForm((p) => ({ ...p, customerPhone: val }))}
              placeholder="+252 61..."
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
            <InputField
              label="Destination Address *"
              id="delAddress"
              value={createForm.deliveryAddress}
              onChange={(val) => setCreateForm((p) => ({ ...p, deliveryAddress: val }))}
              placeholder="District, street, landmark, building..."
              required
            />
            <InputField
              label="City"
              id="delCity"
              value={createForm.city}
              onChange={(val) => setCreateForm((p) => ({ ...p, city: val }))}
              placeholder="Hargeisa"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Source Warehouse
              </label>
              <select
                className="form-input"
                value={createForm.sourceWarehouseId}
                onChange={(e) => setCreateForm((p) => ({ ...p, sourceWarehouseId: e.target.value }))}
              >
                <option value="">Central Dispatch Hub</option>
                {(Array.isArray(warehouses) ? warehouses : []).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <InputField
              label="Assigned Driver Name"
              id="delDriver"
              value={createForm.driverName}
              onChange={(val) => setCreateForm((p) => ({ ...p, driverName: val }))}
              placeholder="e.g. Mahdi Driver"
            />

            <InputField
              label="Vehicle Plate Number"
              id="delPlate"
              value={createForm.vehiclePlate}
              onChange={(val) => setCreateForm((p) => ({ ...p, vehiclePlate: val }))}
              placeholder="e.g. 48293-SL"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField
              label="Scheduled Delivery Date"
              id="delDate"
              type="date"
              value={createForm.scheduledDate}
              onChange={(val) => setCreateForm((p) => ({ ...p, scheduledDate: val }))}
            />
            <InputField
              label="Driver Contact Phone"
              id="delDriverPhone"
              value={createForm.driverPhone}
              onChange={(val) => setCreateForm((p) => ({ ...p, driverPhone: val }))}
              placeholder="Driver mobile phone..."
            />
          </div>

          {/* Installation Section */}
          <div style={{ background: createForm.installationRequired ? '#fefce8' : '#f8fafc', border: `1px solid ${createForm.installationRequired ? '#fde047' : '#e2e8f0'}`, borderRadius: '8px', padding: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', cursor: 'pointer', color: '#1e293b' }}>
              <input
                type="checkbox"
                checked={createForm.installationRequired}
                onChange={(e) => setCreateForm((p) => ({ ...p, installationRequired: e.target.checked }))}
                style={{ width: '16px', height: '16px', accentColor: '#0b8f08' }}
              />
              Include On-Site Product Installation Service
            </label>

            {createForm.installationRequired && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                <InputField
                  label="Technician / Installer Name"
                  id="delInstaller"
                  value={createForm.installerName}
                  onChange={(val) => setCreateForm((p) => ({ ...p, installerName: val }))}
                  placeholder="e.g. Ahmed Technician"
                />
                <InputField
                  label="Service Fee ($)"
                  id="delFee"
                  type="number"
                  value={String(createForm.installationFee)}
                  onChange={(val) => setCreateForm((p) => ({ ...p, installationFee: Number(val) || 0 }))}
                />
              </div>
            )}
          </div>

          <TextareaField
            label="Special Delivery Instructions / Gate Code"
            id="delNotes"
            value={createForm.notes}
            onChange={(val) => setCreateForm((p) => ({ ...p, notes: val }))}
            rows={2}
            placeholder="e.g. Call 10 minutes before arrival, building elevator on left..."
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={(e) => handleCreateDelivery(e, false)}
              disabled={submitting}
            >
              Schedule Only
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={(e) => handleCreateDelivery(e, true)}
              disabled={submitting}
              style={{ background: '#0b8f08', borderColor: '#0b8f08', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Processing…</>
              ) : (
                <><Send size={14} /> Schedule & Dispatch Now 🚚</>
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── DISPATCH MODAL ── */}
      <Modal isOpen={isDispatchOpen} onClose={() => setIsDispatchOpen(false)} title="Dispatch Delivery to Driver" width="md">
        <form onSubmit={handleConfirmDispatch} style={{ display: 'grid', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>
            Assign or confirm driver and vehicle before dispatching shipment <strong>{selectedDelivery?.delivery_number}</strong>.
          </p>

          <InputField
            label="Driver Full Name *"
            id="dispDriver"
            value={dispatchForm.driverName}
            onChange={(val) => setDispatchForm((p) => ({ ...p, driverName: val }))}
            placeholder="Driver Name..."
            required
          />

          <InputField
            label="Vehicle License Plate *"
            id="dispPlate"
            value={dispatchForm.vehiclePlate}
            onChange={(val) => setDispatchForm((p) => ({ ...p, vehiclePlate: val }))}
            placeholder="e.g. 49302-SL"
            required
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsDispatchOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ background: '#0284c7' }}>
              {submitting ? 'Dispatching…' : 'Confirm Dispatch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── COMPLETE / PROOF OF DELIVERY MODAL ── */}
      <Modal isOpen={isCompleteOpen} onClose={() => setIsCompleteOpen(false)} title="Confirm Delivery (Proof of Delivery)" width="md">
        <form onSubmit={handleConfirmComplete} style={{ display: 'grid', gap: '14px' }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '12px' }}>
            <div style={{ fontWeight: 700, color: '#166534', fontSize: '14px' }}>
              Delivery #{selectedDelivery?.delivery_number}
            </div>
            <div style={{ fontSize: '12px', color: '#15803d', marginTop: '2px' }}>
              Customer: {selectedDelivery?.customer_name} | {selectedDelivery?.customer_phone}
            </div>
          </div>

          <InputField
            label="Recipient Full Name (Customer or Authorized Receiver) *"
            id="compRecip"
            value={completeForm.recipientName}
            onChange={(val) => setCompleteForm((p) => ({ ...p, recipientName: val }))}
            placeholder="Receiver name..."
            required
          />

          <TextareaField
            label="Delivery Notes & Condition Confirmation"
            id="compNotes"
            value={completeForm.notes}
            onChange={(val) => setCompleteForm((p) => ({ ...p, notes: val }))}
            rows={2}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCompleteOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ background: '#16a34a' }}>
              {submitting ? 'Saving…' : 'Confirm & Mark Delivered'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── DETAILS MODAL ── */}
      <Modal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title={`Delivery: ${selectedDelivery?.delivery_number}`} width="lg">
        {selectedDelivery && (
          <div style={{ display: 'grid', gap: '18px' }}>
            {/* Status bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Fulfillment Status</span>
                <div style={{ marginTop: '2px' }}>
                  <StatusBadge label={selectedDelivery.status} tone={selectedDelivery.status === 'DELIVERED' ? 'green' : (selectedDelivery.status === 'DISPATCHED' ? 'blue' : 'yellow')} />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Scheduled For</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                  {selectedDelivery.scheduled_date ? new Date(selectedDelivery.scheduled_date).toLocaleDateString() : 'Immediate'}
                </div>
              </div>
            </div>

            {/* Customer & Location */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Recipient Details</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>{selectedDelivery.customer_name}</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>📞 {selectedDelivery.customer_phone}</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>📍 {selectedDelivery.delivery_address}, {selectedDelivery.city}</div>
              </div>

              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Logistics Fleet</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>
                  Driver: {selectedDelivery.driver_name || 'Pending assignment'}
                </div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                  Vehicle Plate: {selectedDelivery.vehicle_plate || '—'}
                </div>
                {selectedDelivery.driver_phone && (
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                    Driver Phone: {selectedDelivery.driver_phone}
                  </div>
                )}
              </div>
            </div>

            {/* Installation service badge if active */}
            {selectedDelivery.installation_required ? (
              <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Wrench size={20} color="#854d0e" />
                <div>
                  <div style={{ fontWeight: 700, color: '#854d0e', fontSize: '13px' }}>
                    On-Site Service Installation Included (${Number(selectedDelivery.installation_fee).toFixed(2)})
                  </div>
                  <div style={{ fontSize: '12px', color: '#713f12' }}>
                    Technician: {selectedDelivery.installer_name || 'Assigned Technician'} (Pass-through fee)
                  </div>
                </div>
              </div>
            ) : null}

            {/* Shipped Items */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006', fontSize: '14px' }}>Shipped Product Items</h4>
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Quantity</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedDelivery.items || []).map((i) => (
                    <tr key={i.id}>
                      <td><strong>{i.product_name || 'Merchandise'}</strong></td>
                      <td>{i.product_sku || '—'}</td>
                      <td><strong>{i.quantity} units</strong></td>
                      <td>{i.notes || '—'}</td>
                    </tr>
                  ))}
                  {(!selectedDelivery.items || selectedDelivery.items.length === 0) && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: '#64748b' }}>
                        Linked to Sales Order #{selectedDelivery.order_number || selectedDelivery.sales_order_id}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setIsDetailsOpen(false)}>
                Close
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => handlePrintSlip(selectedDelivery)} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Printer size={14} /> Print Waybill
              </button>
              {['PENDING', 'SCHEDULED'].includes(selectedDelivery.status) && hasPermission('manage_sales') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleQuickDispatch(selectedDelivery)}
                  style={{ background: '#0284c7', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Send size={14} /> Dispatch
                </button>
              )}
              {selectedDelivery.status === 'DISPATCHED' && hasPermission('manage_sales') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleQuickComplete(selectedDelivery)}
                  style={{ background: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <CheckCheck size={14} /> Confirm Delivered
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
