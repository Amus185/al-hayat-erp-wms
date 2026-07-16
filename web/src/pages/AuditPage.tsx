import { useEffect, useState } from 'react';
import { FileClock, Search, ShieldCheck, Copy, CheckCircle2, List, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { Modal } from '../components/Modal';
import { useToast } from '../contexts/ToastContext';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: any;
  new_value: any;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}

// Helper: CopyableId
function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const displayId = id.length > 12 ? `${id.substring(0, 8)}...${id.substring(id.length - 4)}` : id;
  
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontFamily: 'monospace', border: '1px solid #e2e8f0', color: '#334155' }}>
      {displayId}
      <button 
        type="button" 
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', color: copied ? '#22c55e' : '#64748b' }}
        title="Copy full ID"
      >
        {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

// Helper: Changes Table
function ChangesTable({ oldVal, newVal }: { oldVal: any, newVal: any }) {
  const [showRaw, setShowRaw] = useState(false);
  
  if (!oldVal && !newVal) return <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>No payload modifications recorded.</p>;
  
  let changes: { field: string, old: string, new: string }[] = [];
  
  let o: any = {};
  let n: any = {};
  
  try { o = typeof oldVal === 'string' ? JSON.parse(oldVal || '{}') : (oldVal || {}); } catch(e){}
  try { n = typeof newVal === 'string' ? JSON.parse(newVal || '{}') : (newVal || {}); } catch(e){}
  
  const allKeys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)]));
  
  allKeys.forEach(key => {
    if (key === 'updated_at' || key === 'created_at') return; // ignore timestamps
    const oldV = JSON.stringify(o[key]);
    const newV = JSON.stringify(n[key]);
    if (oldV !== newV) {
      changes.push({ field: key, old: oldV ?? 'null', new: newV ?? 'null' });
    }
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {changes.length > 0 ? (
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 12px', fontWeight: '600', color: '#475569' }}>Field</th>
                <th style={{ padding: '8px 12px', fontWeight: '600', color: '#475569' }}>Previous Value</th>
                <th style={{ padding: '8px 12px', fontWeight: '600', color: '#475569' }}>New Value</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={c.field} style={{ borderBottom: i === changes.length - 1 ? 'none' : '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#0f172a', fontWeight: '500' }}>{c.field}</td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8', textDecoration: c.old !== 'null' ? 'line-through' : 'none' }}>
                    {c.old}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {c.field === 'status' || c.field === 'is_active' ? (
                      <span style={{ 
                        background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '12px', fontWeight: '600', fontSize: '12px', border: '1px solid #bbf7d0' 
                      }}>
                        {c.new.replace(/"/g, '')}
                      </span>
                    ) : (
                      <span style={{ color: '#059669', fontWeight: '500' }}>{c.new}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: '13px', color: '#64748b', margin: 0, fontStyle: 'italic' }}>No field differences found (or only timestamps changed).</p>
      )}

      <div>
        <button 
          type="button" 
          onClick={() => setShowRaw(!showRaw)}
          style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#334155', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontWeight: '500' }}
        >
          {showRaw ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showRaw ? 'Hide Raw JSON' : 'View Raw JSON'}
        </button>
        {showRaw && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase' }}>Old Value</div>
              <pre style={{ margin: 0, padding: '12px', background: '#0f172a', color: '#e2e8f0', borderRadius: '8px', fontSize: '12px', overflowX: 'auto', maxHeight: '200px', border: '1px solid #334155' }}>
                {JSON.stringify(o, null, 2)}
              </pre>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', fontWeight: '600', textTransform: 'uppercase' }}>New Value</div>
              <pre style={{ margin: 0, padding: '12px', background: '#0f172a', color: '#10b981', borderRadius: '8px', fontSize: '12px', overflowX: 'auto', maxHeight: '200px', border: '1px solid #334155' }}>
                {JSON.stringify(n, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Timeline View Component
function TimelineView({ logs }: { logs: AuditLog[] }) {
  // Group by entity_id
  const groups: Record<string, AuditLog[]> = {};
  logs.forEach(log => {
    const key = log.entity_id || 'SYSTEM_EVENTS';
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  });

  // Sort groups by the most recent event
  const sortedGroups = Object.entries(groups).sort((a, b) => {
    const aMax = Math.max(...a[1].map(l => new Date(l.created_at).getTime()));
    const bMax = Math.max(...b[1].map(l => new Date(l.created_at).getTime()));
    return bMax - aMax;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {sortedGroups.map(([entityId, groupLogs]) => {
        // Sort logs chronologically ascending for timeline inside the group
        const sortedLogs = [...groupLogs].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        const entityType = groupLogs[0].entity_type;
        
        return (
          <div key={entityId} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)' }}>
            {/* Header */}
            <div style={{ background: '#f8fafc', padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: '#0f172a', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldCheck size={20} color="#059669" />
                  {entityType} Timeline
                </h3>
                <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  Reference ID: {entityId !== 'SYSTEM_EVENTS' ? <CopyableId id={entityId} /> : <span style={{ fontWeight: 500, color: '#0f172a' }}>System / Generic Event</span>}
                </div>
              </div>
              <div style={{ fontSize: '13px', color: '#334155', background: '#fff', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: '20px', fontWeight: '500', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                Audited {sortedLogs.length} time{sortedLogs.length > 1 ? 's' : ''}: {sortedLogs.map((l, i) => `${i+1}) ${l.action}`).join(', ')}
              </div>
            </div>

            {/* Timeline Body */}
            <div style={{ padding: '24px 20px 20px 36px', position: 'relative' }}>
              <div style={{ position: 'absolute', left: '26px', top: '24px', bottom: '32px', width: '2px', background: '#e2e8f0' }} />
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                {sortedLogs.map((log, i) => (
                  <div key={log.id} style={{ position: 'relative', paddingLeft: '24px' }}>
                    <div style={{ position: 'absolute', left: '-15px', top: '4px', width: '12px', height: '12px', borderRadius: '50%', background: i === sortedLogs.length - 1 ? '#059669' : '#94a3b8', border: '3px solid #fff', boxShadow: '0 0 0 2px #e2e8f0' }} />
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ fontWeight: '600', color: '#0f172a', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {log.action}
                        {i === sortedLogs.length - 1 && <span style={{ fontSize: '10px', background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: '10px', fontWeight: '700', textTransform: 'uppercase' }}>Latest</span>}
                      </div>
                      <div style={{ fontSize: '13px', color: '#64748b', fontWeight: '500' }}>{new Date(log.created_at).toLocaleString()}</div>
                    </div>
                    
                    <div style={{ fontSize: '13px', color: '#475569', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontWeight: '600', fontSize: '10px' }}>
                        {log.actor_name ? log.actor_name.substring(0, 2).toUpperCase() : 'SY'}
                      </div>
                      <span><strong>{log.actor_name || 'System Actor'}</strong> ({log.actor_email || 'automated cron'})</span>
                    </div>

                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: 'inset 0 2px 4px 0 rgba(0,0,0,0.02)' }}>
                      <ChangesTable oldVal={log.old_value} newVal={log.new_value} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      {sortedGroups.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b', background: '#fff', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
          <ShieldCheck size={48} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
          <h3 style={{ margin: '0 0 8px', color: '#334155' }}>No Audit Logs Found</h3>
          <p style={{ margin: 0 }}>There are no records matching your current filter criteria.</p>
        </div>
      )}
    </div>
  );
}


export function AuditPage() {
  const { addToast } = useToast();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [searchText, setSearchText] = useState('');
  
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedEntity) {
        params.entityType = selectedEntity;
      }
      if (searchText && searchText.trim() !== '') {
        params.search = searchText.trim();
      }
      const data = await apiGet<AuditLog[]>('/audit', params);
      setLogs(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to retrieve governance logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchLogs();
    }, 300);
    return () => clearTimeout(timer);
  }, [selectedEntity, searchText]);

  // Client-side text filter fallback
  const filteredLogs = logs.filter((log) => {
    const text = searchText.toLowerCase();
    if (!text) return true;
    return (
      log.action.toLowerCase().includes(text) ||
      log.entity_type.toLowerCase().includes(text) ||
      (log.entity_id && log.entity_id.toLowerCase().includes(text)) ||
      (log.actor_name && log.actor_name.toLowerCase().includes(text)) ||
      (log.actor_email && log.actor_email.toLowerCase().includes(text))
    );
  });

  const columns: Column<AuditLog>[] = [
    {
      key: 'created_at',
      label: 'Timestamp',
      render: (row) => new Date(row.created_at).toLocaleString(),
    },
    { key: 'actor_name', label: 'Actor', render: (row) => row.actor_name || 'System / Batch Job' },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '13px' }}>{row.action}</span>,
    },
    { key: 'entity_type', label: 'Entity Type', render: (row) => <span style={{ textTransform: 'capitalize' }}>{row.entity_type}</span> },
    { key: 'entity_id', label: 'Entity Reference ID', render: (row) => row.entity_id ? <CopyableId id={row.entity_id} /> : '—' },
    {
      key: 'details',
      label: 'Details',
      render: (row) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedLog(row);
          }}
        >
          View Changes
        </button>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <div className="module-header__icon" style={{ background: '#ecfdf5', color: '#059669' }}>
          <FileClock size={24} />
        </div>
        <div className="module-header__info">
          <p style={{ color: '#059669', fontWeight: '600' }}>Governance & Security</p>
          <h2 style={{ fontSize: '24px' }}>System Audit Trail</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '8px' }}>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            style={{ 
              background: viewMode === 'list' ? '#fff' : 'transparent', 
              color: viewMode === 'list' ? '#0f172a' : '#64748b',
              border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: '500', fontSize: '13px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <List size={16} /> Table View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('timeline')}
            style={{ 
              background: viewMode === 'timeline' ? '#fff' : 'transparent', 
              color: viewMode === 'timeline' ? '#0f172a' : '#64748b',
              border: 'none', padding: '8px 16px', borderRadius: '6px', fontWeight: '500', fontSize: '13px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '6px',
              boxShadow: viewMode === 'timeline' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
            }}
          >
            <Activity size={16} /> Grouped Timeline
          </button>
        </div>
      </section>

      {/* Filters */}
      <section className="panel" style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px', borderTop: '4px solid #10b981' }}>
        <div style={{ flex: '1', minWidth: '240px' }}>
          <SearchInput
            value={searchText}
            onChange={setSearchText}
            placeholder="Search by ID, action keyword or actor name..."
          />
        </div>
        <div>
          <select
            value={selectedEntity}
            onChange={(e) => setSelectedEntity(e.target.value)}
            className="form-select"
            style={{ minHeight: '38px', borderRadius: '8px', border: '1px solid #cbd5e1', padding: '0 12px', color: '#334155', fontWeight: '500' }}
          >
            <option value="">All Entities</option>
            <option value="users">Users</option>
            <option value="products">Products</option>
            <option value="transfers">Transfers</option>
            <option value="sales_orders">Sales Orders</option>
            <option value="purchase_orders">Purchase Orders</option>
            <option value="branches">Branches</option>
            <option value="warehouses">Warehouses</option>
          </select>
        </div>
      </section>

      {viewMode === 'list' ? (
        <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <DataTable
            columns={columns}
            data={filteredLogs}
            keyExtractor={(row) => row.id}
            loading={loading}
            emptyMessage="No security/audit logs match the current criteria"
          />
        </section>
      ) : (
        <section style={{ padding: '4px 0' }}>
          <TimelineView logs={filteredLogs} />
        </section>
      )}

      {/* Values Modal (for List View) */}
      <Modal
        isOpen={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        title={selectedLog ? `Audit Event: ${selectedLog.action}` : 'Log Values'}
        width="lg"
      >
        {selectedLog && (
          <div style={{ display: 'grid', gap: '20px' }}>
            <div style={{ fontSize: '13px', background: '#f8fafc', padding: '16px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <p style={{ margin: '0 0 6px', color: '#64748b' }}>Entity Type</p>
                <p style={{ margin: 0, fontWeight: '600', color: '#0f172a', textTransform: 'capitalize' }}>{selectedLog.entity_type}</p>
              </div>
              <div>
                <p style={{ margin: '0 0 6px', color: '#64748b' }}>Reference ID</p>
                <div style={{ margin: 0 }}>{selectedLog.entity_id ? <CopyableId id={selectedLog.entity_id} /> : 'None'}</div>
              </div>
              <div>
                <p style={{ margin: '0 0 6px', color: '#64748b' }}>Actor</p>
                <p style={{ margin: 0, fontWeight: '600', color: '#0f172a' }}>{selectedLog.actor_name || 'System'} <span style={{ fontWeight: '400', color: '#64748b' }}>({selectedLog.actor_email || 'cron'})</span></p>
              </div>
              <div>
                <p style={{ margin: '0 0 6px', color: '#64748b' }}>Timestamp</p>
                <p style={{ margin: 0, fontWeight: '600', color: '#0f172a' }}>{new Date(selectedLog.created_at).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <h4 style={{ margin: '0 0 12px', color: '#0f172a', fontSize: '15px' }}>Payload Changes</h4>
              <ChangesTable oldVal={selectedLog.old_value} newVal={selectedLog.new_value} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginTop: '8px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSelectedLog(null)}>
                Close Viewer
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
