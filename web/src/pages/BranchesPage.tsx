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
    <div className="module-page">
      {/* Module Header */}
      <section className="module-header" style={{ marginBottom: '20px' }}>
        <div className="module-header__icon" style={{ background: 'var(--primary-light, #e9f6e8)', color: 'var(--primary, #0B8F08)', borderRadius: '12px', padding: '10px' }}>
          <Building2 size={28} />
        </div>
        <div className="module-header__info">
          <p style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted, #667066)', margin: 0 }}>Retail Network</p>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800 }}>Branch Inventory & Outlet Monitoring</h2>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Plus size={16} /> New Branch
          </button>
        </div>
      </section>

      {/* KPI Stats Bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: 'var(--bg-card, #ffffff)', padding: '18px 20px', borderRadius: '16px', border: '1px solid var(--border-light, #edf1ed)', boxShadow: '0 2px 8px rgba(6,96,6,0.04)' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted, #667066)', textTransform: 'uppercase' }}>Total Network Outlets</p>
          <p style={{ margin: '6px 0 0', fontSize: '1.8rem', fontWeight: 800, color: 'var(--text, #1a1a1a)' }}>{totalBranches}</p>
        </div>
        <div style={{ background: 'var(--bg-card, #ffffff)', padding: '18px 20px', borderRadius: '16px', border: '1px solid var(--border-light, #edf1ed)', boxShadow: '0 2px 8px rgba(6,96,6,0.04)' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted, #667066)', textTransform: 'uppercase' }}>Active Branches</p>
          <p style={{ margin: '6px 0 0', fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary, #0B8F08)' }}>{activeBranches}</p>
        </div>
        <div style={{ background: 'var(--bg-card, #ffffff)', padding: '18px 20px', borderRadius: '16px', border: '1px solid var(--border-light, #edf1ed)', boxShadow: '0 2px 8px rgba(6,96,6,0.04)' }}>
          <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted, #667066)', textTransform: 'uppercase' }}>Cities Covered</p>
          <p style={{ margin: '6px 0 0', fontSize: '1.8rem', fontWeight: 800, color: '#b45309' }}>{citiesCount}</p>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
          <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted, #667066)' }} />
          <input
            type="text"
            className="form-input"
            placeholder="Search branches by name, code, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '36px', width: '100%', borderRadius: '10px' }}
          />
        </div>
        {searchQuery && (
          <button type="button" className="btn btn-ghost" onClick={() => setSearchQuery('')} style={{ fontSize: '0.82rem' }}>
            Clear Search
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
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted, #667066)' }}>BRANCH</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1.05rem' }}>{credModal?.branchName}</p>
          </div>

          {/* Username row */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted, #667066)' }}>USERNAME / LOGIN EMAIL</p>
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
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted, #667066)' }}>PASSWORD</p>
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
      <div className="card-grid">
        {filteredBranches.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} style={{ opacity: 0.4 }} />
            <h3>{searchQuery ? 'No matching branches found' : 'No branches yet'}</h3>
            <p>{searchQuery ? 'Try adjusting your search query' : 'Create your first branch to get started'}</p>
          </div>
        ) : (
          filteredBranches.map((branch) => (
            <div
              key={branch.id}
              className="card"
              onClick={() => navigate(`/branches/${branch.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="card__header">
                <div>
                  <h3>{branch.name}</h3>
                  <code style={{ fontSize: '0.75rem', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', color: '#475569', fontWeight: 600 }}>{branch.code}</code>
                </div>
                <StatusBadge status={branch.is_active ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              <div className="card__body">
                {branch.city && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted, #667066)', margin: '4px 0' }}>
                    <MapPin size={14} style={{ color: 'var(--primary, #0B8F08)', flexShrink: 0 }} />
                    <strong>{branch.city}</strong>
                    {branch.address && ` — ${branch.address}`}
                  </p>
                )}
                {branch.phone && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted, #667066)', margin: '2px 0' }}>
                    <Phone size={14} style={{ color: 'var(--primary, #0B8F08)', flexShrink: 0 }} />
                    {branch.phone}
                  </p>
                )}
              </div>
              <div className="card__footer">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRegenerateCredentials(branch.id, branch.name);
                  }}
                  disabled={regenerating === branch.id}
                  title="Regenerate branch user login credentials"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem' }}
                >
                  <RefreshCw size={13} className={regenerating === branch.id ? 'spin-icon' : ''} />
                  {regenerating === branch.id ? 'Regenerating…' : 'Regen Creds'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--primary, #0B8F08)', fontSize: '0.82rem', fontWeight: 700, marginLeft: 'auto' }}>
                  View Details <ArrowRight size={14} />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
