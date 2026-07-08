import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, Phone, ArrowRight } from 'lucide-react';
import { apiGet, apiPost } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import { Modal } from '../components/Modal';
import { FormField } from '../components/FormField';
import { useToast } from '../contexts/ToastContext';

interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

export function BranchesPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newBranch, setNewBranch] = useState({ code: '', name: '', city: '', address: '', phone: '' });

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
      await apiPost('/branches', newBranch);
      addToast('success', 'Branch created successfully');
      setIsModalOpen(false);
      loadBranches();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create branch');
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
        <div>
          <p>Retail Network</p>
          <h2>Branch inventory monitoring and performance statistics</h2>
        </div>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            + New Branch
          </button>
        </div>
      </section>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create Branch">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormField label="Code">
            <input type="text" className="form-input" required value={newBranch.code} onChange={e => setNewBranch({...newBranch, code: e.target.value})} />
          </FormField>
          <FormField label="Name">
            <input type="text" className="form-input" required value={newBranch.name} onChange={e => setNewBranch({...newBranch, name: e.target.value})} />
          </FormField>
          <FormField label="City">
            <input type="text" className="form-input" required value={newBranch.city} onChange={e => setNewBranch({...newBranch, city: e.target.value})} />
          </FormField>
          <FormField label="Address">
            <input type="text" className="form-input" value={newBranch.address} onChange={e => setNewBranch({...newBranch, address: e.target.value})} />
          </FormField>
          <FormField label="Phone">
            <input type="text" className="form-input" value={newBranch.phone} onChange={e => setNewBranch({...newBranch, phone: e.target.value})} />
          </FormField>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      </Modal>

      {/* Grid of branches */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '16px'
      }}>
        {branches.map((b) => (
          <div key={b.id} className="panel" style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '16px',
            minHeight: '160px'
          }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <span style={{ fontSize: '11px', color: '#667066', fontWeight: '800' }}>{b.code}</span>
                  <h3 style={{ margin: '2px 0 0', fontSize: '16px', color: '#066006' }}>{b.name}</h3>
                </div>
                <StatusBadge label={b.is_active ? 'Active' : 'Inactive'} tone={b.is_active ? 'green' : 'neutral'} />
              </div>
              <div style={{ fontSize: '13px', color: '#667066', display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '10px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <MapPin size={12} /> {b.city} {b.address ? `— ${b.address}` : ''}
                </span>
                {b.phone && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Phone size={12} /> {b.phone}
                  </span>
                )}
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              borderTop: '1px solid #edf1ed',
              paddingTop: '12px',
              marginTop: '12px'
            }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/branches/${b.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                View Analytics <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
