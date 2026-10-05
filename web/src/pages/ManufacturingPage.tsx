import { useEffect, useState } from 'react';
import {
  Factory, Plus, Search, CheckCircle2, Clock, Play, CheckCheck,
  ChevronRight, ArrowRight, Layers, Package, Hammer, Award, AlertCircle,
  FileSpreadsheet, Sparkles, Loader2, Eye, ShieldCheck, Box, RefreshCw
} from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
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

interface BomItem {
  id: string;
  material_product_id: string;
  material_name?: string;
  material_sku?: string;
  quantity_required: number;
  unit_cost: number;
  scrap_percentage: number;
  current_cost_price?: number;
}

interface BOM {
  id: string;
  bom_code: string;
  name: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  labor_cost: number;
  overhead_cost: number;
  estimated_hours: number;
  components_count: number;
  raw_material_cost: number;
  items?: BomItem[];
  created_at: string;
}

interface WorkOrderStage {
  id: string;
  stage_name: string;
  sequence_order: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
}

interface WorkOrderMaterial {
  id: string;
  material_product_id: string;
  material_name: string;
  material_sku: string;
  planned_quantity: number;
  consumed_quantity: number;
  unit_cost: number;
  current_stock: number;
}

interface WorkOrder {
  id: string;
  wo_number: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  bom_id: string | null;
  warehouse_id: string;
  warehouse_name: string;
  target_quantity: number;
  completed_quantity: number;
  rejected_quantity: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  current_stage: string;
  estimated_start_date: string | null;
  target_completion_date: string | null;
  actual_start_date: string | null;
  completed_at: string | null;
  materials_cost: number;
  labor_cost: number;
  total_cost: number;
  notes: string | null;
  created_at: string;
  materials?: WorkOrderMaterial[];
  stages?: WorkOrderStage[];
}

interface Stats {
  activeWorkOrders: number;
  inProductionUnits: number;
  completedThisMonth: number;
  totalBoms: number;
}

const STAGES = [
  '1. Cutting & Material Prep',
  '2. Carpentry & Assembly',
  '3. Sanding & Finishing / Polish',
  '4. Quality Inspection & Packaging',
];

export function ManufacturingPage() {
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [topTab, setTopTab] = useState<'WORK_ORDERS' | 'BOM'>('WORK_ORDERS');
  const [woStatusFilter, setWoStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [stats, setStats] = useState<Stats>({ activeWorkOrders: 0, inProductionUnits: 0, completedThisMonth: 0, totalBoms: 0 });
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [boms, setBoms] = useState<BOM[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isCreateWoOpen, setIsCreateWoOpen] = useState(false);
  const [isCreateBomOpen, setIsCreateBomOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isCompleteOpen, setIsCompleteOpen] = useState(false);
  const [selectedWo, setSelectedWo] = useState<WorkOrder | null>(null);
  const [actionProcessing, setActionProcessing] = useState<string | null>(null);

  // Work Order Form State
  const [woMode, setWoMode] = useState<'NEW_ITEM' | 'EXISTING_PRODUCT'>('EXISTING_PRODUCT');
  const [woNewItem, setWoNewItem] = useState({
    name: '',
    sku: `MFG-${Date.now().toString().slice(-6)}`,
    categoryId: '',
    sellingPrice: 0,
    unitCost: 0,
    description: '',
  });
  const [woForm, setWoForm] = useState<{
    productId: string;
    bomId: string;
    warehouseId: string;
    targetQuantity: number;
    laborCost: number;
    estimatedStartDate: string;
    targetCompletionDate: string;
    notes: string;
    materials: { materialProductId: string; quantityRequired: number; unitCost: number }[];
  }>({
    productId: '',
    bomId: '',
    warehouseId: '',
    targetQuantity: 10,
    laborCost: 0,
    estimatedStartDate: new Date().toISOString().split('T')[0],
    targetCompletionDate: '',
    notes: '',
    materials: [],
  });

  // Complete Form State
  const [completeForm, setCompleteForm] = useState({
    completedQuantity: 0,
    rejectedQuantity: 0,
    notes: '',
  });

  // New BOM Form State
  const [bomMode, setBomMode] = useState<'NEW_ITEM' | 'EXISTING_PRODUCT'>('NEW_ITEM');
  const [bomNewItem, setBomNewItem] = useState({
    name: '',
    sku: `MFG-${Date.now().toString().slice(-6)}`,
    categoryId: '',
    sellingPrice: 0,
    unitCost: 0,
    description: '',
  });
  const [bomForm, setBomForm] = useState<{
    name: string;
    productId: string;
    bomCode: string;
    laborCost: number;
    overheadCost: number;
    estimatedHours: number;
    notes: string;
    items: { materialProductId: string; quantityRequired: number; unitCost: number; scrapPercentage: number }[];
  }>({
    name: '',
    productId: '',
    bomCode: '',
    laborCost: 50,
    overheadCost: 20,
    estimatedHours: 8,
    notes: '',
    items: [],
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsRes, woRes, bomRes, prodRes, whRes, catRes] = await Promise.all([
        apiGet<Stats>('/manufacturing/stats'),
        apiGet<WorkOrder[]>('/manufacturing/work-orders'),
        apiGet<BOM[]>('/manufacturing/boms'),
        apiGet<any[]>('/products?status=active'),
        apiGet<any[]>('/warehouses'),
        apiGet<any[]>('/products/categories').catch(() => []),
      ]);
      setStats(statsRes || { activeWorkOrders: 0, inProductionUnits: 0, completedThisMonth: 0, totalBoms: 0 });
      setWorkOrders(woRes || []);
      setBoms(bomRes || []);
      setProducts(prodRes || []);
      setWarehouses(whRes || []);
      setCategories(catRes || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to load manufacturing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Handle WO Creation
  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (woMode === 'NEW_ITEM') {
      if (!woNewItem.name.trim()) {
        addToast('error', 'Please enter a name for the new manufactured item.');
        return;
      }
    } else {
      if (!woForm.productId) {
        addToast('error', 'Please select a catalog product.');
        return;
      }
    }
    if (!woForm.warehouseId || woForm.targetQuantity <= 0) {
      addToast('error', 'Select production warehouse and valid target quantity.');
      return;
    }

    try {
      setActionProcessing('create_wo');
      const payload: any = {
        warehouseId: woForm.warehouseId,
        targetQuantity: woForm.targetQuantity,
        laborCost: woForm.laborCost,
        estimatedStartDate: woForm.estimatedStartDate,
        targetCompletionDate: woForm.targetCompletionDate,
        notes: woForm.notes,
        materials: woForm.materials,
      };

      if (woMode === 'NEW_ITEM') {
        payload.newProduct = woNewItem;
      } else {
        payload.productId = woForm.productId;
        payload.bomId = woForm.bomId || undefined;
      }

      await apiPost('/manufacturing/work-orders', payload);
      addToast('success', 'Production Work Order scheduled successfully.');
      setIsCreateWoOpen(false);
      setWoNewItem({
        name: '',
        sku: `MFG-${Date.now().toString().slice(-6)}`,
        categoryId: '',
        sellingPrice: 0,
        unitCost: 0,
        description: '',
      });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create work order');
    } finally {
      setActionProcessing(null);
    }
  };

  // Start Production Run
  const handleStartWorkOrder = async (wo: WorkOrder) => {
    const confirmed = await confirmAction(
      'Start Production Run?',
      `Starting WO #${wo.wo_number} will deduct planned raw materials from ${wo.warehouse_name} and post WIP accounting entries (DR 1070 WIP / CR 1030 Raw Materials).`,
      'Yes, Start Production',
      'info'
    );
    if (!confirmed) return;
    try {
      setActionProcessing(`start_${wo.id}`);
      await apiPost(`/manufacturing/work-orders/${wo.id}/start`, {});
      addToast('success', `Work Order #${wo.wo_number} is now IN PROGRESS!`);
      if (isDetailsOpen && selectedWo?.id === wo.id) {
        const full = await apiGet<WorkOrder>(`/manufacturing/work-orders/${wo.id}`);
        setSelectedWo(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to start work order');
    } finally {
      setActionProcessing(null);
    }
  };

  // Advance Stage
  const handleAdvanceStage = async (wo: WorkOrder) => {
    const curIdx = STAGES.findIndex((s) => s === wo.current_stage);
    const nextStage = curIdx >= 0 && curIdx < STAGES.length - 1 ? STAGES[curIdx + 1] : STAGES[STAGES.length - 1];

    try {
      setActionProcessing(`advance_${wo.id}`);
      await apiPost(`/manufacturing/work-orders/${wo.id}/advance-stage`, {
        stageName: nextStage,
        notes: `Advanced to ${nextStage}`,
      });
      addToast('success', `Moved to stage: ${nextStage}`);
      if (isDetailsOpen && selectedWo?.id === wo.id) {
        const full = await apiGet<WorkOrder>(`/manufacturing/work-orders/${wo.id}`);
        setSelectedWo(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to advance stage');
    } finally {
      setActionProcessing(null);
    }
  };

  // Quick Complete Work Order (1-Click)
  const handleQuickComplete = async (wo: WorkOrder) => {
    const confirmed = await confirmAction(
      'Complete Production Run?',
      `Complete WO #${wo.wo_number} with all ${wo.target_quantity} units deposited to ${wo.warehouse_name}?`,
      'Yes, Complete & Deposit Stock',
      'success'
    );
    if (!confirmed) return;
    try {
      setActionProcessing(`complete_${wo.id}`);
      await apiPost(`/manufacturing/work-orders/${wo.id}/complete`, {
        completedQuantity: wo.target_quantity,
        rejectedQuantity: 0,
        notes: 'Full production run completed and verified.',
      });
      addToast('success', `Production complete! ${wo.target_quantity} units deposited to inventory.`);
      if (isDetailsOpen && selectedWo?.id === wo.id) {
        const full = await apiGet<WorkOrder>(`/manufacturing/work-orders/${wo.id}`);
        if (full) setSelectedWo(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete work order');
    } finally {
      setActionProcessing(null);
    }
  };

  // Open Complete Modal
  const handleOpenComplete = (wo: WorkOrder) => {
    setSelectedWo(wo);
    setCompleteForm({
      completedQuantity: wo.target_quantity,
      rejectedQuantity: 0,
      notes: 'Completed full production run through QC standards.',
    });
    setIsCompleteOpen(true);
  };

  // Submit Complete
  const handleSubmitComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWo) return;
    if (completeForm.completedQuantity <= 0) {
      addToast('error', 'Completed quantity must be greater than 0.');
      return;
    }
    try {
      setActionProcessing('complete_wo');
      await apiPost(`/manufacturing/work-orders/${selectedWo.id}/complete`, completeForm);
      addToast('success', `Production complete! ${completeForm.completedQuantity} finished goods deposited to inventory.`);
      setIsCompleteOpen(false);
      if (isDetailsOpen) {
        const full = await apiGet<WorkOrder>(`/manufacturing/work-orders/${selectedWo.id}`);
        setSelectedWo(full);
      }
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to complete work order');
    } finally {
      setActionProcessing(null);
    }
  };

  // Open Details Modal
  const handleViewDetails = async (wo: WorkOrder) => {
    try {
      const full = await apiGet<WorkOrder>(`/manufacturing/work-orders/${wo.id}`);
      setSelectedWo(full || wo);
      setIsDetailsOpen(true);
    } catch {
      setSelectedWo(wo);
      setIsDetailsOpen(true);
    }
  };

  // Create BOM Submit
  const handleCreateBom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bomForm.name.trim()) {
      addToast('error', 'BOM blueprint name is required.');
      return;
    }
    if (bomMode === 'NEW_ITEM') {
      if (!bomNewItem.name.trim()) {
        addToast('error', 'Please specify the name of the new manufactured product.');
        return;
      }
    } else {
      if (!bomForm.productId) {
        addToast('error', 'Please select target output product.');
        return;
      }
    }
    if (bomForm.items.length === 0) {
      addToast('error', 'Please add at least one raw material component.');
      return;
    }

    try {
      setActionProcessing('create_bom');
      const payload: any = {
        name: bomForm.name,
        bomCode: bomForm.bomCode || undefined,
        laborCost: bomForm.laborCost,
        overheadCost: bomForm.overheadCost,
        estimatedHours: bomForm.estimatedHours,
        notes: bomForm.notes,
        items: bomForm.items,
      };

      if (bomMode === 'NEW_ITEM') {
        payload.newProduct = bomNewItem;
      } else {
        payload.productId = bomForm.productId;
      }

      await apiPost('/manufacturing/boms', payload);
      addToast('success', 'BOM Recipe saved successfully.');
      setIsCreateBomOpen(false);
      setBomNewItem({
        name: '',
        sku: `MFG-${Date.now().toString().slice(-6)}`,
        categoryId: '',
        sellingPrice: 0,
        unitCost: 0,
        description: '',
      });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to save BOM');
    } finally {
      setActionProcessing(null);
    }
  };

  const addBomMaterialLine = (prodId: string) => {
    const prod = products.find((p) => p.id === prodId);
    if (!prod) return;
    if (bomForm.items.some((i) => i.materialProductId === prodId)) {
      addToast('warning', 'Material already added to recipe');
      return;
    }
    setBomForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          materialProductId: prodId,
          quantityRequired: 1,
          unitCost: Number(prod.cost_price || 0),
          scrapPercentage: 5,
        },
      ],
    }));
  };

  // Filtered work orders
  const filteredWo = workOrders.filter((wo) => {
    if (woStatusFilter !== 'ALL' && wo.status !== woStatusFilter) return false;
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matchNum = wo.wo_number.toLowerCase().includes(q);
      const matchProd = wo.product_name.toLowerCase().includes(q);
      const matchSku = wo.product_sku.toLowerCase().includes(q);
      const matchWh = wo.warehouse_name.toLowerCase().includes(q);
      if (!matchNum && !matchProd && !matchSku && !matchWh) return false;
    }
    return true;
  });

  const woColumns: Column<WorkOrder>[] = [
    {
      key: 'wo_number',
      label: 'Work Order #',
      render: (row) => (
        <div>
          <span style={{ fontWeight: 800, color: '#066006', fontFamily: 'monospace' }}>
            {row.wo_number}
          </span>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            {new Date(row.created_at).toLocaleDateString()}
          </div>
        </div>
      ),
    },
    {
      key: 'product_name',
      label: 'Item Being Manufactured',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.product_name}</div>
          <div style={{ fontSize: '11px', color: '#64748b' }}>SKU: {row.product_sku}</div>
          <div style={{ fontSize: '11px', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '3px' }}>
            🏭 Facility: {row.warehouse_name}
          </div>
        </div>
      ),
    },
    {
      key: 'quantity',
      label: 'Units Target / Made',
      render: (row) => (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 800, color: row.status === 'COMPLETED' ? '#166534' : '#0f172a' }}>
            {row.completed_quantity} / {row.target_quantity} units
          </div>
          {row.rejected_quantity > 0 && (
            <div style={{ fontSize: '11px', color: '#dc2626' }}>
              {row.rejected_quantity} rejected
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'current_stage',
      label: 'Production Stage',
      render: (row) => {
        const curIdx = STAGES.findIndex((s) => s === row.current_stage);
        return (
          <div style={{ minWidth: '180px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: row.status === 'COMPLETED' ? '#166534' : '#0369a1' }}>
              {row.status === 'COMPLETED' ? 'Completed & Stocked' : row.current_stage}
            </div>
            {row.status === 'IN_PROGRESS' && (
              <div style={{ display: 'flex', gap: '3px', marginTop: '4px' }}>
                {STAGES.map((st, i) => (
                  <div
                    key={st}
                    style={{
                      height: '6px',
                      flex: 1,
                      borderRadius: '3px',
                      background: i <= curIdx ? '#0b8f08' : '#e2e8f0',
                      transition: 'background 0.3s ease',
                    }}
                    title={st}
                  />
                ))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'blue' | 'neutral' = 'neutral';
        if (row.status === 'PLANNED') tone = 'yellow';
        if (row.status === 'IN_PROGRESS') tone = 'blue';
        if (row.status === 'COMPLETED') tone = 'green';
        if (row.status === 'CANCELLED') tone = 'red';
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
            title="Inspect Work Order"
          >
            <Eye size={13} style={{ marginRight: '3px' }} /> View
          </button>

          {row.status === 'PLANNED' && hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => handleStartWorkOrder(row)}
              disabled={actionProcessing === `start_${row.id}`}
              style={{ background: '#0b8f08', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
              title="Start Production & Consume Materials"
            >
              <Play size={12} /> Start Run
            </button>
          )}

          {row.status === 'IN_PROGRESS' && hasPermission('manage_inventory') && (
            <>
              {row.current_stage !== STAGES[STAGES.length - 1] && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleAdvanceStage(row)}
                  disabled={actionProcessing === `advance_${row.id}`}
                  style={{ background: '#0284c7', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
                  title="Advance to Next Stage"
                >
                  <ArrowRight size={12} /> Next Stage
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleQuickComplete(row)}
                disabled={actionProcessing === `complete_${row.id}`}
                style={{ background: '#16a34a', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}
                title="1-Click Complete & Stock Inventory"
              >
                <CheckCheck size={12} /> Complete
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const bomColumns: Column<BOM>[] = [
    {
      key: 'bom_code',
      label: 'Recipe Code',
      render: (row) => <span style={{ fontWeight: 700, color: '#066006', fontFamily: 'monospace' }}>{row.bom_code}</span>,
    },
    {
      key: 'name',
      label: 'Recipe Name & Finished Product',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{row.name}</div>
          <div style={{ fontSize: '12px', color: '#475569' }}>Output: {row.product_name} ({row.product_sku})</div>
        </div>
      ),
    },
    {
      key: 'components',
      label: 'Components',
      render: (row) => (
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0369a1' }}>
          🧩 {row.components_count} raw materials
        </span>
      ),
    },
    {
      key: 'cost',
      label: 'Standard Unit Cost',
      render: (row) => {
        const total = Number(row.raw_material_cost || 0) + Number(row.labor_cost || 0) + Number(row.overhead_cost || 0);
        return (
          <div>
            <div style={{ fontWeight: 800, color: '#166534' }}>${total.toFixed(2)}</div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              Mat: ${Number(row.raw_material_cost).toFixed(0)} | Labor: ${Number(row.labor_cost).toFixed(0)}
            </div>
          </div>
        );
      },
    },
    {
      key: 'hours',
      label: 'Est. Hours',
      render: (row) => <span>{row.estimated_hours} hrs</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setWoForm((p) => ({ ...p, productId: row.product_id, bomId: row.id, warehouseId: warehouses[0]?.id || '' }));
            setIsCreateWoOpen(true);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          <Hammer size={12} /> Run Production
        </button>
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
          <Factory size={24} />
        </div>
        <div className="module-header__info">
          <p>Manufacturing & Production</p>
          <h2>Furniture Production & Work Orders</h2>
        </div>
        <div className="module-header__actions">
          {hasPermission('manage_inventory') && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsCreateBomOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Layers size={15} /> New BOM Recipe
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsCreateWoOpen(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
              >
                <Plus size={16} /> New Work Order
              </button>
            </div>
          )}
        </div>
      </section>

      {/* KPI Stats Grid */}
      <section className="metric-grid">
        <MetricCard
          label="Active Production Runs"
          value={String(stats.activeWorkOrders)}
          trend="Work orders in progress"
          icon={<Play size={20} />}
        />
        <MetricCard
          label="Units in Production"
          value={String(stats.inProductionUnits)}
          trend="Target manufacturing volume"
          icon={<Box size={20} />}
        />
        <MetricCard
          label="Completed This Month"
          value={String(stats.completedThisMonth)}
          trend="Finished goods output"
          icon={<CheckCircle2 size={20} />}
        />
        <MetricCard
          label="BOM Product Recipes"
          value={String(stats.totalBoms)}
          trend="Active furniture blueprints"
          icon={<Layers size={20} />}
        />
      </section>

      {/* Top Toggle: Work Orders vs Bill of Materials */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '6px', background: '#edf2ed', padding: '4px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => setTopTab('WORK_ORDERS')}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              background: topTab === 'WORK_ORDERS' ? '#ffffff' : 'transparent',
              color: topTab === 'WORK_ORDERS' ? '#066006' : '#64748b',
              boxShadow: topTab === 'WORK_ORDERS' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🔨 Production Work Orders ({workOrders.length})
          </button>
          <button
            type="button"
            onClick={() => setTopTab('BOM')}
            style={{
              padding: '6px 14px',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              background: topTab === 'BOM' ? '#ffffff' : 'transparent',
              color: topTab === 'BOM' ? '#066006' : '#64748b',
              boxShadow: topTab === 'BOM' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            🧩 Bill of Materials / Recipes ({boms.length})
          </button>
        </div>

        {topTab === 'WORK_ORDERS' && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <select
              className="form-input"
              value={woStatusFilter}
              onChange={(e) => setWoStatusFilter(e.target.value)}
              style={{ minHeight: '36px', fontSize: '13px' }}
            >
              <option value="ALL">All Statuses</option>
              <option value="PLANNED">Planned</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
            </select>

            <div style={{ position: 'relative', width: '240px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '10px', color: '#94a3b8' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search order # or product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '32px', minHeight: '36px' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Table */}
      <div className="panel" style={{ padding: '0', overflow: 'hidden' }}>
        {topTab === 'WORK_ORDERS' ? (
          <DataTable
            data={Array.isArray(filteredWo) ? filteredWo : []}
            columns={woColumns}
            keyExtractor={(row) => row.id}
            emptyMessage="No manufacturing work orders recorded yet. Click 'New Work Order' to start production."
          />
        ) : (
          <DataTable
            data={Array.isArray(boms) ? boms : []}
            columns={bomColumns}
            keyExtractor={(row) => row.id}
            emptyMessage="No Bill of Materials (BOM) recipes defined yet. Click 'New BOM Recipe' to add furniture blueprints."
          />
        )}
      </div>

      {/* ── CREATE WORK ORDER MODAL ── */}
      <Modal isOpen={isCreateWoOpen} onClose={() => setIsCreateWoOpen(false)} title="Issue Manufacturing Work Order" width="lg">
        <form onSubmit={handleCreateWorkOrder} style={{ display: 'grid', gap: '16px' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: '8px', padding: '4px', background: '#f1f5f9', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setWoMode('NEW_ITEM')}
              style={{
                flex: 1,
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                background: woMode === 'NEW_ITEM' ? '#fff' : 'transparent',
                color: woMode === 'NEW_ITEM' ? '#066006' : '#64748b',
                boxShadow: woMode === 'NEW_ITEM' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Sparkles size={15} /> ✨ Create New Manufactured Item from Scratch
            </button>
            <button
              type="button"
              onClick={() => setWoMode('EXISTING_PRODUCT')}
              style={{
                flex: 1,
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                background: woMode === 'EXISTING_PRODUCT' ? '#fff' : 'transparent',
                color: woMode === 'EXISTING_PRODUCT' ? '#0f172a' : '#64748b',
                boxShadow: woMode === 'EXISTING_PRODUCT' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Package size={15} /> 🔗 Link to Existing Catalog Product
            </button>
          </div>

          {woMode === 'NEW_ITEM' ? (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#066006', fontWeight: 700, fontSize: '13px' }}>
                <Sparkles size={15} /> New Manufactured Item Specifications
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <InputField
                  label="Manufactured Item Name *"
                  id="newWoItemName"
                  value={woNewItem.name}
                  onChange={(val) => setWoNewItem((p) => ({ ...p, name: val }))}
                  placeholder="e.g. Royal 6-Seat Mahogany Dining Table"
                  required
                />
                <InputField
                  label="Item SKU / Code *"
                  id="newWoItemSku"
                  value={woNewItem.sku}
                  onChange={(val) => setWoNewItem((p) => ({ ...p, sku: val }))}
                  placeholder="e.g. MFG-TAB-001"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                    Category
                  </label>
                  <select
                    className="form-input"
                    value={woNewItem.categoryId}
                    onChange={(e) => setWoNewItem((p) => ({ ...p, categoryId: e.target.value }))}
                  >
                    <option value="">— Select Category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <InputField
                  label="Target Selling Price ($)"
                  id="newWoSellPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(woNewItem.sellingPrice)}
                  onChange={(val) => setWoNewItem((p) => ({ ...p, sellingPrice: Number(val) || 0 }))}
                />

                <InputField
                  label="Target Estimated Cost ($)"
                  id="newWoUnitCost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(woNewItem.unitCost)}
                  onChange={(val) => setWoNewItem((p) => ({ ...p, unitCost: Number(val) || 0 }))}
                />
              </div>

              <TextareaField
                label="Manufacturing Specifications / Description"
                id="newWoItemDesc"
                value={woNewItem.description}
                onChange={(val) => setWoNewItem((p) => ({ ...p, description: val }))}
                rows={2}
                placeholder="e.g. Solid mahogany wood, clear lacquer protective coating, brass fasteners..."
              />
            </div>
          ) : (
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Choose Catalog Product (Re-manufacturing) *
              </label>
              <SearchableSelect
                options={products.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.sku}) - Current Stock: ${p.total_stock || 0}`,
                }))}
                value={woForm.productId}
                onChange={(val) => {
                  const matchedBom = boms.find((b) => b.product_id === val);
                  setWoForm((p) => ({
                    ...p,
                    productId: val,
                    bomId: matchedBom ? matchedBom.id : p.bomId,
                  }));
                }}
                placeholder="Select finished good..."
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: woMode === 'EXISTING_PRODUCT' ? '1fr 1fr' : '1fr', gap: '14px' }}>
            {woMode === 'EXISTING_PRODUCT' && (
              <div>
                <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                  BOM Recipe / Blueprint
                </label>
                <select
                  className="form-input"
                  value={woForm.bomId}
                  onChange={(e) => setWoForm((p) => ({ ...p, bomId: e.target.value }))}
                >
                  <option value="">— Select Recipe —</option>
                  {boms
                    .filter((b) => !woForm.productId || b.product_id === woForm.productId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.bom_code})
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Production Warehouse Facility *
              </label>
              <select
                className="form-input"
                value={woForm.warehouseId}
                onChange={(e) => setWoForm((p) => ({ ...p, warehouseId: e.target.value }))}
                required
              >
                <option value="">— Select Facility —</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <InputField
              label="Target Quantity (Units) *"
              id="woTargetQty"
              type="number"
              min="1"
              value={String(woForm.targetQuantity)}
              onChange={(val) => setWoForm((p) => ({ ...p, targetQuantity: Math.max(1, Number(val) || 1) }))}
              required
            />

            <InputField
              label="Estimated Labor Cost ($)"
              id="woLaborCost"
              type="number"
              min="0"
              value={String(woForm.laborCost)}
              onChange={(val) => setWoForm((p) => ({ ...p, laborCost: Number(val) || 0 }))}
            />

            <InputField
              label="Target Finish Date"
              id="woEndDate"
              type="date"
              value={woForm.targetCompletionDate}
              onChange={(val) => setWoForm((p) => ({ ...p, targetCompletionDate: val }))}
            />
          </div>

          <TextareaField
            label="Production Run Notes / Custom Specifications"
            id="woNotes"
            value={woForm.notes}
            onChange={(val) => setWoForm((p) => ({ ...p, notes: val }))}
            rows={2}
            placeholder="e.g. Walnut finish, reinforced brackets, urgent priority for retail showroom..."
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateWoOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={actionProcessing === 'create_wo'} style={{ background: '#066006' }}>
              {actionProcessing === 'create_wo' ? <><Loader2 size={14} className="spin-icon" /> Creating…</> : 'Issue Work Order'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── CREATE BOM RECIPE MODAL ── */}
      <Modal isOpen={isCreateBomOpen} onClose={() => setIsCreateBomOpen(false)} title="Create Bill of Materials (BOM Blueprint)" width="lg">
        <form onSubmit={handleCreateBom} style={{ display: 'grid', gap: '16px' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: '8px', padding: '4px', background: '#f1f5f9', borderRadius: '10px' }}>
            <button
              type="button"
              onClick={() => setBomMode('NEW_ITEM')}
              style={{
                flex: 1,
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                background: bomMode === 'NEW_ITEM' ? '#fff' : 'transparent',
                color: bomMode === 'NEW_ITEM' ? '#066006' : '#64748b',
                boxShadow: bomMode === 'NEW_ITEM' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Sparkles size={15} /> ✨ Define New Manufactured Item from Scratch
            </button>
            <button
              type="button"
              onClick={() => setBomMode('EXISTING_PRODUCT')}
              style={{
                flex: 1,
                padding: '8px 14px',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                background: bomMode === 'EXISTING_PRODUCT' ? '#fff' : 'transparent',
                color: bomMode === 'EXISTING_PRODUCT' ? '#0f172a' : '#64748b',
                boxShadow: bomMode === 'EXISTING_PRODUCT' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Package size={15} /> 🔗 Link to Existing Product
            </button>
          </div>

          <InputField
            label="Recipe / Blueprint Name *"
            id="bomName"
            value={bomForm.name}
            onChange={(val) => setBomForm((p) => ({ ...p, name: val }))}
            placeholder="e.g. Executive Wooden Dining Table 6-Seat"
            required
          />

          {bomMode === 'NEW_ITEM' ? (
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', display: 'grid', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#066006', fontWeight: 700, fontSize: '13px' }}>
                <Sparkles size={15} /> Manufactured Item Output
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <InputField
                  label="Output Item Name *"
                  id="newBomItemName"
                  value={bomNewItem.name}
                  onChange={(val) => setBomNewItem((p) => ({ ...p, name: val }))}
                  placeholder="e.g. Executive Wooden Dining Table 6-Seat"
                  required
                />
                <InputField
                  label="Item SKU / Code *"
                  id="newBomItemSku"
                  value={bomNewItem.sku}
                  onChange={(val) => setBomNewItem((p) => ({ ...p, sku: val }))}
                  placeholder="e.g. MFG-TAB-001"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                    Category
                  </label>
                  <select
                    className="form-input"
                    value={bomNewItem.categoryId}
                    onChange={(e) => setBomNewItem((p) => ({ ...p, categoryId: e.target.value }))}
                  >
                    <option value="">— Select Category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <InputField
                  label="Target Selling Price ($)"
                  id="newBomSellPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(bomNewItem.sellingPrice)}
                  onChange={(val) => setBomNewItem((p) => ({ ...p, sellingPrice: Number(val) || 0 }))}
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="form-label" style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b' }}>
                Finished Product Output *
              </label>
              <SearchableSelect
                options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                value={bomForm.productId}
                onChange={(val) => setBomForm((p) => ({ ...p, productId: val }))}
                placeholder="Select output product..."
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <InputField
              label="Labor Cost per Unit ($)"
              id="bomLabor"
              type="number"
              value={String(bomForm.laborCost)}
              onChange={(val) => setBomForm((p) => ({ ...p, laborCost: Number(val) || 0 }))}
            />

            <InputField
              label="Overhead Cost per Unit ($)"
              id="bomOverhead"
              type="number"
              value={String(bomForm.overheadCost)}
              onChange={(val) => setBomForm((p) => ({ ...p, overheadCost: Number(val) || 0 }))}
            />

            <InputField
              label="Estimated Production Hours"
              id="bomHours"
              type="number"
              value={String(bomForm.estimatedHours)}
              onChange={(val) => setBomForm((p) => ({ ...p, estimatedHours: Number(val) || 0 }))}
            />
          </div>

          {/* Raw Materials Selection */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', color: '#066006' }}>Raw Material Components</h4>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Select materials from catalog below</span>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <SearchableSelect
                options={products.map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.sku}) - Cost: $${Number(p.cost_price || 0).toFixed(2)}`,
                }))}
                value=""
                onChange={(val) => { if (val) addBomMaterialLine(val); }}
                placeholder="Search raw material / component to add..."
              />
            </div>

            {bomForm.items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '16px', background: '#f8fafc', borderRadius: '8px', color: '#64748b', fontSize: '13px' }}>
                No materials added yet. Search and select wood, fabric, screws, glue, varnish, or cushions above.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Component Name</th>
                    <th>Qty / Unit</th>
                    <th>Unit Cost ($)</th>
                    <th>Scrap %</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bomForm.items.map((item, idx) => {
                    const prod = products.find((p) => p.id === item.materialProductId);
                    return (
                      <tr key={item.materialProductId}>
                        <td><strong>{prod?.name || 'Raw Material'}</strong><br /><span style={{ fontSize: '11px', color: '#64748b' }}>{prod?.sku}</span></td>
                        <td>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={item.quantityRequired}
                            onChange={(e) => {
                              const val = Number(e.target.value) || 0;
                              setBomForm((p) => {
                                const copy = [...p.items];
                                copy[idx].quantityRequired = val;
                                return { ...p, items: copy };
                              });
                            }}
                            className="form-input"
                            style={{ width: '80px', minHeight: '30px' }}
                          />
                        </td>
                        <td>${item.unitCost.toFixed(2)}</td>
                        <td>{item.scrapPercentage}%</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setBomForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateBomOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={actionProcessing === 'create_bom'} style={{ background: '#066006' }}>
              Save BOM Recipe
            </button>
          </div>
        </form>
      </Modal>

      {/* ── COMPLETE WORK ORDER MODAL ── */}
      <Modal isOpen={isCompleteOpen} onClose={() => setIsCompleteOpen(false)} title="Finalize Work Order & Stock Finished Goods" width="md">
        <form onSubmit={handleSubmitComplete} style={{ display: 'grid', gap: '14px' }}>
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '12px' }}>
            <div style={{ fontWeight: 800, color: '#065f46', fontSize: '15px' }}>
              WO #{selectedWo?.wo_number} — {selectedWo?.product_name}
            </div>
            <div style={{ fontSize: '12px', color: '#047857', marginTop: '2px' }}>
              Target Batch: {selectedWo?.target_quantity} units | Facility: {selectedWo?.warehouse_name}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <InputField
              label="Completed & Inspected Units *"
              id="compUnits"
              type="number"
              min="1"
              value={String(completeForm.completedQuantity)}
              onChange={(val) => setCompleteForm((p) => ({ ...p, completedQuantity: Number(val) || 0 }))}
              required
            />

            <InputField
              label="Rejected / Scrap Units"
              id="rejUnits"
              type="number"
              min="0"
              value={String(completeForm.rejectedQuantity)}
              onChange={(val) => setCompleteForm((p) => ({ ...p, rejectedQuantity: Number(val) || 0 }))}
            />
          </div>

          <TextareaField
            label="Quality Notes"
            id="compNotes"
            value={completeForm.notes}
            onChange={(val) => setCompleteForm((p) => ({ ...p, notes: val }))}
            rows={2}
          />

          <div style={{ fontSize: '12px', color: '#166534', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px' }}>
            {completeForm.completedQuantity} units will be added to warehouse inventory.
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCompleteOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={actionProcessing === 'complete_wo'} style={{ background: '#16a34a' }}>
              {actionProcessing === 'complete_wo' ? 'Finalizing…' : 'Complete & Stock Inventory'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── WORK ORDER DETAILS MODAL ── */}
      <Modal isOpen={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title={`Work Order Details: ${selectedWo?.wo_number}`} width="lg">
        {selectedWo && (
          <div style={{ display: 'grid', gap: '18px' }}>
            {/* Summary card */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Finished Good</span>
                <div style={{ fontWeight: 800, fontSize: '16px', color: '#0f172a' }}>{selectedWo.product_name}</div>
                <div style={{ fontSize: '12px', color: '#475569' }}>SKU: {selectedWo.product_sku}</div>
                <div style={{ fontSize: '12px', color: '#0369a1', marginTop: '2px' }}>🏭 Facility: {selectedWo.warehouse_name}</div>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b' }}>Run Status & Units</span>
                <div style={{ marginTop: '2px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <StatusBadge label={selectedWo.status} tone={selectedWo.status === 'COMPLETED' ? 'green' : (selectedWo.status === 'IN_PROGRESS' ? 'blue' : 'yellow')} />
                  <span style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>
                    {selectedWo.completed_quantity} / {selectedWo.target_quantity} units
                  </span>
                </div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                  Current Stage: <strong style={{ color: '#0369a1' }}>{selectedWo.current_stage}</strong>
                </div>
              </div>
            </div>

            {/* Stage Stepper Visualizer */}
            <div>
              <h4 style={{ margin: '0 0 10px', fontSize: '14px', color: '#066006' }}>Production Stage Progression</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                {STAGES.map((stageName, idx) => {
                  const stageObj = (selectedWo.stages || []).find((s) => s.stage_name === stageName);
                  const isCurrent = selectedWo.current_stage === stageName && selectedWo.status === 'IN_PROGRESS';
                  const isDone = selectedWo.status === 'COMPLETED' || stageObj?.status === 'COMPLETED';

                  return (
                    <div
                      key={stageName}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: isCurrent ? '2px solid #0284c7' : (isDone ? '1px solid #86efac' : '1px solid #e2e8f0'),
                        background: isCurrent ? '#f0f9ff' : (isDone ? '#f0fdf4' : '#ffffff'),
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 800, color: isCurrent ? '#0369a1' : (isDone ? '#166534' : '#64748b') }}>
                        {isDone ? 'Completed' : (isCurrent ? 'In Progress' : 'Pending')}
                      </div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#1e293b', marginTop: '2px' }}>
                        {stageName}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Consumed Materials Table */}
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: '14px', color: '#066006' }}>Raw Material Components & Consumption</h4>
              <table>
                <thead>
                  <tr>
                    <th>Material Component</th>
                    <th>Planned Qty</th>
                    <th>Consumed Qty</th>
                    <th>Unit Cost</th>
                    <th>Current Facility Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedWo.materials || []).map((m) => (
                    <tr key={m.id}>
                      <td><strong>{m.material_name}</strong><br /><span style={{ fontSize: '11px', color: '#64748b' }}>{m.material_sku}</span></td>
                      <td><strong>{m.planned_quantity}</strong></td>
                      <td>{m.consumed_quantity}</td>
                      <td>${Number(m.unit_cost).toFixed(2)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: m.current_stock < m.planned_quantity ? '#dc2626' : '#166534' }}>
                          {m.current_stock} available
                        </span>
                      </td>
                    </tr>
                  ))}
                  {(!selectedWo.materials || selectedWo.materials.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: '#64748b' }}>
                        No BOM components mapped directly to this work order.
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

              {selectedWo.status === 'PLANNED' && hasPermission('manage_inventory') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleStartWorkOrder(selectedWo)}
                  style={{ background: '#0b8f08', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Play size={14} /> Start Production Run
                </button>
              )}

              {selectedWo.status === 'IN_PROGRESS' && hasPermission('manage_inventory') && (
                <>
                  {selectedWo.current_stage !== STAGES[STAGES.length - 1] && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleAdvanceStage(selectedWo)}
                      disabled={actionProcessing === `advance_${selectedWo.id}`}
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      <ArrowRight size={14} /> Advance Stage
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleQuickComplete(selectedWo)}
                    disabled={actionProcessing === `complete_${selectedWo.id}`}
                    style={{ background: '#16a34a', borderColor: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <CheckCheck size={14} /> Complete Run & Deposit Stock
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
