import { forgetMoneyAccountOptions } from './MoneyAccountSelect';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Building2, Landmark, Plus, Smartphone } from 'lucide-react';
import { apiGet, apiPatch, apiPost } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

type Kind = 'BANK' | 'MOBILE_MONEY' | 'CASH';
interface Account {
  id: string; name: string; kind: Kind; provider: string | null; account_number: string | null; account_holder: string | null;
  currency: string; account_code: string; branch_id: string | null; branch_name: string | null; is_active: number;
  balance: number; last_movement: string | null; notes: string | null;
}
interface Line { entry_date: string; description: string; money_in: number; money_out: number; balance: number; entry_number: string; reference_type: string; branch_name: string | null }

const KIND_LABEL: Record<Kind, string> = { BANK: 'Bank', MOBILE_MONEY: 'Mobile money / transfer', CASH: 'Cash' };
const KIND_ICON: Record<Kind, typeof Landmark> = { BANK: Landmark, MOBILE_MONEY: Smartphone, CASH: Banknote };
const OTHER = '__other';
const money = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { kind: 'BANK' as Kind, provider: '', otherProvider: '', name: '', account_number: '', account_holder: '', branchId: '', openingAmount: '', openingSource: 'NEW_MONEY', openingDate: today(), notes: '' };

/**
 * Accounting → Bank & Cash (like Odoo's Bank and Cash journals). Each account is its own ledger
 * account under Cash; balances and statements come from the ledger.
 */
export function MoneyAccountsPanel() {
  const { addToast } = useToast();
  const { branchId: myBranch } = useAuth();
  const canManage = !myBranch; // Owner / accountants (company view)
  const [data, setData] = useState<{ accounts: Account[]; total: number; byKind: Record<Kind, number> } | null>(null);
  const [providers, setProviders] = useState<Record<Kind, string[]>>({ BANK: [], MOBILE_MONEY: [], CASH: [] });
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [moveOpen, setMoveOpen] = useState(false);
  const [move, setMove] = useState({ fromId: '', toId: '', amount: '', date: today(), note: '' });
  const [busy, setBusy] = useState(false);
  const [statementOf, setStatementOf] = useState<Account | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = () => { forgetMoneyAccountOptions(); return apiGet<any>('/accounting/money-accounts').then(setData).catch((e) => { addToast('error', e?.message); setData({ accounts: [], total: 0, byKind: { BANK: 0, MOBILE_MONEY: 0, CASH: 0 } }); }); };
  useEffect(() => {
    load();
    apiGet<any>('/accounting/money-accounts/providers').then((p) => setProviders(p.providers)).catch(() => {});
    if (canManage) apiGet<any[]>('/branches').then((b) => setBranches((b || []).map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useMemo(() => (data?.accounts || []).filter((a) => Number(a.is_active) === 1), [data]);
  const shown = (data?.accounts || []).filter((a) => showClosed || Number(a.is_active) === 1);
  const set = (k: keyof typeof EMPTY) => ({ value: form[k] as string, onChange: (e: any) => setForm((p) => ({ ...p, [k]: e.target.value })) });
  const providerName = form.provider === OTHER ? form.otherProvider.trim() : form.provider;

  const openStatement = (a: Account) => {
    setStatementOf(a); setLines(null);
    apiGet<any>(`/accounting/money-accounts/${a.id}/statement`).then((r) => setLines((r.lines || []).map((l: Line, i: number) => ({ ...l, _i: i })))).catch((e) => { addToast('error', e?.message); setLines([]); });
  };

  const create = async () => {
    if (!providerName) { addToast('error', 'Choose the bank or provider (or "Other" and type its name).'); return; }
    const amount = Number(form.openingAmount || 0);
    if (amount < 0 || !Number.isFinite(amount)) { addToast('error', 'The opening balance must be 0 or more.'); return; }
    setBusy(true);
    try {
      const made: any = await apiPost('/accounting/money-accounts', {
        kind: form.kind, provider: providerName, name: form.name.trim() || providerName,
        account_number: form.account_number, account_holder: form.account_holder, branchId: form.branchId || null, notes: form.notes,
        opening: amount > 0 ? { amount, source: form.openingSource, date: form.openingDate } : undefined,
      });
      addToast('success', `${made.name} registered (${made.account_code}). Balance ${money(made.balance)}.`);
      setNewOpen(false); setForm(EMPTY); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };

  const doMove = async () => {
    const amount = Number(move.amount);
    if (!move.fromId || !move.toId || move.fromId === move.toId) { addToast('error', 'Choose two different accounts.'); return; }
    if (!(amount > 0)) { addToast('error', 'Enter an amount above 0.'); return; }
    setBusy(true);
    try {
      const r: any = await apiPost('/accounting/money-accounts/transfer', { ...move, amount });
      addToast('success', `${money(r.amount)} moved from ${r.from} to ${r.to}.`);
      setMoveOpen(false); setMove({ fromId: '', toId: '', amount: '', date: today(), note: '' }); load();
    } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };

  const toggleActive = async (a: Account) => {
    try { await apiPatch(`/accounting/money-accounts/${a.id}`, { is_active: Number(a.is_active) !== 1 }); load(); } catch (e: any) { addToast('error', e?.message); }
  };

  const lineCols: Column<Line>[] = [
    { key: 'entry_date', label: 'Date', render: (l) => new Date(l.entry_date).toLocaleDateString() },
    { key: 'description', label: 'What', render: (l) => <span>{l.description}<span className="mm-sub">{l.entry_number}{l.branch_name ? ` · ${l.branch_name}` : ''}</span></span> },
    { key: 'money_in', label: 'In', render: (l) => l.money_in > 0 ? <strong style={{ color: '#15803d' }}>{money(l.money_in)}</strong> : '—' },
    { key: 'money_out', label: 'Out', render: (l) => l.money_out > 0 ? <strong style={{ color: '#b91c1c' }}>{money(l.money_out)}</strong> : '—' },
    { key: 'balance', label: 'Balance', render: (l) => <strong>{money(l.balance)}</strong> },
  ];

  return (
    <div id="money-accounts">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0 }}>Bank &amp; Cash</h3>
          <span className="mm-sub" style={{ display: 'block' }}>Every bank, ZAAD / eDahab / Dahabshiil and cash account, with its balance from the books.</span>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" id="move-money" onClick={() => setMoveOpen(true)} disabled={active.length < 2}><ArrowLeftRight size={15} /> Move money</button>
            <button type="button" className="btn btn-primary" id="new-money-account" onClick={() => { setForm(EMPTY); setNewOpen(true); }}><Plus size={16} /> New account</button>
          </div>
        )}
      </div>

      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[['All money', data.total], ['Banks', data.byKind.BANK], ['Mobile money / transfer', data.byKind.MOBILE_MONEY], ['Cash', data.byKind.CASH]].map(([label, v]) => (
              <div key={label as string} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}>
                <div className="mm-sub" style={{ display: 'block' }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: Number(v) < 0 ? '#b91c1c' : '#0f172a' }}>{money(Number(v))}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {shown.map((a) => {
              const Icon = KIND_ICON[a.kind] || Banknote;
              const closed = Number(a.is_active) !== 1;
              return (
                <div key={a.id} className="money-card" data-account={a.name} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: closed ? '#f8fafc' : '#fff', opacity: closed ? 0.7 : 1, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ width: 36, height: 36, borderRadius: 10, background: '#ecfdf5', color: '#066006', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon size={18} /></span>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</strong>
                      <span className="mm-sub" style={{ display: 'block' }}>{a.provider || KIND_LABEL[a.kind]}{a.account_number ? ` · ${a.account_number}` : ''}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: a.balance < 0 ? '#b91c1c' : '#0f172a' }}>{money(a.balance)}</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="mm-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Building2 size={12} />{a.branch_name || 'Whole company'}</span>
                    <span className="mm-sub" style={{ display: 'inline' }}>· {a.account_code} · {a.currency}</span>
                    {closed && <StatusBadge label="Closed" tone="neutral" />}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openStatement(a)}>Statement</button>
                    {canManage && a.account_code !== '1010' && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(a)}>{closed ? 'Reopen' : 'Close'}</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {(data.accounts || []).some((a) => Number(a.is_active) !== 1) && (
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed accounts
            </label>
          )}
        </>
      )}

      {/* New account (Odoo-style: type → provider → number → branch → opening balance) */}
      <Modal isOpen={newOpen} onClose={() => !busy && setNewOpen(false)} title="New bank or cash account" width="md" id="new-money-account-modal"
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setNewOpen(false)} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" id="save-money-account" onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Register account'}</button>
        </div>}>
        <div className="emp-form">
          <label className="form-field"><span className="form-field__label">Type *</span>
            <select className="form-select" id="ma-kind" value={form.kind} onChange={(e) => setForm((p) => ({ ...p, kind: e.target.value as Kind, provider: '', otherProvider: '' }))}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select></label>
          <label className="form-field"><span className="form-field__label">{form.kind === 'BANK' ? 'Bank *' : form.kind === 'CASH' ? 'Kind of cash *' : 'Provider *'}</span>
            <select className="form-select" id="ma-provider" {...set('provider')}>
              <option value="">— choose —</option>
              {(providers[form.kind] || []).map((p) => <option key={p} value={p}>{p}</option>)}
              <option value={OTHER}>Other (type the name)</option>
            </select></label>
          {form.provider === OTHER && (
            <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Name of the {form.kind === 'BANK' ? 'bank' : 'provider'} *</span>
              <input className="form-input" id="ma-other" {...set('otherProvider')} /></label>
          )}
          <label className="form-field"><span className="form-field__label">Account name</span>
            <input className="form-input" id="ma-name" {...set('name')} placeholder={providerName || 'e.g. Dahabshiil – USD'} /></label>
          <label className="form-field"><span className="form-field__label">{form.kind === 'MOBILE_MONEY' ? 'Phone / account number' : form.kind === 'CASH' ? 'Where it is kept' : 'Account number'}</span>
            <input className="form-input" id="ma-number" {...set('account_number')} placeholder={form.kind === 'MOBILE_MONEY' ? 'e.g. 063 4xx xxxx' : form.kind === 'CASH' ? 'e.g. HQ till' : ''} /></label>
          {form.kind !== 'CASH' && (
            <label className="form-field"><span className="form-field__label">Account holder</span>
              <input className="form-input" {...set('account_holder')} placeholder="e.g. Al Hayat Furniture Group" /></label>
          )}
          <label className="form-field"><span className="form-field__label">Belongs to</span>
            <select className="form-select" id="ma-branch" {...set('branchId')}>
              <option value="">Whole company</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></label>
          <label className="form-field"><span className="form-field__label">Money in it today (USD)</span>
            <input className="form-input" id="ma-opening" type="number" min="0" step="0.01" {...set('openingAmount')} placeholder="0.00" /></label>
          {Number(form.openingAmount) > 0 && (
            <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Where does this money come from?</span>
              <select className="form-select" id="ma-source" {...set('openingSource')}>
                <option value="NEW_MONEY">It is not in the books yet (opening balance)</option>
                <option value="MAIN_CASH">It was already counted in Main Cash (move it out of Main Cash)</option>
              </select></label>
          )}
          <p className="mm-sub" style={{ gridColumn: '1 / -1', margin: 0 }}>
            The account gets its own line in the books (under Cash). Its balance always comes from the recorded payments, so it can't drift.
          </p>
        </div>
      </Modal>

      {/* Move money between two accounts */}
      <Modal isOpen={moveOpen} onClose={() => !busy && setMoveOpen(false)} title="Move money between accounts" width="md" id="move-money-modal"
        footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setMoveOpen(false)} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" id="confirm-move" onClick={doMove} disabled={busy}>{busy ? 'Moving…' : 'Move money'}</button>
        </div>}>
        <div className="emp-form">
          <label className="form-field"><span className="form-field__label">From *</span>
            <select className="form-select" id="mv-from" value={move.fromId} onChange={(e) => setMove((p) => ({ ...p, fromId: e.target.value }))}>
              <option value="">— choose —</option>
              {active.map((a) => <option key={a.id} value={a.id}>{a.name} ({money(a.balance)})</option>)}
            </select></label>
          <label className="form-field"><span className="form-field__label">To *</span>
            <select className="form-select" id="mv-to" value={move.toId} onChange={(e) => setMove((p) => ({ ...p, toId: e.target.value }))}>
              <option value="">— choose —</option>
              {active.filter((a) => a.id !== move.fromId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <label className="form-field"><span className="form-field__label">Amount (USD) *</span>
            <input className="form-input" id="mv-amount" type="number" min="0" step="0.01" value={move.amount} onChange={(e) => setMove((p) => ({ ...p, amount: e.target.value }))} /></label>
          <label className="form-field"><span className="form-field__label">Date</span>
            <input className="form-input" type="date" value={move.date} onChange={(e) => setMove((p) => ({ ...p, date: e.target.value }))} /></label>
          <label className="form-field" style={{ gridColumn: '1 / -1' }}><span className="form-field__label">Note</span>
            <input className="form-input" value={move.note} onChange={(e) => setMove((p) => ({ ...p, note: e.target.value }))} placeholder="e.g. Deposited the day's cash" /></label>
        </div>
      </Modal>

      {/* Statement */}
      <Modal isOpen={!!statementOf} onClose={() => setStatementOf(null)} title={statementOf ? `${statementOf.name} — statement` : ''} width="lg">
        {statementOf && (
          <div>
            <p style={{ margin: '0 0 10px' }}>Balance now: <strong>{money(statementOf.balance)}</strong> <span className="mm-sub" style={{ display: 'inline' }}>· {statementOf.provider}{statementOf.account_number ? ` · ${statementOf.account_number}` : ''}</span></p>
            {!lines ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p>
              : <DataTable id="money-statement" data={lines} columns={lineCols} keyExtractor={(l: any) => String(l._i)} pageSize={25} emptyMessage="No money has moved through this account yet." />}
          </div>
        )}
      </Modal>
    </div>
  );
}
