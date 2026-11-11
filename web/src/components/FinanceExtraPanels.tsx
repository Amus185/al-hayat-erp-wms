// Accounting → Compare periods, Classes, Currencies, Bank reconciliation (roadmap items 8, 1, 5, 6).
import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api/client';
import { DataTable, type Column } from './DataTable';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

const money = (n: number) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const box: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' };
const Card = ({ label, value, warn }: { label: string; value: string; warn?: boolean }) => (
  <div style={box}><div className="mm-sub" style={{ display: 'block' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: warn ? '#b91c1c' : '#0f172a' }}>{value}</div></div>
);
const Field = ({ label, children, min }: { label: string; children: React.ReactNode; min?: number }) => (
  <label className="form-field" style={{ margin: 0, minWidth: min }}><span className="form-field__label">{label}</span>{children}</label>
);
const Head = ({ title, sub }: { title: string; sub: string }) => (<>
  <h3 style={{ margin: '0 0 4px' }}>{title}</h3>
  <p className="mm-sub" style={{ display: 'block', margin: '0 0 12px' }}>{sub}</p>
</>);
const row: React.CSSProperties = { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 };

function monthRange(offset: number): [string, string] {
  const n = new Date();
  const from = new Date(Date.UTC(n.getFullYear(), n.getMonth() + offset, 1));
  const to = new Date(Date.UTC(n.getFullYear(), n.getMonth() + offset + 1, 0));
  return [iso(from), iso(to)];
}
const LABEL: Record<string, string> = { revenue: 'Revenue', expenses: 'Expenses', net_profit: 'Net profit', assets: 'Assets (end of period)', liabilities: 'Liabilities (end of period)', cash_flow: 'Cash flow (money in − out)' };

/** Two periods side by side. */
export function ComparePeriods() {
  const { addToast } = useToast();
  const [a, setA] = useState(monthRange(-1));
  const [b, setB] = useState(monthRange(0));
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    setData(null);
    apiGet<any>('/accounting/comparison', { fromA: a[0], toA: a[1], fromB: b[0], toB: b[1] }).then(setData).catch((e) => { addToast('error', e?.message); setData({ rows: [] }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a[0], a[1], b[0], b[1]]);
  const preset = (k: string) => {
    const y = new Date().getFullYear();
    if (k === 'month') { setA(monthRange(-1)); setB(monthRange(0)); }
    if (k === 'year') { setA([`${y - 1}-01-01`, `${y - 1}-12-31`]); setB([`${y}-01-01`, `${y}-12-31`]); }
    if (k === 'sameMonth') { const m = monthRange(0); setA([`${y - 1}${m[0].slice(4)}`, `${y - 1}${m[1].slice(4)}`]); setB(m); }
  };
  const good = (key: string, diff: number) => (key === 'expenses' || key === 'liabilities' ? diff <= 0 : diff >= 0);
  const cols: Column<any>[] = [
    { key: 'key', label: 'Figure', render: (r) => <strong>{LABEL[r.key] || r.key}</strong> },
    { key: 'a', label: `First period`, render: (r) => money(r.a) },
    { key: 'b', label: `Second period`, render: (r) => <strong>{money(r.b)}</strong> },
    { key: 'difference', label: 'Difference', render: (r) => <strong style={{ color: Math.abs(r.difference) < 0.005 ? '#64748b' : good(r.key, r.difference) ? '#066006' : '#b91c1c' }}>{r.difference > 0 ? '+' : ''}{money(r.difference)}</strong> },
    { key: 'percent', label: 'Change', render: (r) => r.percent === null ? <span style={{ color: '#94a3b8' }}>—</span> : `${r.percent > 0 ? '+' : ''}${r.percent}%` },
  ];
  return (
    <div id="compare-periods">
      <Head title="Compare periods" sub="Two periods side by side, straight from the journal. Assets and liabilities are the balances at the end of each period." />
      <div style={row}>
        <button className="btn btn--secondary btn--sm" onClick={() => preset('month')}>This month vs last month</button>
        <button className="btn btn--secondary btn--sm" onClick={() => preset('sameMonth')}>This month vs same month last year</button>
        <button className="btn btn--secondary btn--sm" onClick={() => preset('year')}>This year vs last year</button>
      </div>
      <div style={row}>
        <Field label="First period from"><input className="form-input" type="date" value={a[0]} onChange={(e) => setA([e.target.value, a[1]])} /></Field>
        <Field label="to"><input className="form-input" type="date" value={a[1]} onChange={(e) => setA([a[0], e.target.value])} /></Field>
        <Field label="Second period from"><input className="form-input" type="date" value={b[0]} onChange={(e) => setB([e.target.value, b[1]])} /></Field>
        <Field label="to"><input className="form-input" type="date" value={b[1]} onChange={(e) => setB([b[0], e.target.value])} /></Field>
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="compare-table" data={data.rows} columns={cols} keyExtractor={(r) => r.key} />}
    </div>
  );
}

/** Classes (departments, projects): manage them, make them required, and see income and expenses per class. */
export function ClassesPanel() {
  const { addToast } = useToast();
  const canManage = !useAuth().branchId;
  const [list, setList] = useState<any[] | null>(null);
  const [required, setRequired] = useState(false);
  const [name, setName] = useState('');
  const [range, setRange] = useState<[string, string]>([`${new Date().getFullYear()}-01-01`, iso(new Date())]);
  const [report, setReport] = useState<any[] | null>(null);
  const load = useCallback(() => apiGet<any>('/accounting/classes').then((d) => { setList(d.classes); setRequired(d.required); }).catch((e) => { addToast('error', e?.message); setList([]); }), [addToast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setReport(null);
    apiGet<any>('/accounting/class-report', { from: range[0], to: range[1] }).then((d) => setReport(d.rows)).catch(() => setReport([]));
  }, [range]);
  const add = async () => {
    if (!name.trim()) return;
    try { await apiPost('/accounting/classes', { name: name.trim() }); setName(''); addToast('success', 'Class added.'); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const toggle = async (c: any) => { try { await apiPatch(`/accounting/classes/${c.id}`, { is_active: Number(c.is_active) !== 1 }); load(); } catch (e: any) { addToast('error', e?.message); } };
  const rename = async (c: any) => {
    const n = window.prompt('New name for this class', c.name);
    if (!n || n.trim() === c.name) return;
    try { await apiPatch(`/accounting/classes/${c.id}`, { name: n.trim() }); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const setReq = async (v: boolean) => { try { await apiPut('/accounting/classes-required', { required: v }); setRequired(v); addToast('success', v ? 'A class must now be chosen on every expense.' : 'Choosing a class is now optional.'); } catch (e: any) { addToast('error', e?.message); } };
  const cols: Column<any>[] = [
    { key: 'name', label: 'Class', render: (c) => <strong style={{ opacity: Number(c.is_active) === 1 ? 1 : 0.5 }}>{c.name}</strong> },
    { key: 'is_active', label: 'Status', render: (c) => Number(c.is_active) === 1 ? 'In use' : 'Not used any more' },
    ...(canManage ? [{ key: 'actions', label: '', render: (c: any) => <span style={{ display: 'flex', gap: 6 }}><button className="btn btn--secondary btn--sm" onClick={() => rename(c)}>Rename</button><button className="btn btn--secondary btn--sm" onClick={() => toggle(c)}>{Number(c.is_active) === 1 ? 'Stop using' : 'Use again'}</button></span> }] : []),
  ];
  const repCols: Column<any>[] = [
    { key: 'class_name', label: 'Class', render: (r) => <strong>{r.class_name}</strong> },
    { key: 'revenue', label: 'Income', render: (r) => money(r.revenue) },
    { key: 'expenses', label: 'Expenses', render: (r) => money(r.expenses) },
    { key: 'net', label: 'Result', render: (r) => <strong style={{ color: r.net < 0 ? '#b91c1c' : '#066006' }}>{money(r.net)}</strong> },
  ];
  return (
    <div id="classes-panel">
      <Head title="Classes" sub="A class is a label for a department, project or activity (e.g. Showroom, Workshop, Delivery). Choose it on an expense to see what each one costs." />
      {canManage && (
        <div style={row}>
          <Field label="New class" min={220}><input className="form-input" id="class-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Workshop" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} /></Field>
          <button className="btn btn--primary" id="class-add" onClick={add} disabled={!name.trim()}>Add class</button>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 8, paddingBottom: 8 }}>
            <input type="checkbox" id="class-required" checked={required} onChange={(e) => setReq(e.target.checked)} /> A class must be chosen on every expense
          </label>
        </div>
      )}
      {!list ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="classes-table" data={list} columns={cols} keyExtractor={(c) => c.id} emptyMessage="No classes yet. Add the first one above." />}
      <h4 style={{ margin: '20px 0 8px' }}>Income and expenses by class</h4>
      <div style={row}>
        <Field label="From"><input className="form-input" type="date" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} /></Field>
        <Field label="To"><input className="form-input" type="date" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} /></Field>
      </div>
      {!report ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : <DataTable id="class-report" data={report} columns={repCols} keyExtractor={(r) => r.class_id || 'none'} emptyMessage="Nothing recorded in this period." />}
    </div>
  );
}

/** Currencies: the books are in US dollars; other currencies have a rate that the Owner sets. */
export function CurrenciesPanel() {
  const { addToast } = useToast();
  const canManage = !useAuth().branchId;
  const [data, setData] = useState<any>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const load = useCallback(() => apiGet<any>('/accounting/currencies').then(setData).catch((e) => { addToast('error', e?.message); setData({ currencies: [], history: [] }); }), [addToast]);
  useEffect(() => { load(); }, [load]);
  const save = async (code: string) => {
    const rate = Number(rates[code]);
    if (!(rate > 0)) { addToast('error', 'Enter how many units equal 1 US dollar, e.g. 8500.'); return; }
    try { await apiPut(`/accounting/currencies/${code}/rate`, { rate }); addToast('success', `1 USD = ${rate.toLocaleString()} ${code} from now on.`); setRates((p) => ({ ...p, [code]: '' })); load(); } catch (e: any) { addToast('error', e?.message); }
  };
  const hist: Column<any>[] = [
    { key: 'created_at', label: 'Set on', render: (h) => new Date(h.created_at).toLocaleString() },
    { key: 'currency_code', label: 'Currency' },
    { key: 'rate', label: 'Rate (per 1 USD)', render: (h) => <strong>{Number(h.rate).toLocaleString()}</strong> },
    { key: 'by_name', label: 'Set by', render: (h) => h.by_name || '—' },
  ];
  return (
    <div id="currencies-panel">
      <Head title="Currencies" sub="The books are kept in US dollars. A Bank & Cash account can be kept in Somaliland Shillings: each movement keeps the shilling amount and the rate of that day. A new rate applies from now on and never changes past entries." />
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>Loading…</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
          {data.currencies.map((c: any) => (
            <div key={c.code} style={box} data-currency={c.code}>
              <strong>{c.name} ({c.code})</strong>
              {Number(c.is_base) === 1 ? <div className="mm-sub" style={{ display: 'block' }}>Base currency of the books. Rate is always 1.</div> : (<>
                <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0' }}>{c.rate ? `1 USD = ${Number(c.rate).toLocaleString()} ${c.code}` : <span style={{ color: '#b45309' }}>No rate set yet</span>}</div>
                {canManage && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="form-input" id={`rate-${c.code}`} type="number" min="0" step="any" placeholder="New rate, e.g. 8500" value={rates[c.code] || ''} onChange={(e) => setRates((p) => ({ ...p, [c.code]: e.target.value }))} />
                    <button className="btn btn--primary" id={`rate-save-${c.code}`} onClick={() => save(c.code)}>Set rate</button>
                  </div>
                )}
              </>)}
            </div>
          ))}
        </div>
        <h4 style={{ margin: '0 0 8px' }}>Rate history</h4>
        <DataTable id="rate-history" data={data.history} columns={hist} keyExtractor={(h) => h.id} emptyMessage="No rate has been set yet." />
      </>)}
    </div>
  );
}

/** Reads lines pasted from a bank file: date, description, amount (and optionally a reference), one per row. */
function parsePasted(textIn: string): { lines: any[]; bad: number } {
  const lines: any[] = []; let bad = 0;
  for (const raw of textIn.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.split(/\t|;|,(?=\S)|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    const dm = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(cells[0] || '');
    const amountCell = [...cells].reverse().find((x) => /^[-+(]?\$?[\d,]+(\.\d+)?\)?$/.test(x));
    if (!dm || !amountCell) { bad++; continue; }
    const date = dm[1] ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : `${dm[6]}-${dm[5].padStart(2, '0')}-${dm[4].padStart(2, '0')}`;
    let amount = Number(amountCell.replace(/[$,()+]/g, ''));
    if (/^\(.*\)$/.test(amountCell)) amount = -Math.abs(amount);
    const rest = cells.slice(1).filter((x) => x !== amountCell);
    if (!Number.isFinite(amount) || amount === 0) { bad++; continue; }
    lines.push({ date, description: rest[0] || '', reference: rest[1] || '', amount });
  }
  return { lines, bad };
}

/** Bank reconciliation: compare the bank's statement with the books. Nothing is posted here. */
export function BankReconciliation() {
  const { addToast } = useToast();
  const canManage = !useAuth().branchId;
  const [accounts, setAccounts] = useState<any[]>([]);
  const [accId, setAccId] = useState('');
  const [stBal, setStBal] = useState('');
  const [data, setData] = useState<any>(null);
  const [line, setLine] = useState({ date: iso(new Date()), description: '', reference: '', amount: '' });
  const [paste, setPaste] = useState('');
  const [pick, setPick] = useState<string>(''); // statement line being matched by hand
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiGet<any>('/accounting/money-accounts').then((d) => { const a = (d.accounts || []).filter((x: any) => Number(x.is_active) === 1); setAccounts(a); if (a[0]) setAccId((p) => p || a.find((x: any) => x.kind !== 'CASH')?.id || a[0].id); }).catch(() => {}); }, []);
  const load = useCallback(() => {
    if (!accId) return;
    apiGet<any>(`/accounting/reconciliation/${accId}`, { statementBalance: stBal || undefined }).then(setData).catch((e) => { addToast('error', e?.message); });
  }, [accId, stBal, addToast]);
  useEffect(() => { setData(null); setPick(''); load(); }, [load]);
  const run = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(true);
    try { const r = await fn(); if (ok) addToast('success', ok(r)); load(); } catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const addOne = () => run(async () => { const r = await apiPost(`/accounting/reconciliation/${accId}/lines`, { lines: [{ ...line, amount: Number(line.amount) }] }); setLine((p) => ({ ...p, description: '', reference: '', amount: '' })); return r; }, (r) => r.added ? 'Statement line added.' : 'That line is already there.');
  const addPasted = () => {
    const { lines, bad } = parsePasted(paste);
    if (!lines.length) { addToast('error', 'No lines could be read. Each row needs a date, a description and an amount.'); return; }
    run(async () => { const r = await apiPost(`/accounting/reconciliation/${accId}/lines`, { lines }); setPaste(''); return r; }, (r) => `${r.added} lines added${r.skipped ? `, ${r.skipped} already there` : ''}${bad ? `, ${bad} rows could not be read` : ''}.`);
  };
  const s = data?.summary;
  const pickLine = data?.statement.find((x: any) => x.id === pick);
  const stCols: Column<any>[] = [
    { key: 'line_date', label: 'Date', render: (r) => String(r.line_date).slice(0, 10) },
    { key: 'description', label: 'Statement line', render: (r) => <span>{r.description || '—'}{r.reference ? <span className="mm-sub">{r.reference}</span> : null}</span> },
    { key: 'amount', label: 'Amount', render: (r) => <strong style={{ color: r.amount < 0 ? '#b91c1c' : '#066006' }}>{money(r.amount)}</strong> },
    { key: 'matched', label: 'In the books', render: (r) => r.matched_line_id ? <span style={{ color: '#066006' }}>Matched · {r.matched_entry}<span className="mm-sub">{r.matched_description}</span></span> : <strong style={{ color: '#b45309' }}>Not matched</strong> },
    ...(canManage ? [{ key: 'actions', label: '', render: (r: any) => r.matched_line_id
      ? <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => run(() => apiPost('/accounting/reconciliation/unmatch', { statementLineId: r.id }))}>Unmatch</button>
      : <span style={{ display: 'flex', gap: 6 }}><button className="btn btn--primary btn--sm" onClick={() => setPick(pick === r.id ? '' : r.id)}>{pick === r.id ? 'Cancel' : 'Match'}</button><button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => run(() => apiDelete(`/accounting/reconciliation/lines/${r.id}`))}>Remove</button></span> }] : []),
  ];
  const bkCols: Column<any>[] = [
    { key: 'entry_date', label: 'Date', render: (r) => String(r.entry_date).slice(0, 10) },
    { key: 'description', label: 'Book entry', render: (r) => <span>{r.description}<span className="mm-sub">{r.entry_number}</span></span> },
    { key: 'amount', label: 'Amount', render: (r) => <strong style={{ color: r.amount < 0 ? '#b91c1c' : '#066006' }}>{money(r.amount)}</strong> },
    ...(canManage && pickLine ? [{ key: 'actions', label: '', render: (r: any) => Math.abs(r.amount - pickLine.amount) < 0.005
      ? <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => run(async () => { await apiPost('/accounting/reconciliation/match', { statementLineId: pickLine.id, ledgerLineId: r.id }); setPick(''); }, () => 'Matched.')}>This one</button>
      : <span className="mm-sub" style={{ display: 'inline' }}>different amount</span> }] : []),
  ];
  return (
    <div id="bank-reconciliation">
      <Head title="Bank reconciliation" sub="Enter the lines of the bank's statement and match them with the books. Matching posts nothing: a difference shows what still has to be recorded (e.g. a bank fee) or what the bank has not processed yet." />
      <div style={row}>
        <Field label="Account" min={240}><select className="form-select" id="recon-account" value={accId} onChange={(e) => setAccId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Closing balance on the statement"><input className="form-input" id="recon-balance" type="number" step="0.01" value={stBal} onChange={(e) => setStBal(e.target.value)} placeholder="optional" /></Field>
        {canManage && <button className="btn btn--primary" id="recon-auto" disabled={busy || !accId} onClick={() => run(() => apiPost(`/accounting/reconciliation/${accId}/auto`, {}), (r) => r.matched ? `${r.matched} lines matched automatically.` : 'Nothing could be matched automatically.')}>Match automatically</button>}
      </div>
      {!data ? <p className="mm-sub" style={{ display: 'block' }}>{accounts.length ? 'Loading…' : 'Register a Bank & Cash account first.'}</p> : (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Card label="Balance in the books" value={money(s.book_balance)} />
          <Card label="Statement balance" value={s.statement_balance === null ? '—' : money(s.statement_balance)} />
          <Card label="Difference" value={s.difference === null ? '—' : money(s.difference)} warn={s.difference !== null && Math.abs(s.difference) > 0.005} />
          <Card label="Matched" value={`${s.matched} of ${s.statement_lines}`} />
          <Card label="Statement lines not in the books" value={`${s.unmatched_statement} · ${money(s.unmatched_statement_total)}`} warn={s.unmatched_statement > 0} />
          <Card label="Book entries not on the statement" value={`${s.unmatched_book} · ${money(s.unmatched_book_total)}`} warn={s.unmatched_book > 0} />
        </div>
        {canManage && (
          <details style={{ ...box, marginBottom: 16 }} open={!data.statement.length}>
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Add statement lines</summary>
            <div style={{ ...row, marginTop: 10 }}>
              <Field label="Date"><input className="form-input" type="date" value={line.date} onChange={(e) => setLine({ ...line, date: e.target.value })} /></Field>
              <Field label="Description" min={200}><input className="form-input" id="recon-desc" value={line.description} onChange={(e) => setLine({ ...line, description: e.target.value })} /></Field>
              <Field label="Reference"><input className="form-input" value={line.reference} onChange={(e) => setLine({ ...line, reference: e.target.value })} /></Field>
              <Field label="Amount (out = minus)"><input className="form-input" id="recon-amount" type="number" step="0.01" value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} placeholder="-300 or 1000" /></Field>
              <button className="btn btn--primary" id="recon-add" disabled={busy || !line.amount} onClick={addOne}>Add line</button>
            </div>
            <Field label="Or paste rows from the bank's file (date, description, amount — one per row)">
              <textarea className="form-input" id="recon-paste" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'2026-11-01\tDeposit\t1000\n2026-11-03\tCheque 14\t-300'} style={{ fontFamily: 'monospace' }} />
            </Field>
            <button className="btn btn--secondary" style={{ marginTop: 8 }} disabled={busy || !paste.trim()} onClick={addPasted}>Add pasted rows</button>
          </details>
        )}
        <h4 style={{ margin: '0 0 8px' }}>Statement</h4>
        <DataTable id="recon-statement" data={data.statement} columns={stCols} keyExtractor={(r) => r.id} emptyMessage="No statement lines yet." />
        <h4 style={{ margin: '20px 0 8px' }}>{pickLine ? `Choose the book entry for "${pickLine.description || 'this line'}" (${money(pickLine.amount)})` : 'Book entries not on the statement'}</h4>
        <DataTable id="recon-book" data={data.unmatchedBook} columns={bkCols} keyExtractor={(r) => r.id} emptyMessage="Every book entry of this account is matched." />
      </>)}
    </div>
  );
}
