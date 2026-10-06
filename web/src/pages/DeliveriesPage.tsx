import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Truck, Plus, Search, Filter, CheckCircle2, Clock, AlertTriangle, AlertCircle,
  MapPin, Phone, User, Calendar, Eye, Send, CheckCheck, Printer,
  FileText, Wrench, ShieldCheck, ChevronRight, X, Loader2, Package
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
  branch_name?: string;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  status: 'PENDING' | 'SCHEDULED' | 'DISPATCHED' | 'PARTIALLY_DELIVERED' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
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
  total_boxes?: number;
  delivered_boxes?: number;
  remaining_boxes?: number;
  items?: DeliveryItem[];
}

interface DeliveryRun {
  id: string;
  delivery_id: string;
  run_number: number;
  boxes_delivered: number;
  run_date: string;
  handled_by: string | null;
  notes: string | null;
  created_at: string;
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
  const { hasPermission, user } = useAuth();

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
  const [customers, setCustomers] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [selectedOrderLines, setSelectedOrderLines] = useState<any[]>([]);
  const [showAddressOverride, setShowAddressOverride] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<{
    salesOrderId: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    city: string;
    branchName: string;
    driverName: string;
    driverPhone: string;
    vehiclePlate: string;
    scheduledDate: string;
    installationRequired: boolean;
    installerName: string;
    installationFee: number | string;
    totalBoxes: number | string;
    notes: string;
  }>({
    salesOrderId: '',
    customerId: '',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    city: 'Hargeisa',
    branchName: '',
    driverName: '',
    driverPhone: '',
    vehiclePlate: '',
    scheduledDate: new Date().toISOString().split('T')[0],
    installationRequired: false,
    installerName: '',
    installationFee: 40,
    totalBoxes: 1,
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Dispatch / Complete form states
  const [dispatchForm, setDispatchForm] = useState({ driverName: '', vehiclePlate: '' });
  const [completeForm, setCompleteForm] = useState({ recipientName: '', notes: '' });

  // Split Delivery Runs state
  const [isRunModalOpen, setIsRunModalOpen] = useState(false);
  const [runForm, setRunForm] = useState<{
    boxesDelivered: number | string;
    handledBy: string;
    notes: string;
  }>({
    boxesDelivered: 1,
    handledBy: '',
    notes: '',
  });
  const [runSubmitting, setRunSubmitting] = useState(false);
  const [deliveryRuns, setDeliveryRuns] = useState<DeliveryRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [delRes, statsRes] = await Promise.all([
        apiGet<Delivery[]>('/deliveries'),
        apiGet<Stats>('/deliveries/stats'),
      ]);
      setDeliveries(delRes || []);
      setStats(statsRes || { total: 0, pending: 0, dispatched: 0, deliveredToday: 0 });
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load deliveries');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Pre-load Sales Orders, Customers & Branches for creation modal
  useEffect(() => {
    async function loadAux() {
      try {
        const [ordersRes, custsRes, branchesRes] = await Promise.all([
          apiGet<any[]>('/sales/orders'),
          apiGet<any[]>('/sales/customers'),
          apiGet<any[]>('/branches'),
        ]);
        // Only orders requiring delivery should appear for delivery dispatch
        const deliveryOrders = (ordersRes || []).filter(
          (o) => (o.fulfillment_type || 'DELIVERY').toUpperCase() !== 'PICKUP'
        );
        setSalesOrders(deliveryOrders);
        setCustomers(custsRes || []);
        setBranches(branchesRes || []);

        // If URL has ?orderId=..., open create modal pre-filled
        const orderIdParam = searchParams.get('orderId');
        if (orderIdParam) {
          const rawMatch = (ordersRes || []).find((o) => o.id === orderIdParam);
          if (rawMatch && (rawMatch.fulfillment_type || 'DELIVERY').toUpperCase() === 'PICKUP') {
            addToast('info', `Order ${rawMatch.order_number} is marked as On Hand / Pickup (no delivery truck required).`);
          } else if (rawMatch) {
            if (rawMatch.status === 'DELIVERED' || rawMatch.delivery_status === 'DELIVERED') {
              addToast('info', `Order ${rawMatch.order_number} is already marked as DELIVERED.`);
              setSearchQuery(rawMatch.delivery_number || rawMatch.order_number || '');
            } else {
              handleOpenCreateWithOrder(rawMatch);
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
    setFormError(null);
    setShowAddressOverride(false);
    setSelectedOrderLines([]);
    const calculatedBoxes = Math.max(1, Number(order.total_boxes || 1));
    setCreateForm({
      salesOrderId: order.id,
      customerId: order.customer_id || '',
      customerName: order.customer_name || 'Customer',
      customerPhone: order.customer_phone || '',
      deliveryAddress: order.customer_address || '',
      city: order.customer_city || 'Hargeisa',
      branchName: order.branch_name || '',
      driverName: '',
      driverPhone: '',
      vehiclePlate: '',
      scheduledDate: new Date().toISOString().split('T')[0],
      installationRequired: Number(order.installation_fee || 0) > 0,
      installerName: order.installer_name || '',
      installationFee: Number(order.installation_fee || 40),
      totalBoxes: calculatedBoxes,
      notes: `Delivery for Sales Order #${order.order_number}`,
    });
    setIsCreateOpen(true);

    // Fetch full order lines for delivery reference
    apiGet<any>(`/sales/orders/${order.id}`).then((full) => {
      if (full?.lines && full.lines.length > 0) {
        setSelectedOrderLines(full.lines);
      }
    }).catch(() => {});
  };

  const handleSelectSalesOrder = (soId: string) => {
    setFormError(null);
    setShowAddressOverride(false);
    setSelectedOrderLines([]);
    const matched = salesOrders.find((s) => s.id === soId);
    if (!matched) {
      setCreateForm((prev) => ({
        ...prev,
        salesOrderId: '',
        customerId: '',
        customerName: '',
        customerPhone: '',
        deliveryAddress: '',
        branchName: '',
      }));
      return;
    }
    if (matched.status === 'DELIVERED' || matched.delivery_status === 'DELIVERED') {
      addToast('warning', `Order ${matched.order_number} has already been delivered and cannot be registered again.`);
      return;
    }
    const calculatedBoxes = Math.max(1, Number(matched.total_boxes || 1));
    setCreateForm((prev) => ({
      ...prev,
      salesOrderId: soId,
      customerId: matched.customer_id || '',
      customerName: matched.customer_name || 'Customer',
      customerPhone: matched.customer_phone || '',
      deliveryAddress: matched.customer_address || '',
      city: matched.customer_city || 'Hargeisa',
      branchName: matched.branch_name || '',
      totalBoxes: calculatedBoxes,
      installationRequired: Number(matched.installation_fee || 0) > 0,
      installerName: matched.installer_name || '',
      installationFee: Number(matched.installation_fee || 40),
      notes: `Delivery for Sales Order #${matched.order_number}`,
    }));

    // Fetch full order lines for delivery reference
    apiGet<any>(`/sales/orders/${soId}`).then((full) => {
      if (full?.lines && full.lines.length > 0) {
        setSelectedOrderLines(full.lines);
      }
    }).catch(() => {});
  };

  const handleSelectCustomer = (custId: string) => {
    setFormError(null);
    setShowAddressOverride(false);
    const matched = customers.find((c) => c.id === custId);
    if (!matched) {
      setCreateForm((prev) => ({
        ...prev,
        customerId: '',
        customerName: '',
        customerPhone: '',
        deliveryAddress: '',
      }));
      return;
    }
    const defaultBranch = branches.find((b) => b.id === (user as any)?.branchId) || branches[0];
    setCreateForm((prev) => ({
      ...prev,
      salesOrderId: '',
      customerId: custId,
      customerName: matched.name || 'Customer',
      customerPhone: matched.phone || '',
      deliveryAddress: matched.address || '',
      city: matched.city || 'Hargeisa',
      branchName: defaultBranch?.name || '',
      notes: `Direct delivery for ${matched.name}`,
    }));
  };

  const handleOpenCreateNew = () => {
    setFormError(null);
    setShowAddressOverride(false);
    setSelectedOrderLines([]);
    const defaultBranch = branches.find((b) => b.id === (user as any)?.branchId) || branches[0];
    setCreateForm({
      salesOrderId: '',
      customerId: '',
      customerName: '',
      customerPhone: '',
      deliveryAddress: '',
      city: 'Hargeisa',
      branchName: defaultBranch?.name || '',
      driverName: '',
      driverPhone: '',
      vehiclePlate: '',
      scheduledDate: new Date().toISOString().split('T')[0],
      installationRequired: false,
      installerName: '',
      installationFee: 40,
      totalBoxes: 1,
      notes: '',
    });
    setIsCreateOpen(true);
  };

  const handleCreateDelivery = async (e: React.FormEvent, dispatchImmediately = false) => {
    e.preventDefault();
    setFormError(null);

    if (!createForm.salesOrderId && !createForm.customerId && !createForm.customerName) {
      const msg = 'Please select a Sales Order or Customer to schedule a delivery.';
      setFormError(msg);
      addToast('error', msg);
      return;
    }

    try {
      setSubmitting(true);
      const created = await apiPost<any>('/deliveries', {
        salesOrderId: createForm.salesOrderId || undefined,
        customerId: createForm.customerId || undefined,
        customerName: createForm.customerName,
        customerPhone: createForm.customerPhone || 'N/A',
        deliveryAddress: createForm.deliveryAddress || 'Customer Location',
        city: createForm.city || 'Hargeisa',
        driverName: createForm.driverName?.trim() || undefined,
        driverPhone: createForm.driverPhone?.trim() || undefined,
        vehiclePlate: createForm.vehiclePlate?.trim() || undefined,
        scheduledDate: createForm.scheduledDate || undefined,
        installationRequired: createForm.installationRequired,
        installerName: createForm.installerName?.trim() || undefined,
        installationFee: Number(createForm.installationFee) || 0,
        totalBoxes: Math.max(1, Number(createForm.totalBoxes) || 1),
        notes: createForm.notes?.trim() || undefined,
      });

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
      const msg = err?.message || 'Failed to create delivery';
      setFormError(msg);
      addToast('error', msg);
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
      'Yes, Dispatch',
      'info'
    );
    if (!confirmed) return;
    try {
      setSubmitting(true);
      // Optimistic update
      setDeliveries((prev) =>
        prev.map((item) =>
          item.id === d.id
            ? { ...item, status: 'DISPATCHED', dispatched_at: new Date().toISOString() }
            : item
        )
      );
      setStats((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        dispatched: prev.dispatched + 1,
      }));

      await apiPost(`/deliveries/${d.id}/dispatch`, {
        driverName: d.driver_name,
        vehiclePlate: d.vehicle_plate,
      });
      addToast('success', `Delivery #${d.delivery_number} marked as DISPATCHED!`);
      if (isDetailsOpen && selectedDelivery?.id === d.id) {
        setSelectedDelivery((prev) => prev ? { ...prev, status: 'DISPATCHED', dispatched_at: new Date().toISOString() } : null);
      }
      loadData(true);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch delivery');
      loadData(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickComplete = async (d: Delivery) => {
    const confirmed = await confirmAction(
      'Confirm Delivered?',
      `Mark Delivery #${d.delivery_number} as DELIVERED to ${d.customer_name}?`,
      'Yes, Confirm Received',
      'success'
    );
    if (!confirmed) return;
    try {
      setSubmitting(true);
      // Optimistic update
      setDeliveries((prev) =>
        prev.map((item) =>
          item.id === d.id
            ? { ...item, status: 'DELIVERED', delivered_at: new Date().toISOString() }
            : item
        )
      );
      setStats((prev) => ({
        ...prev,
        dispatched: Math.max(0, prev.dispatched - 1),
        deliveredToday: prev.deliveredToday + 1,
      }));

      await apiPost(`/deliveries/${d.id}/complete`, {
        recipientSignatureName: d.customer_name,
        notes: 'Delivered in good condition and accepted by customer.',
      });
      addToast('success', `Delivery #${d.delivery_number} completed & confirmed!`);
      if (isDetailsOpen && selectedDelivery?.id === d.id) {
        setSelectedDelivery((prev) => prev ? { ...prev, status: 'DELIVERED', delivered_at: new Date().toISOString() } : null);
      }
      loadData(true);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete delivery');
      loadData(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewDetails = async (d: Delivery) => {
    try {
      setLoadingRuns(true);
      const [full, runs] = await Promise.all([
        apiGet<Delivery>(`/deliveries/${d.id}`),
        apiGet<DeliveryRun[]>(`/deliveries/${d.id}/runs`),
      ]);
      setSelectedDelivery(full || d);
      setDeliveryRuns(runs || []);
      setIsDetailsOpen(true);
    } catch {
      setSelectedDelivery(d);
      setDeliveryRuns([]);
      setIsDetailsOpen(true);
    } finally {
      setLoadingRuns(false);
    }
  };

  const handleOpenRunModal = (d: Delivery) => {
    setSelectedDelivery(d);
    const rem = d.remaining_boxes ?? Math.max(0, (d.total_boxes ?? 1) - (d.delivered_boxes ?? 0));
    setRunForm({
      boxesDelivered: rem > 0 ? rem : 1,
      handledBy: d.driver_name || '',
      notes: '',
    });
    setIsRunModalOpen(true);
  };

  const handleRecordRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDelivery) return;
    const boxes = Number(runForm.boxesDelivered);
    if (!boxes || boxes < 1) {
      addToast('error', 'Please enter a valid box quantity (at least 1).');
      return;
    }
    const rem = selectedDelivery.remaining_boxes ?? Math.max(0, (selectedDelivery.total_boxes ?? 1) - (selectedDelivery.delivered_boxes ?? 0));
    if (boxes > rem) {
      addToast('error', `Cannot dispatch ${boxes} boxes. Only ${rem} remaining.`);
      return;
    }

    try {
      setRunSubmitting(true);
      // Optimistic update
      setDeliveries((prev) =>
        prev.map((item) => {
          if (item.id !== selectedDelivery.id) return item;
          const newDelivered = (item.delivered_boxes || 0) + boxes;
          const total = item.total_boxes || 1;
          const newRemaining = Math.max(0, total - newDelivered);
          const newStatus = newRemaining === 0 ? 'DELIVERED' : 'PARTIALLY_DELIVERED';
          return {
            ...item,
            delivered_boxes: newDelivered,
            remaining_boxes: newRemaining,
            status: newStatus as any,
          };
        })
      );

      await apiPost(`/deliveries/${selectedDelivery.id}/runs`, {
        boxesDelivered: boxes,
        handledBy: runForm.handledBy?.trim() || undefined,
        notes: runForm.notes?.trim() || undefined,
      });

      addToast('success', `Delivery run recorded: ${boxes} box${boxes > 1 ? 'es' : ''} dispatched!`);
      setIsRunModalOpen(false);

      const [full, runs] = await Promise.all([
        apiGet<Delivery>(`/deliveries/${selectedDelivery.id}`),
        apiGet<DeliveryRun[]>(`/deliveries/${selectedDelivery.id}/runs`),
      ]);
      if (full) setSelectedDelivery(full);
      if (runs) setDeliveryRuns(runs);

      loadData(true);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to record delivery run');
      loadData(true);
    } finally {
      setRunSubmitting(false);
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
      const delId = selectedDelivery.id;
      // Optimistic update
      setDeliveries((prev) =>
        prev.map((item) =>
          item.id === delId
            ? {
                ...item,
                status: 'DISPATCHED',
                dispatched_at: new Date().toISOString(),
                driver_name: dispatchForm.driverName || item.driver_name,
                vehicle_plate: dispatchForm.vehiclePlate || item.vehicle_plate,
              }
            : item
        )
      );
      setStats((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        dispatched: prev.dispatched + 1,
      }));

      await apiPost(`/deliveries/${delId}/dispatch`, dispatchForm);
      addToast('success', `Delivery ${selectedDelivery.delivery_number} marked as DISPATCHED!`);
      setIsDispatchOpen(false);
      if (isDetailsOpen) {
        setSelectedDelivery((prev) => prev ? {
          ...prev,
          status: 'DISPATCHED',
          dispatched_at: new Date().toISOString(),
          driver_name: dispatchForm.driverName || prev.driver_name,
          vehicle_plate: dispatchForm.vehiclePlate || prev.vehicle_plate,
        } : null);
      }
      loadData(true);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch delivery');
      loadData(true);
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
      const delId = selectedDelivery.id;
      // Optimistic update
      setDeliveries((prev) =>
        prev.map((item) =>
          item.id === delId
            ? {
                ...item,
                status: 'DELIVERED',
                delivered_at: new Date().toISOString(),
                recipient_signature_name: completeForm.recipientName || item.customer_name,
              }
            : item
        )
      );
      setStats((prev) => ({
        ...prev,
        dispatched: Math.max(0, prev.dispatched - 1),
        deliveredToday: prev.deliveredToday + 1,
      }));

      await apiPost(`/deliveries/${delId}/complete`, {
        recipientSignatureName: completeForm.recipientName,
        notes: completeForm.notes,
      });
      addToast('success', `Delivery ${selectedDelivery.delivery_number} completed & confirmed!`);
      setIsCompleteOpen(false);
      if (isDetailsOpen) {
        setSelectedDelivery((prev) => prev ? {
          ...prev,
          status: 'DELIVERED',
          delivered_at: new Date().toISOString(),
          recipient_signature_name: completeForm.recipientName || prev.customer_name,
        } : null);
      }
      loadData(true);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete delivery');
      loadData(true);
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
            <h4>Logistics</h4>
            <div>Driver: ${d.driver_name || '—'} (${d.driver_phone || '—'})</div>
            <div>Vehicle: ${d.vehicle_plate || '—'}</div>
            <div>Scheduled: ${d.scheduled_date || 'Immediate'}</div>
          </div>
        </div>

        ${d.installation_required ? `
          <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
            <strong style="color: #854d0e;">Installation Service</strong>
            <div style="font-size: 12px; color: #713f12; margin-top: 4px;">
              Technician: ${d.installer_name || '—'} | Fee: $${Number(d.installation_fee).toFixed(2)}
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
                <td><strong>${i.product_name || '—'}</strong></td>
                <td>${i.product_sku || '—'}</td>
                <td><strong>${i.quantity}</strong></td>
                <td>${i.notes || '—'}</td>
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
    { key: 'PARTIALLY_DELIVERED', label: 'Partially Delivered', count: deliveryList.filter((d) => d.status === 'PARTIALLY_DELIVERED').length },
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
              {row.vehicle_plate}
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
      key: 'boxes',
      label: 'Box Logistics',
      render: (row) => {
        const total = row.total_boxes ?? 1;
        const delivered = row.delivered_boxes ?? 0;
        const remaining = row.remaining_boxes ?? Math.max(0, total - delivered);
        const pct = Math.min(100, Math.round((delivered / total) * 100));

        return (
          <div style={{ minWidth: '115px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 600, color: '#334155', marginBottom: '3px' }}>
              <span>{delivered} / {total} Boxes</span>
              <span style={{ color: remaining === 0 ? '#16a34a' : '#b45309' }}>
                {remaining === 0 ? 'Full' : `${remaining} left`}
              </span>
            </div>
            <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`,
                height: '100%',
                background: remaining === 0 ? '#16a34a' : '#0284c7',
                borderRadius: '3px',
                transition: 'width 0.3s ease',
              }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' = 'neutral';
        if (row.status === 'SCHEDULED') tone = 'yellow';
        if (row.status === 'PARTIALLY_DELIVERED') tone = 'yellow';
        if (row.status === 'DISPATCHED') tone = 'blue';
        if (row.status === 'DELIVERED') tone = 'green';
        if (row.status === 'FAILED') tone = 'red';
        const label = row.status === 'PARTIALLY_DELIVERED'
          ? `Partially Delivered (${row.delivered_boxes || 0}/${row.total_boxes || 1})`
          : row.status.replace('_', ' ');
        return <StatusBadge label={label} tone={tone} />;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => handleViewDetails(row)}
            title="View Details & Box Tracking"
          >
            <Eye size={13} style={{ marginRight: '3px' }} /> View
          </button>

          {row.status !== 'CANCELLED' && (row.remaining_boxes ?? 1) > 0 && hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleOpenRunModal(row)}
              style={{ background: '#f59e0b', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '11px', padding: '4px 7px', borderRadius: '6px', fontWeight: 600 }}
              title="Record Split Delivery Run (Dispatch Boxes)"
            >
              <Package size={12} /> Dispatch Boxes
            </button>
          )}

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
          <p>Logistics</p>
          <h2>Deliveries</h2>
        </div>
        <div className="module-header__actions">
          {hasPermission('manage_sales') && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleOpenCreateNew}
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
          {/* Visible Error Banner inside modal */}
          {formError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 14px',
                borderRadius: '8px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              <AlertCircle size={18} style={{ flexShrink: 0, color: '#dc2626' }} />
              <div style={{ flex: 1 }}>{formError}</div>
            </div>
          )}

          {/* Step 1: Select Order OR Customer */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <div style={{ minWidth: 0 }}>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Sales Order
              </label>
              <SearchableSelect
                options={[
                  { value: '', label: '— Select a Sales Order —' },
                  ...(Array.isArray(salesOrders) ? salesOrders : [])
                    .filter((s) => s.status !== 'DELIVERED' && s.delivery_status !== 'DELIVERED')
                    .map((s) => ({
                      value: s.id,
                      label: `${s.order_number} (${s.customer_name || 'Walk-in'} - ${s.status})`,
                    })),
                ]}
                value={createForm.salesOrderId}
                onChange={handleSelectSalesOrder}
                placeholder="Search Sales Order..."
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Customer
              </label>
              <SearchableSelect
                options={[
                  { value: '', label: '— Select Customer —' },
                  ...(Array.isArray(customers) ? customers : []).map((c) => ({
                    value: c.id,
                    label: `${c.name} ${c.phone ? `(${c.phone})` : ''}`,
                  })),
                ]}
                value={createForm.customerId}
                onChange={handleSelectCustomer}
                placeholder="Search customer..."
              />
            </div>
          </div>

          {/* Customer & Origin Branch Card */}
          {createForm.customerName || createForm.salesOrderId || createForm.customerId ? (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '14px',
                display: 'grid',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.5px' }}>
                  Customer Details
                </span>
                <button
                  type="button"
                  onClick={() => setShowAddressOverride(!showAddressOverride)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#0284c7',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '2px 6px',
                    textDecoration: 'underline',
                  }}
                >
                  {showAddressOverride ? 'Close' : 'Edit Address'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Customer</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{createForm.customerName || '—'}</div>
                  <div style={{ fontSize: '12px', color: '#475569' }}>{createForm.customerPhone || '—'}</div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Destination</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                    {createForm.deliveryAddress || '—'}, {createForm.city}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Branch</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
                    {createForm.branchName || (user as any)?.branchName || '—'}
                  </div>
                </div>
              </div>

              {showAddressOverride && (
                <div
                  style={{
                    marginTop: '4px',
                    paddingTop: '10px',
                    borderTop: '1px dashed #cbd5e1',
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr',
                    gap: '12px',
                  }}
                >
                  <InputField
                    label="Delivery Address"
                    id="delAddressOverride"
                    value={createForm.deliveryAddress}
                    onChange={(val) => setCreateForm((p) => ({ ...p, deliveryAddress: val }))}
                    placeholder="District, street, landmark, building..."
                  />
                  <InputField
                    label="City"
                    id="delCityOverride"
                    value={createForm.city}
                    onChange={(val) => setCreateForm((p) => ({ ...p, city: val }))}
                    placeholder="Hargeisa"
                  />
                </div>
              )}
            </div>
          ) : null}

          {/* Fleet & Logistics Details (All Optional) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div style={{ minWidth: 0 }}>
              <InputField
                label="Driver Name"
                id="delDriver"
                value={createForm.driverName}
                onChange={(val) => setCreateForm((p) => ({ ...p, driverName: val }))}
                placeholder="e.g. Mahdi Driver"
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <InputField
                label="Vehicle Plate"
                id="delPlate"
                value={createForm.vehiclePlate}
                onChange={(val) => setCreateForm((p) => ({ ...p, vehiclePlate: val }))}
                placeholder="e.g. 48293-SL"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div style={{ minWidth: 0 }}>
              <InputField
                label="Scheduled Date"
                id="delDate"
                type="date"
                value={createForm.scheduledDate}
                onChange={(val) => setCreateForm((p) => ({ ...p, scheduledDate: val }))}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <InputField
                label="Driver Phone"
                id="delDriverPhone"
                value={createForm.driverPhone}
                onChange={(val) => setCreateForm((p) => ({ ...p, driverPhone: val }))}
                placeholder="Driver mobile phone..."
              />
            </div>
          </div>

          {/* Installation Section (Optional) */}
          <div
            style={{
              background: createForm.installationRequired ? '#fefce8' : '#f8fafc',
              border: `1px solid ${createForm.installationRequired ? '#fde047' : '#e2e8f0'}`,
              borderRadius: '8px',
              padding: '12px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                color: '#1e293b',
              }}
            >
              <input
                type="checkbox"
                checked={createForm.installationRequired}
                onChange={(e) => setCreateForm((p) => ({ ...p, installationRequired: e.target.checked }))}
                style={{ width: '16px', height: '16px', accentColor: '#0b8f08' }}
              />
              Include Installation Service
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
                  min={0}
                  value={createForm.installationFee}
                  onChange={(val) => setCreateForm((p) => ({ ...p, installationFee: val }))}
                  onBlur={() => {
                    if (createForm.installationFee === '' || isNaN(Number(createForm.installationFee))) {
                      setCreateForm((p) => ({ ...p, installationFee: 0 }));
                    }
                  }}
                />
              </div>
            )}
          </div>

          {/* Selected Order Product Breakdown */}
          {selectedOrderLines.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: '#f8fafc', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                Order Line Items
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#475569' }}>
                    <th style={{ padding: '6px 10px' }}>Product</th>
                    <th style={{ padding: '6px 10px' }}>SKU</th>
                    <th style={{ padding: '6px 10px', textAlign: 'center' }}>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrderLines.map((line: any, idx: number) => {
                    const q = Number(line.quantity) || 1;
                    return (
                      <tr key={line.id || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600, color: '#1e293b' }}>
                          {line.product_name || 'Product'}
                        </td>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>
                          {line.product_sku || line.sku || '—'}
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600 }}>{q}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <InputField
            label="Total Delivery Boxes"
            id="delTotalBoxes"
            type="number"
            min={1}
            value={createForm.totalBoxes}
            onChange={(val) => setCreateForm((p) => ({ ...p, totalBoxes: val }))}
            onBlur={() => {
              if (!createForm.totalBoxes || Number(createForm.totalBoxes) < 1) {
                setCreateForm((p) => ({ ...p, totalBoxes: 1 }));
              }
            }}
            placeholder="1"
            required
          />

          <TextareaField
            label="Delivery Notes"
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
                <><Send size={14} /> Schedule & Dispatch</>
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
            label="Recipient Name *"
            id="compRecip"
            value={completeForm.recipientName}
            onChange={(val) => setCompleteForm((p) => ({ ...p, recipientName: val }))}
            placeholder="Receiver name..."
            required
          />

          <TextareaField
            label="Delivery Notes"
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
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Customer</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>{selectedDelivery.customer_name}</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>{selectedDelivery.customer_phone}</div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>{selectedDelivery.delivery_address}, {selectedDelivery.city}</div>
              </div>

              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Driver & Vehicle</span>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginTop: '4px' }}>
                  {selectedDelivery.driver_name || 'Unassigned'}
                </div>
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '2px' }}>
                  {selectedDelivery.vehicle_plate || '—'}
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
                    Installation — ${Number(selectedDelivery.installation_fee).toFixed(2)}
                  </div>
                  <div style={{ fontSize: '12px', color: '#713f12' }}>
                    Technician: {selectedDelivery.installer_name || '—'}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Multi-Box Logistics Summary */}
            <div style={{ background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: '8px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Package size={18} color="#0284c7" />
                  <strong style={{ color: '#0369a1', fontSize: '14px' }}>Box Delivery Tracking</strong>
                </div>
                {(selectedDelivery.remaining_boxes ?? 1) > 0 && hasPermission('manage_sales') && (
                  <button
                    type="button"
                    onClick={() => handleOpenRunModal(selectedDelivery)}
                    style={{
                      padding: '4px 10px',
                      background: '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <Package size={13} /> Dispatch Boxes
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', textAlign: 'center', marginBottom: '10px' }}>
                <div style={{ background: '#fff', padding: '10px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                  <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Total boxes</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>{selectedDelivery.total_boxes || 1}</div>
                </div>
                <div style={{ background: '#fff', padding: '10px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                  <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>Delivered boxes</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a' }}>{selectedDelivery.delivered_boxes || 0}</div>
                </div>
                <div style={{ background: '#fff', padding: '10px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                  <div style={{ fontSize: '11px', color: '#b45309', fontWeight: 600 }}>Remaining boxes</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#b45309' }}>
                    {selectedDelivery.remaining_boxes ?? Math.max(0, (selectedDelivery.total_boxes || 1) - (selectedDelivery.delivered_boxes || 0))}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{ width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, Math.round(((selectedDelivery.delivered_boxes || 0) / (selectedDelivery.total_boxes || 1)) * 100))}%`,
                  height: '100%',
                  background: (selectedDelivery.remaining_boxes ?? 1) === 0 ? '#16a34a' : '#0284c7',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>

            {/* Delivery Runs History */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={16} /> Delivery Dispatch Runs History
              </h4>
              {loadingRuns ? (
                <div style={{ fontSize: '12px', color: '#64748b' }}>Loading dispatch runs…</div>
              ) : deliveryRuns.length === 0 ? (
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '12px', color: '#64748b' }}>
                  No split delivery dispatch runs recorded yet for this order.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                      <th style={{ padding: '6px 10px', color: '#475569' }}>Run #</th>
                      <th style={{ padding: '6px 10px', color: '#475569' }}>Date & Time</th>
                      <th style={{ padding: '6px 10px', color: '#475569', textAlign: 'center' }}>Boxes Delivered</th>
                      <th style={{ padding: '6px 10px', color: '#475569' }}>Handled By</th>
                      <th style={{ padding: '6px 10px', color: '#475569' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryRuns.map((run) => (
                      <tr key={run.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: '#0284c7' }}>#{run.run_number}</td>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>{new Date(run.run_date).toLocaleString()}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: '#16a34a' }}>{run.boxes_delivered}</td>
                        <td style={{ padding: '6px 10px', color: '#334155' }}>{run.handled_by || '—'}</td>
                        <td style={{ padding: '6px 10px', color: '#64748b' }}>{run.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Shipped Items & Product Box Count Breakdown */}
            <div>
              <h4 style={{ margin: '0 0 8px', color: '#066006', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Package size={16} /> Products & Box Tracking Breakdown
              </h4>
              <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px' }}>Product</th>
                      <th style={{ padding: '8px 10px' }}>SKU</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Units Sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedDelivery.items || []).map((i: any) => {
                      return (
                        <tr key={i.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px' }}><strong>{i.product_name || 'Product'}</strong></td>
                          <td style={{ padding: '8px 10px', color: '#64748b' }}>{i.product_sku || '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>{i.quantity} units</td>
                        </tr>
                      );
                    })}
                    {(!selectedDelivery.items || selectedDelivery.items.length === 0) && (
                      <tr>
                        <td colSpan={3} style={{ textAlign: 'center', padding: '12px', color: '#64748b' }}>
                          Linked to Sales Order #{selectedDelivery.order_number || selectedDelivery.sales_order_id}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Delivery Box Status Card */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginTop: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  Delivery Box Status:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px', fontSize: '13px' }}>
                  <div><span style={{ color: '#64748b' }}>Total boxes:</span> <strong>{selectedDelivery.total_boxes || 1}</strong></div>
                  <div><span style={{ color: '#16a34a' }}>Delivered:</span> <strong style={{ color: '#16a34a' }}>{selectedDelivery.delivered_boxes || 0}</strong></div>
                  <div><span style={{ color: '#b45309' }}>Remaining:</span> <strong style={{ color: '#b45309' }}>{selectedDelivery.remaining_boxes ?? Math.max(0, (selectedDelivery.total_boxes || 1) - (selectedDelivery.delivered_boxes || 0))}</strong></div>
                </div>
              </div>
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

      {/* ── SPLIT DELIVERY DISPATCH RUN MODAL ── */}
      {(() => {
        const total = Number(selectedDelivery?.total_boxes || 1);
        const delivered = Number(selectedDelivery?.delivered_boxes || 0);
        const rem = selectedDelivery?.remaining_boxes ?? Math.max(0, total - delivered);
        const numBoxes = Number(runForm.boxesDelivered) || 0;
        const isExceeding = numBoxes > rem;

        return (
          <Modal
            isOpen={isRunModalOpen}
            onClose={() => { if (!runSubmitting) setIsRunModalOpen(false); }}
            title={`Dispatch Boxes — ${selectedDelivery?.delivery_number || ''}`}
            size="md"
          >
            <form onSubmit={handleRecordRun} style={{ display: 'grid', gap: '14px' }}>
              {/* Box Calculation Breakdown */}
              <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px', textAlign: 'center', fontSize: '12px' }}>
                  <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                    <span style={{ color: '#64748b' }}>Total boxes</span>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{total}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                    <span style={{ color: '#16a34a' }}>Delivered so far</span>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#16a34a' }}>{delivered}</div>
                  </div>
                  <div style={{ background: '#fff', padding: '8px', borderRadius: '6px', border: '1px solid #e0f2fe' }}>
                    <span style={{ color: '#b45309' }}>Remaining boxes</span>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: '#b45309' }}>{rem}</div>
                  </div>
                </div>

                {/* Live calculation preview */}
                {numBoxes > 0 && (
                  <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #bae6fd', fontSize: '12px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                    {isExceeding ? (
                      <span style={{ color: '#dc2626', fontWeight: 600 }}>
                        Cannot dispatch {numBoxes} boxes. Only {rem} available.
                      </span>
                    ) : (
                      <>
                        <span style={{ color: '#0369a1' }}>
                          After this run ({numBoxes} box{numBoxes > 1 ? 'es' : ''}):
                        </span>
                        <strong style={{ color: '#0369a1' }}>
                          Delivered: {delivered + numBoxes} | Remaining: {Math.max(0, rem - numBoxes)}
                        </strong>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div style={{ minWidth: 0 }}>
                  <InputField
                    label={`Boxes to Dispatch (Max: ${rem})`}
                    id="runBoxes"
                    type="number"
                    min={1}
                    max={rem}
                    value={runForm.boxesDelivered}
                    onChange={(val) => setRunForm((p) => ({ ...p, boxesDelivered: val }))}
                    onBlur={() => {
                      if (runForm.boxesDelivered !== '') {
                        const n = Math.max(1, Math.min(rem, Number(runForm.boxesDelivered) || 1));
                        setRunForm((p) => ({ ...p, boxesDelivered: n }));
                      }
                    }}
                    required
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <InputField
                    label="Handled / Driver By"
                    id="runDriver"
                    value={runForm.handledBy}
                    onChange={(val) => setRunForm((p) => ({ ...p, handledBy: val }))}
                    placeholder="e.g. Mahdi or Warehouse Staff"
                  />
                </div>
              </div>

              <TextareaField
                label="Run Notes"
                id="runNotes"
                value={runForm.notes}
                onChange={(val) => setRunForm((p) => ({ ...p, notes: val }))}
                rows={2}
                placeholder="e.g. Dispatched wardrobe base and side panels; mirror remaining for next run"
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsRunModalOpen(false)}
                  disabled={runSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={runSubmitting || !runForm.boxesDelivered || numBoxes < 1 || isExceeding}
                  style={{ background: '#f59e0b', borderColor: '#d97706' }}
                >
                  {runSubmitting ? (
                    <><Loader2 size={14} className="spin-icon" style={{ marginRight: '6px' }} /> Recording Dispatch…</>
                  ) : (
                    'Confirm Dispatch'
                  )}
                </button>
              </div>
            </form>
          </Modal>
        );
      })()}
    </div>
  );
}
