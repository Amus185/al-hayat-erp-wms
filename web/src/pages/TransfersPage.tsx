import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Plus, CheckCircle, ArrowRight, User, Calendar } from 'lucide-react';
import { apiGet, apiPost, apiDownload } from '../api/client';
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
  transfer_date: string | null;
  lines?: any[];
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

  // Filters & Pagination
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState('t.requested_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Detail Modal
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [selectedTransferDetails, setSelectedTransferDetails] = useState<Transfer | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const whs = await apiGet<any[]>('/warehouses');
        const brs = await apiGet<any[]>('/branches');
        setWarehouses(whs || []);
        setBranches(brs || []);
      } catch (err) {}
    }
    init();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        sort_by: sortBy,
        sort_dir: sortDir.toUpperCase(),
      });
      if (searchQuery) params.append('search', searchQuery);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (sourceId) params.append('source', sourceId);
      if (destinationId) params.append('destination', destinationId);
      let apiStatus = activeTab;
      if (activeTab === 'PENDING') apiStatus = 'PENDING_APPROVAL';
      if (activeTab && activeTab !== 'ALL') params.append('status', apiStatus);

      const res = await apiGet<any>(`/transfers?${params.toString()}`);
      setTransfers(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(loadData, 300);
    return () => clearTimeout(timeout);
  }, [page, sortBy, sortDir, searchQuery, startDate, endDate, sourceId, destinationId, activeTab]);

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (searchQuery) params.append('search', searchQuery);
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (sourceId) params.append('source', sourceId);
    if (destinationId) params.append('destination', destinationId);
    let apiStatus = activeTab;
    if (activeTab === 'PENDING') apiStatus = 'PENDING_APPROVAL';
    if (activeTab && activeTab !== 'ALL') params.append('status', apiStatus);
    params.append('sort_by', sortBy);
    params.append('sort_dir', sortDir.toUpperCase());
    params.append('export', 'csv');
    try {
      await apiDownload(`/transfers?${params.toString()}`, 'transfers.csv');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to export CSV');
    }
  };

  const handleRowClick = async (row: Transfer) => {
    setSelectedTransfer(row);
    setSelectedTransferDetails(null);
    setDetailsLoading(true);
    try {
      const data = await apiGet<Transfer>(`/transfers/${row.id}`);
      setSelectedTransferDetails(data);
    } catch (err) {
      addToast('error', 'Failed to load transfer details');
    } finally {
      setDetailsLoading(false);
    }
  };

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

  const tabItems = [
    { key: 'ALL', label: 'All Transfers' },
    { key: 'PENDING', label: 'Pending Approval' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'DISPATCHED', label: 'Dispatched' },
    { key: 'RECEIVED', label: 'Received' },
  ];

  const columns: Column<Transfer>[] = [
    { key: 'transfer_number', label: 'Transfer ID', sortable: true },
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
      sortable: true,
      render: (row) => new Date(row.requested_at).toLocaleDateString(),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
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
        <button type="button" className="btn btn-primary" onClick={() => navigate('/transfers/new')}>
          <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Transfer
        </button>
      </section>

      <section style={{ marginBottom: '14px' }}>
        <Tabs tabs={tabItems} activeTab={activeTab} onTabChange={(t: string) => { setActiveTab(t); setPage(1); }} />
      </section>

      <section className="panel" style={{ marginBottom: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Search</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '9px', color: '#9ca3af' }}>🔍</span>
            <input type="text" className="form-input" style={{ paddingLeft: '34px' }} placeholder="Transfer Number" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </div>
        <div style={{ width: '140px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Start Date</label>
          <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div style={{ width: '140px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>End Date</label>
          <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { setSearchQuery(''); setStartDate(''); setEndDate(''); setSourceId(''); setDestinationId(''); setPage(1); }}>
          Clear
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExport}>
          CSV
        </button>
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <DataTable
          columns={columns}
          data={transfers}
          keyExtractor={(row) => row.id}
          loading={loading}
          onRowClick={(row) => handleRowClick(row)}
          emptyMessage="No transfers found matching your filters"
          sortBy={sortBy === 't.requested_at' ? 'requested_at' : sortBy === 't.transfer_number' ? 'transfer_number' : 'status'}
          sortOrder={sortDir}
          onSort={(key: string) => {
            let dbKey = key;
            if (key === 'transfer_number') dbKey = 't.transfer_number';
            if (key === 'requested_at') dbKey = 't.requested_at';
            if (key === 'status') dbKey = 't.status';
            
            if (sortBy === dbKey) {
              setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
            } else {
              setSortBy(dbKey);
              setSortDir('asc');
            }
          }}
          pagination={{ page, total, limit: 50, totalPages, onPageChange: setPage }}
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

            {/* Transfer Readiness block */}
            {selectedTransfer.status === 'PENDING_APPROVAL' && (
              <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#374151' }}>Transfer Readiness</h4>
                {detailsLoading ? (
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#6b7280' }}>
                    <LoadingSpinner size={16} /> Verifying stock levels...
                  </div>
                ) : selectedTransferDetails && selectedTransferDetails.lines ? (
                  (() => {
                    const insufficientLines = selectedTransferDetails.lines.filter(l => l.quantity_requested > l.available_stock);
                    const isReady = insufficientLines.length === 0;
                    if (isReady) {
                      return (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#059669', fontSize: '12px', fontWeight: '500' }}>
                          <CheckCircle size={16} /> All items have sufficient stock available.
                        </div>
                      );
                    }
                    return (
                      <div style={{ background: '#fef2f2', border: '1px solid #f87171', borderRadius: '6px', padding: '12px' }}>
                        <div style={{ color: '#b91c1c', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
                          Insufficient stock to fulfill this transfer. The following items are short:
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '20px', color: '#991b1b', fontSize: '12px' }}>
                          {insufficientLines.map(line => (
                            <li key={line.id}>
                              <strong>{line.product_name}</strong> (Req: {line.quantity_requested}, Avail: {line.available_stock})
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            )}

            {/* Workflow Action Panel */}
            <div style={{
              marginTop: '10px',
              borderTop: '1px solid #edf1ed',
              paddingTop: '16px',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'flex-end',
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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  {(() => {
                    let isFutureDate = false;
                    if (selectedTransfer.transfer_date) {
                      const tDate = new Date(selectedTransfer.transfer_date);
                      tDate.setHours(0, 0, 0, 0);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      isFutureDate = tDate > today;
                    }
                    const canOverride = hasPermission('manage_users');
                    const isBlockedByDate = isFutureDate && !canOverride;

                    return (
                      <>
                        {isFutureDate && canOverride && (
                          <div style={{ background: '#fef3c7', color: '#b45309', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', maxWidth: '350px', textAlign: 'right' }}>
                            ⚠️ This transfer is scheduled for {new Date(selectedTransfer.transfer_date as string).toLocaleDateString()}, but as an authorized user, you may execute it early.
                          </div>
                        )}
                        {isBlockedByDate && (
                          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: '500', maxWidth: '350px', textAlign: 'right' }}>
                            Cannot approve: transfer is scheduled for {new Date(selectedTransfer.transfer_date as string).toLocaleDateString()}, which is in the future.
                          </div>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleApprove(selectedTransfer.id)}
                          disabled={actionLoading || detailsLoading || isBlockedByDate || (selectedTransferDetails?.lines?.some((l: any) => l.quantity_requested > l.available_stock))}
                        >
                          {actionLoading ? 'Processing...' : 'Approve & Execute Transfer'}
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
