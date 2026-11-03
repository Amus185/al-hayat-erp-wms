import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { apiGet, getViewBranch, invalidateApiCache, setViewBranch } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

/**
 * The Owner's branch switcher: the whole company, or one branch at a time, without
 * signing out. Only company-level people see it; a branch manager is pinned to their
 * own branch by the server and has no "all branches" choice.
 */
export function BranchSwitcher() {
  const { user, branchId } = useAuth();
  const companyLevel = !!user && !branchId && (user.role === 'admin' || user.role === 'accountant');
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const current = getViewBranch();

  useEffect(() => {
    if (!companyLevel) return;
    apiGet<any[]>('/branches').then((b) => setBranches((b || []).map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [companyLevel]);

  if (!companyLevel || branches.length === 0) return null;

  return (
    <label className={`branch-switcher${current ? ' branch-switcher--active' : ''}`} title="Choose which branch you are looking at">
      <Building2 size={15} aria-hidden="true" />
      <select
        aria-label="Branch view"
        value={current}
        onChange={(e) => {
          setViewBranch(e.target.value);
          invalidateApiCache();
          window.location.reload(); // every screen re-reads its data for the chosen branch
        }}
      >
        <option value="">All branches (company)</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
  );
}
