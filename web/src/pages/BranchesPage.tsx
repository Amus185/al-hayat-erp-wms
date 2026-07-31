import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Phone, ArrowRight, KeyRound, Copy, CheckCheck, RefreshCw } from 'lucide-react';
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
    try {
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

  if (loading) {
    return <PageSkeleton />;
  }

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <Building2 size={24} />
        </div>
        <div className="module-header__info">
          <p>Retail Network</p>
          <h2>Branch inventory monitoring and performance statistics</h2>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            + New Branch
          </button>
        </div>
      </section>

      {/* Create Branch Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Branch">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Branch Code *" hint="Short unique identifier, e.g. CAI, ALX">
            <input
              className="form-input"
              value={newBranch.code}
              onChange={e => setNewBranch(p => ({ ...p, code: e.target.value }))}
              placeholder="e.g. CAIRO"
              required
            />
          </FormField>
          <FormField label="Branch Name *">
            <input
              className="form-input"
              value={newBranch.name}
              onChange={e => setNewBranch(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Cairo Showroom"
              required
            />
          </FormField>
          <FormField label="City *">
            <input
              className="form-input"
              value={newBranch.city}
              onChange={e => setNewBranch(p => ({ ...p, city: e.target.value }))}
              placeholder="e.g. Cairo"
              required
            />
          </FormField>
          <FormField label="Address">
            <input
              className="form-input"
              value={newBranch.address}
              onChange={e => setNewBranch(p => ({ ...p, address: e.target.value }))}
              placeholder="Optional"
            />
          </FormField>
          <FormField label="Phone">
            <input
              className="form-input"
              value={newBranch.phone}
              onChange={e => setNewBranch(p => ({ ...p, phone: e.target.value }))}
              placeholder="Optional"
            />
          </FormField>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-warning)', background: 'var(--color-warning-bg)', padding: '10px 12px', borderRadius: '8px', margin: 0 }}>
            ⚡ A branch user account will be auto-created. <strong>The password is shown only once</strong> — save it securely.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Branch</button>
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
              <p style={{ margin: 0, fontWeight: 700, color: '#fca5a5', fontSize: '0.82rem' }}>ONE-TIME DISPLAY ONLY</p>
              <p style={{ margin: 0, color: '#fecaca', fontSize: '0.8rem', marginTop: 4 }}>
                This password will <strong>never be shown again</strong>. Copy and securely hand it to the branch manager.
              </p>
            </div>
          </div>

          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>BRANCH</p>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '1rem' }}>{credModal?.branchName}</p>
          </div>

          {/* Username row */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>USERNAME / LOGIN EMAIL</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1, background: 'var(--color-surface-2)', borderRadius: '8px',
                padding: '10px 14px', fontSize: '0.9rem', wordBreak: 'break-all',
                border: '1px solid var(--color-border)',
              }}>
                {credModal?.branchUser.username}
              </code>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => handleCopy(credModal!.branchUser.username, 'username')}
              >
                {copied === 'username' ? <CheckCheck size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </div>

          {/* Password row */}
          <div>
            <p style={{ margin: '0 0 6px', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>PASSWORD</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <code style={{
                flex: 1, background: 'var(--color-surface-2)', borderRadius: '8px',
                padding: '10px 14px', fontSize: '1rem', letterSpacing: '0.08em', wordBreak: 'break-all',
                border: '1px solid var(--color-border)', fontWeight: 700,
              }}>
                {credModal?.branchUser.rawPassword}
              </code>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flexShrink: 0 }}
                onClick={() => handleCopy(credModal!.branchUser.rawPassword, 'password')}
              >
                {copied === 'password' ? <CheckCheck size={16} /> : <Copy size={16} />}
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
        {branches.length === 0 ? (
          <div className="empty-state">
            <Building2 size={48} />
            <h3>No branches yet</h3>
            <p>Create your first branch to get started</p>
          </div>
        ) : (
          branches.map((branch) => (
            <div
              key={branch.id}
              className="card"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/branches/${branch.id}`)}
            >
              <div className="card__header">
                <div>
                  <h3 style={{ fontWeight: 700 }}>{branch.name}</h3>
                  <code style={{ fontSize: '0.75rem', opacity: 0.6 }}>{branch.code}</code>
                </div>
                <StatusBadge status={branch.is_active ? 'ACTIVE' : 'INACTIVE'} />
              </div>
              <div className="card__body">
                {branch.city && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                    <MapPin size={14} />
                    {branch.city}
                    {branch.address && ` — ${branch.address}`}
                  </p>
                )}
                {branch.phone && (
                  <p style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                    <Phone size={14} />
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
                >
                  <RefreshCw size={14} style={{ animationName: regenerating === branch.id ? 'spin' : 'none' }} />
                  {regenerating === branch.id ? 'Regenerating...' : 'Regen Creds'}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-primary)', fontSize: '0.8rem', fontWeight: 600, marginLeft: 'auto' }}>
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
