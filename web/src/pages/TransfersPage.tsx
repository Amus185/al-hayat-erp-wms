import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, CheckCircle, ArrowRight, User, Calendar } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { KanbanBoard, type KanbanColumnDef } from '../components/KanbanBoard';
import { ViewSwitcher } from '../components/ViewSwitcher';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { FilterBar } from '../components/FilterBar';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Transfer {
  id: string;
  transfer_number: string;
  status: string;
  source_owner_type: 'WAREHOUSE' | 'BRANCH';
  source_warehouse_id: string | null;
  source_branch_id: string | null;
  destination_owner_type: 'WAREHOUSE' | 'BRANCH';
  destination_warehouse_id: string | null;
  destination_branch_id: string | null;
  requested_by: string;
  requested_at: string;
  approved_by: string | null;
  approved_at: string | null;
  dispatched_by: string | null;
  dispatched_at: string | null;
  received_by: string | null;
  received_at: string | null;
}

export function TransfersPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission, user } = useAuth();

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = async () => {
    try {
      const [data, whs, brs] = await Promise.all([
        apiGet<Transfer[]>('/transfers'),
        apiGet<any[]>('/warehouses'),
        apiGet<any[]>('/branches'),
      ]);
      setTransfers(data || []);
      setWarehouses(whs || []);
      setBranches(brs || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const getOwnerName = (ownerType: string, whId: string | null, brId: string | null) => {
    if (ownerType === 'WAREHOUSE') {
      const wh = warehouses.find((w) => w.id === whId);
      return wh ? `${wh.name} (WH)` : 'Warehouse';
    } else {
      const br = branches.find((b) => b.id === brId);
      return br ? `${br.name} (Branch)` : 'Branch';
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/approve`, {});
      addToast('success', 'Transfer approved successfully');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to approve transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDispatch = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/dispatch`, {});
      addToast('success', 'Transfer dispatched successfully');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to dispatch transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReceive = async (id: string) => {
    try {
      setActionLoading(true);
      await apiPost(`/transfers/${id}/receive`, {});
      addToast('success', 'Transfer received and stock updated');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to receive transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');

  const kanbanColumns: KanbanColumnDef[] = [
    { id: 'PENDING_APPROVAL', title: 'Pending Approval', badgeTone: 'yellow', accentColor: '#f59e0b' },
    { id: 'APPROVED', title: 'Approved', badgeTone: 'blue', accentColor: '#3b82f6' },
    { id: 'DISPATCHED', title: 'Dispatched', badgeTone: 'purple', accentColor: '#a855f7' },
    { id: 'RECEIVED', title: 'Received', badgeTone: 'green', accentColor: '#10b981' },
  ];

  const filteredTransfers = transfers.filter((t) => {
    if (viewMode === 'table' && activeTab !== 'ALL') {
      if (activeTab === 'PENDING' && t.status !== 'PENDING_APPROVAL') return false;
      else if (activeTab !== 'PENDING' && t.status !== activeTab) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const src = getOwnerName(t.source_owner_type, t.source_warehouse_id, t.source_branch_id).toLowerCase();
      const dst = getOwnerName(t.destination_owner_type, t.destination_warehouse_id, t.destination_branch_id).toLowerCase();
      if (!t.transfer_number.toLowerCase().includes(q) && !src.includes(q) && !dst.includes(q)) return false;
    }
    return true;
  });

  const tabItems = [
    { key: 'ALL', label: 'All Transfers', count: transfers.length },
    { key: 'PENDING', label: 'Pending Approval', count: transfers.filter(t => t.status === 'PENDING_APPROVAL').length },
    { key: 'APPROVED', label: 'Approved', count: transfers.filter(t => t.status === 'APPROVED').length },
    { key: 'DISPATCHED', label: 'Dispatched', count: transfers.filter(t => t.status === 'DISPATCHED').length },
    { key: 'RECEIVED', label: 'Received', count: transfers.filter(t => t.status === 'RECEIVED').length },
  ];

  const columns: Column<Transfer>[] = [
    { key: 'transfer_number', label: 'Transfer ID' },
    {
      key: 'source',
      label: 'Source',
      render: (row) => getOwnerName(row.source_owner_type, row.source_warehouse_id, row.source_branch_id),
    },
    {
      key: 'destination',
      label: 'Destination',
      render: (row) => getOwnerName(row.destination_owner_type, row.destination_warehouse_id, row.destination_branch_id),
    },
    {
      key: 'requested_at',
      label: 'Requested On',
      render: (row) => new Date(row.requested_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => {
        let tone: 'green' | 'yellow' | 'red' | 'neutral' | 'blue' = 'neutral';
        if (row.status === 'APPROVED') tone = 'green';
        if (row.status === 'PENDING_APPROVAL') tone = 'yellow';
        if (row.status === 'DISPATCHED') tone = 'blue';
        if (row.status === 'RECEIVED') tone = 'green';
        return <StatusBadge label={row.status.replace('_', ' ')} tone={tone} />;
      },
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Truck size={24} />
        </div>
        <div className="module-header__info">
          <p>Movement</p>
          <h2>Warehouse-to-branch and branch-to-branch stock transfers</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <ViewSwitcher viewMode={viewMode} onViewChange={setViewMode} />
          <button type="button" className="btn btn-primary" onClick={() => navigate('/transfers/new')}>
            <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Transfer
          </button>
        </div>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by Transfer ID, origin or destination…"
          filters={[
            {
              key: 'srcWh',
              label: 'Source Warehouse',
              options: warehouses.map((w: any) => ({ value: w.id, label: w.name })),
            },
            {
              key: 'dstBr',
              label: 'Destination Branch',
              options: branches.map((b: any) => ({ value: b.id, label: b.name })),
            },
          ]}
          filterValues={{srcWh: '', dstBr: ''}}
          onFilterChange={() => {}}
        />
        {viewMode === 'table' && (
          <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
        )}
      </section>

      <section className="panel">
        {viewMode === 'kanban' ? (
          <KanbanBoard
            columns={kanbanColumns}
            items={filteredTransfers}
            getItemStage={(t) => t.status}
            keyExtractor={(t) => t.id}
            onCardClick={(t) => setSelectedTransfer(t)}
            renderCard={(t) => (
              <>
                <div className="kanban-card__header">
                  <span className="kanban-card__id">{t.transfer_number}</span>
                  <span className="kanban-card__date">
                    {new Date(t.requested_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="kanban-card__body">
                  <span className="kanban-card__subtitle">
                    {getOwnerName(t.source_owner_type, t.source_warehouse_id, t.source_branch_id)}
                  </span>
                  <div className="kanban-card__meta" style={{ color: '#066006', fontWeight: 600 }}>
                    <ArrowRight size={12} /> {getOwnerName(t.destination_owner_type, t.destination_warehouse_id, t.destination_branch_id)}
                  </div>
                </div>
                <div className="kanban-card__footer">
                  <span className="kanban-card__meta">Req by {t.requested_by ? 'User' : 'System'}</span>
                </div>
              </>
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            data={filteredTransfers}
            keyExtractor={(row) => row.id}
            loading={loading}
            onRowClick={(row) => setSelectedTransfer(row)}
            emptyMessage="No transfers match your filters"
          />
        )}
      </section>

      {/* Detail Action Modal */}
      <Modal
        isOpen={!!selectedTransfer}
        onClose={() => setSelectedTransfer(null)}
        title={selectedTransfer ? `Transfer: ${selectedTransfer.transfer_number}` : 'Transfer Details'}
        width="md"
      >
        {selectedTransfer && (
          <div style={{ display: 'grid', gap: '20px' }}>
            {/* Source & Destination Details */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f7f9f7',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid #e1e8e1'
            }}>
              <div>
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase' }}>Source</span>
                <p style={{ margin: '4px 0 0', fontWeight: '700', color: '#066006' }}>
                  {getOwnerName(selectedTransfer.source_owner_type, selectedTransfer.source_warehouse_id, selectedTransfer.source_branch_id)}
                </p>
              </div>
              <ArrowRight size={20} style={{ color: '#0b8f08' }} />
              <div>
                <span style={{ fontSize: '11px', color: '#667066', textTransform: 'uppercase' }}>Destination</span>
                <p style={{ margin: '4px 0 0', fontWeight: '700', color: '#066006' }}>
                  {getOwnerName(selectedTransfer.destination_owner_type, selectedTransfer.destination_warehouse_id, selectedTransfer.destination_branch_id)}
                </p>
              </div>
            </div>

            {/* Timestamps and status details */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', fontSize: '13px' }}>
              <div>
                <span style={{ color: '#667066' }}>Requested At:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px', fontWeight: '600' }}>
                  <Calendar size={14} /> {new Date(selectedTransfer.requested_at).toLocaleString()}
                </div>
              </div>
              <div>
                <span style={{ color: '#667066' }}>Current Status:</span>
                <div style={{ marginTop: '2px' }}>
                  <StatusBadge
                    label={selectedTransfer.status.replace('_', ' ')}
                    tone={
                      selectedTransfer.status === 'APPROVED' || selectedTransfer.status === 'RECEIVED'
                        ? 'green'
                        : selectedTransfer.status === 'PENDING_APPROVAL'
                        ? 'yellow'
                        : 'blue'
                    }
                  />
                </div>
              </div>
            </div>

            {/* Workflow Action Panel */}
            <div style={{
              marginTop: '10px',
              borderTop: '1px solid #edf1ed',
              paddingTop: '16px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px'
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedTransfer(null)}
                disabled={actionLoading}
              >
                Close
              </button>

              {/* Status PENDING_APPROVAL -> Approve (if user has permissions) */}
              {selectedTransfer.status === 'PENDING_APPROVAL' && hasPermission('manage_transfers') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleApprove(selectedTransfer.id)}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Processing...' : 'Approve & Execute Transfer'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
