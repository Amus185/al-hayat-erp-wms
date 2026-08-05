import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Phone, ArrowRight, KeyRound, Copy, CheckCheck, RefreshCw, Search, Plus, Loader2 } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { useToast } from '../contexts/ToastContext';
import { confirmAction } from '../utils/swal';

interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

interface BranchUser {
  id: string;
  username: string;
  rawPassword: string;
}

interface CredentialInfo {
  branchName: string;
  branchUser: BranchUser;
}

export function BranchesPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newBranch, setNewBranch] = useState({ code: '', name: '', city: '', address: '', phone: '' });

  // One-time credential modal state
  const [credModal, setCredModal] = useState<CredentialInfo | null>(null);
  const [copied, setCopied] = useState<'username' | 'password' | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  async function loadBranches() {
    try {
      setLoading(true);
      const data = await apiGet<Branch[]>('/branches');
      setBranches(data || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch branch list');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBranches();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    try {
      setSubmitting(true);
      const result = await apiPost<{ branch: Branch; branchUser: BranchUser }>('/branches', newBranch);
      addToast('success', `Branch "${result.branch.name}" created`);
      setIsModalOpen(false);
      setNewBranch({ code: '', name: '', city: '', address: '', phone: '' });
      // Show credential modal — one-time only
      setCredModal({
        branchName: result.branch.name,
        branchUser: result.branchUser,
      });
      loadBranches();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create branch');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = (text: string, field: 'username' | 'password') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleRegenerateCredentials = async (branchId: string, branchName: string) => {
    const confirmed = await confirmAction(
      'Regenerate Credentials?',
      `Are you sure you want to regenerate credentials for "${branchName}"? This will immediately log out the branch user.`,
      'Yes, Regenerate',
      'warning'
    );
    if (!confirmed) return;
    setRegenerating(branchId);

    try {
      const result = await apiPost<{ branchUser: BranchUser }>(`/branches/${branchId}/regenerate-credentials`, {});
      setCredModal({ branchName, branchUser: result.branchUser });
      addToast('success', 'Credentials regenerated — all existing sessions invalidated.');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to regenerate credentials');
    } finally {
      setRegenerating(null);
    }
  };

  const filteredBranches = branches.filter((b) => {
    const q = searchQuery.toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q) ||
      (b.city && b.city.toLowerCase().includes(q))
    );
  });

  const totalBranches = branches.length;
  const activeBranches = branches.filter((b) => b.is_active).length;
  const citiesCount = new Set(branches.map((b) => b.city).filter(Boolean)).size;

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Module Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#111827' }}>Branches</h2>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '14px' }}>{branches.length} total outlets · {activeBranches} active</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: '#0b8f08', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
        >
          <Plus size={16} /> New Branch
        </button>
      </div>

      {/* KPI Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#f0fdf4', borderRadius: '8px', padding: '8px' }}><Building2 size={20} color="#0b8f08" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{totalBranches}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Network Outlets</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#eff6ff', borderRadius: '8px', padding: '8px' }}><CheckCheck size={20} color="#2563eb" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{activeBranches}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Active Outlets</div>
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: '#ede9fe', borderRadius: '8px', padding: '8px' }}><MapPin size={20} color="#7c3aed" /></div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>{citiesCount}</div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Cities Covered</div>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input
            type="text"
            placeholder="Search branches by name, code, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '9px 10px 9px 32px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{ padding: '9px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', background: '#fff', cursor: 'pointer', color: '#6b7280' }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Create Branch Modal */}
      <Modal isOpen={isModalOpen} onClose={() => !submitting && setIsModalOpen(false)} title="Create Branch">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Branch Code *" hint="Short unique identifier, e.g. CAI, HARG">
            <input
              className="form-input"
              value={newBranch.code}
              onChange={e => setNewBranch(p => ({ ...p, code: e.target.value }))}
              placeholder="e.g. CAIRO"
              required
              disabled={submitting}
            />
          </FormField>
          <FormField label="Branch Name *">
            <input
              className="form-input"
              value={newBranch.name}
              onChange={e => setNewBranch(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Cairo Showroom"
              required
              disabled={submitting}
            />
          </FormField>
          <FormField label="City *">
            <input
              className="form-input"
              value={newBranch.city}
              onChange={e => setNewBranch(p => ({ ...p, city: e.target.value }))}
              placeholder="e.g. Cairo"
              required
              disabled={submitting}
            />
          </FormField>
          <FormField label="Address">
            <input
              className="form-input"
              value={newBranch.address}
              onChange={e => setNewBranch(p => ({ ...p, address: e.target.value }))}
              placeholder="Optional"
              disabled={submitting}
            />
          </FormField>
          <FormField label="Phone">
            <input
              className="form-input"
              value={newBranch.phone}
              onChange={e => setNewBranch(p => ({ ...p, phone: e.target.value }))}
              placeholder="Optional"
              disabled={submitting}
            />
          </FormField>
          <p style={{ fontSize: '0.78rem', color: '#b45309', background: '#fef3c7', padding: '10px 12px', borderRadius: '8px', margin: 0, border: '1px solid #fde68a' }}>
            ⚡ A branch user account will be auto-created. <strong>The password is shown only once</strong> — save it securely.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)} disabled={submitting}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 size={14} className="spin-icon" /> Creating Branch…
                </>
              ) : (
                'Create Branch'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* One-Time Credential Modal */}
      <Modal
        isOpen={!!credModal}
        onClose={() => setCredModal(null)}
        title="🔐 Branch User Credentials"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
            borderRadius: '12px',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '10px',
          }}>
            <KeyRound size={18} style={{ color: '#fca5a5', flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ margin: 0, fontWeight: 700, color: '#ffffff', fontSize: '0.82rem' }}>ONE-TIME DISPLAY ONLY</p>
              <p style={{ margin: 0, color: '#fecaca', fontSize: '0.8rem', marginTop: 4 }}>
                This password will <strong>never be shown again</strong>. Copy and securely hand it to the branch manager.
              </p>
            </div>
          </div>

          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>BRANCH</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem' }}>{credModal?.branchName}</p>
          </div>

          {/* Username row */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>USERNAME / LOGIN EMAIL</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1, background: '#f8fafc', borderRadius: '8px',
                padding: '10px 14px', fontSize: '0.9rem', wordBreak: 'break-all',
                border: '1px solid #e2e8f0', color: '#0f172a', fontWeight: 600
              }}>
                {credModal?.branchUser.username}
              </code>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => handleCopy(credModal!.branchUser.username, 'username')}
              >
                {copied === 'username' ? <CheckCheck size={16} color="#0B8F08" /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Password row */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: '#64748b' }}>PASSWORD</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1, background: '#f8fafc', borderRadius: '8px',
                padding: '10px 14px', fontSize: '1rem', letterSpacing: '0.08em', wordBreak: 'break-all',
                border: '1px solid #e2e8f0', fontWeight: 700, color: '#dc2626'
              }}>
                {credModal?.branchUser.rawPassword}
              </code>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => handleCopy(credModal!.branchUser.rawPassword, 'password')}
              >
                {copied === 'password' ? <CheckCheck size={16} color="#0B8F08" /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          <button type="button" className="btn btn-primary" onClick={() => setCredModal(null)}>
            I've Saved the Credentials — Close
          </button>
        </div>
      </Modal>

      {/* Branch Cards */}
      {filteredBranches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af', background: '#fff', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <Building2 size={40} style={{ marginBottom: '12px', opacity: 0.3 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>{searchQuery ? 'No matching branches found' : 'No branches yet'}</p>
          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>{searchQuery ? 'Try adjusting your search' : 'Click "New Branch" to get started'}</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {filteredBranches.map((branch) => (
            <div
              key={branch.id}
              onClick={() => navigate(`/branches/${branch.id}`)}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                cursor: 'pointer',
                transition: 'box-shadow 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#111827' }}>{branch.name}</h3>
                    <span style={{ fontSize: '11px', background: '#f3f4f6', padding: '2px 8px', borderRadius: '6px', color: '#4b5563', fontWeight: 600, fontFamily: 'monospace' }}>{branch.code}</span>
                  </div>
                  <StatusBadge status={branch.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </div>
                {branch.city && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: '#6b7280', margin: '4px 0' }}>
                    <MapPin size={14} style={{ color: '#0b8f08', flexShrink: 0 }} />
                    <strong style={{ color: '#374151' }}>{branch.city}</strong>
                    {branch.address && ` — ${branch.address}`}
                  </p>
                )}
                {branch.phone && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: '#6b7280', margin: '4px 0' }}>
                    <Phone size={14} style={{ color: '#0b8f08', flexShrink: 0 }} />
                    {branch.phone}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #f3f4f6' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRegenerateCredentials(branch.id, branch.name);
                  }}
                  disabled={regenerating === branch.id}
                  title="Regenerate branch user login credentials"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', background: '#fff', cursor: 'pointer', color: '#4b5563' }}
                >
                  <RefreshCw size={12} className={regenerating === branch.id ? 'spin-icon' : ''} />
                  {regenerating === branch.id ? 'Regenerating…' : 'Regen Creds'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#0b8f08', fontSize: '13px', fontWeight: 600 }}>
                  View Details <ArrowRight size={14} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
