import { useEffect, useState } from 'react';
import { apiGet } from '../api/client';

export interface MoneyAccountOption {
  id: string; name: string; kind: 'CASH' | 'BANK' | 'MOBILE_MONEY'; provider: string | null; account_number: string | null;
  branch_id: string | null; branch_name: string | null; is_main_cash: boolean; balance?: number;
}

const KIND: Record<MoneyAccountOption['kind'], string> = { CASH: 'Cash', BANK: 'Banks', MOBILE_MONEY: 'Mobile money / transfer' };
const REMEMBER = 'ah_money_account';
const cache = new Map<string, Promise<MoneyAccountOption[]>>();
const money = (n: number) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Open Bank & Cash accounts usable for a payment of `branchId` (its own + company-wide). */
export function loadMoneyAccountOptions(branchId?: string | null): Promise<MoneyAccountOption[]> {
  const key = branchId || '';
  if (!cache.has(key)) {
    const p = apiGet<MoneyAccountOption[]>('/money-accounts/options', branchId ? { branch_id: branchId } : undefined).catch((e) => { cache.delete(key); throw e; });
    cache.set(key, p);
  }
  return cache.get(key)!;
}
/** After accounts change (registered, closed), forget the cached list. */
export const forgetMoneyAccountOptions = () => cache.clear();

/**
 * "Paid from" / "Received into": the one dropdown for every payment. Lists the Bank & Cash
 * accounts that fit the payment's branch (Main Cash first), grouped by kind, with balances for
 * people who can see them. Remembers the last account used on this device.
 */
export function MoneyAccountSelect({ value, onChange, label = 'Paid from', branchId, id, required = true, amount, defaultTo = 'remembered', mustChoose = false }: {
  value: string;
  /** `auto` = picked by the dropdown itself (not by the person) */
  onChange: (id: string, auto?: boolean) => void;
  /** with no value yet: the last account used on this device, or Main Cash (use 'main' when editing an old record) */
  defaultTo?: 'remembered' | 'main';
  /** the person must pick the account themselves (no automatic choice): paying a supplier, a paid price level */
  mustChoose?: boolean;
  label?: string;
  branchId?: string | null;
  id?: string;
  required?: boolean;
  /** money going OUT of the account: warn when it holds less */
  amount?: number;
}) {
  const [opts, setOpts] = useState<MoneyAccountOption[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setOpts(null); setFailed(false);
    loadMoneyAccountOptions(branchId).then((list) => {
      if (!live) return;
      setOpts(list);
      // Keep a valid choice: the current one, else the last used here, else Main Cash.
      if (mustChoose) {
        if (value && !list.some((o) => o.id === value)) onChange('', true);
      } else if (!list.some((o) => o.id === value)) {
        let last = '';
        if (defaultTo === 'remembered') { try { last = localStorage.getItem(REMEMBER) || ''; } catch { /* ignore */ } }
        const pick = list.find((o) => o.id === last) || list.find((o) => o.is_main_cash) || list[0];
        if (pick) onChange(pick.id, true);
      }
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const choose = (v: string) => {
    onChange(v);
    try { localStorage.setItem(REMEMBER, v); } catch { /* ignore */ }
  };
  const chosen = opts?.find((o) => o.id === value);
  const short = chosen && amount !== undefined && chosen.balance !== undefined && amount > chosen.balance + 0.005;

  return (
    <label className="form-field" style={{ display: 'block' }}>
      <span className="form-field__label">{label}{required ? ' *' : ''}</span>
      <select className="form-select" id={id} value={value} onChange={(e) => choose(e.target.value)} disabled={!opts} required={required}>
        {!opts && <option value="">{failed ? 'Could not load accounts — reload the page' : 'Loading accounts…'}</option>}
        {opts && mustChoose && <option value="">— choose the account —</option>}
        {opts && (['CASH', 'BANK', 'MOBILE_MONEY'] as const).map((k) => {
          const group = opts.filter((o) => o.kind === k);
          if (!group.length) return null;
          return (
            <optgroup key={k} label={KIND[k]}>
              {group.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}{o.account_number ? ` · ${o.account_number}` : ''}{o.branch_name ? ` (${o.branch_name})` : ''}{o.balance !== undefined ? ` — ${money(o.balance)}` : ''}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
      {mustChoose && opts && !value && <span className="mm-sub" style={{ display: 'block' }}>Which account is this money paid from? (e.g. Dahabshiil, Darasalaam Bank, Main Cash)</span>}
      {opts && opts.length <= 1 && mustChoose && <span className="mm-sub" style={{ display: 'block' }}>Only Main Cash is registered. Add your banks and Dahabshiil under Accounting → Bank &amp; Cash.</span>}
      {short && <span className="mm-sub" style={{ display: 'block', color: '#b45309' }}>{chosen!.name} holds {money(chosen!.balance!)}, less than this payment.</span>}
    </label>
  );
}
