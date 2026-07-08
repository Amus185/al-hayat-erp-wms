import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, CheckCircle, ArrowRight, User, Calendar } from 'lucide-react';
import { apiGet, apiPatch } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { Tabs } from '../components/Tabs';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
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

  // Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await apiGet<Transfer[]>('/transfers');
      setTransfers(data || []);

      const whs = await apiGet<any[]>('/warehouses');
      const brs = await apiGet<any[]>('/branches');
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
      await apiPatch(`/transfers/${id}/approve`);
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
      await apiPatch(`/transfers/${id}/dispatch`);
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
      await apiPatch(`/transfers/${id}/receive`);
      addToast('success', 'Transfer received and stock updated');
      setSelectedTransfer(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to receive transfer');
    } finally {
      setActionLoading(false);
    }
  };

  const filteredTransfers = transfers.filter((t) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'PENDING') return t.status === 'PENDING_APPROVAL';
    return t.status === activeTab;
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
        <div>
          <p>Movement</p>
          <h2>Warehouse-to-branch and branch-to-branch stock transfers</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/transfers/new')}>
          <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Transfer
        </button>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={setActiveTab} />
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredTransfers}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => setSelectedTransfer(row)}
          emptyMessage="No stock transfers found"
        />
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
              {selectedTransfer.status === 'PENDING_APPROVAL' && hasPermission('transfers.approve') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleApprove(selectedTransfer.id)}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Approving...' : 'Approve Transfer'}
                </button>
              )}

              {/* Status APPROVED -> Dispatch */}
              {selectedTransfer.status === 'APPROVED' && hasPermission('transfers.dispatch') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleDispatch(selectedTransfer.id)}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Dispatching...' : 'Dispatch Shipment'}
                </button>
              )}

              {/* Status DISPATCHED -> Receive */}
              {selectedTransfer.status === 'DISPATCHED' && hasPermission('transfers.receive') && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleReceive(selectedTransfer.id)}
                  disabled={actionLoading}
                >
                  {actionLoading ? 'Receiving...' : 'Confirm Receipt'}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
