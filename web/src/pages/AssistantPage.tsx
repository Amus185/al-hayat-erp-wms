import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { AssistantMessage } from '../components/AssistantMessage';
import { AGENT_URL, askAssistant, confirmProposal, dismissProposal, type AssistantEvent, type ChatMessage, type Proposal } from '../api/assistant';

type ProposalState = Proposal & { state: 'open' | 'busy' | 'done' | 'dismissed' | 'failed'; note?: string };
type Entry = { role: 'user' | 'assistant'; content: string; proposals?: ProposalState[] };

// Examples in Somali: managers use the assistant in Somali (any dialect or spelling works).
const EXAMPLES = ['Alaabta kaydkeedu yaraaday waa kuwee?', 'Iibka toddobaadkan intee buu ahaa?', 'Yaa deyn nagu leh, intee le\'eg?', 'Faa\'iidada bishan maxay ahayd?', 'Xaashida dheelitirka i tus', 'Gaarsiimaha maanta xaaladdoodu waa sidee?'];

/** What the assistant is looking at, in Somali, by data source or tool. */
const LOOKUP_LABELS: [RegExp, string][] = [
  [/income_statement|balance_sheet|trial_balance|cash_flow|owners_equity|journal|general_ledger|chart_of_accounts|fiscal_periods|accounting|depreciation|branch_accounts/, 'xisaabaadka'],
  [/debt|customer|receivable/, 'deymaha iyo macaamiisha'],
  [/sales|order|quote/, 'iibka'],
  [/stock|product|inventory|warehouse|transfer|low/, 'kaydka iyo alaabta'],
  [/deliver/, 'gaarsiinta'],
  [/purchase|supplier/, 'iibsashada'],
  [/expense/, 'kharashaadka'],
  [/asset|rental|propert|livestock/, 'hantida'],
  [/manufactur|work_order/, 'wax-soo-saarka'],
  [/branch/, 'laamaha'],
];
function statusText(e: AssistantEvent): string | null {
  if (e.type !== 'status') return null;
  if (e.step === 'thinking') return 'Waan ka fikirayaa su\'aashaada…';
  const key = `${e.source ?? ''} ${e.tool}`;
  const label = LOOKUP_LABELS.find(([re]) => re.test(key))?.[1] ?? 'xogta nidaamka';
  return `Waan eegayaa ${label}…`;
}

/**
 * Chat with the business assistant. It answers from live data through
 * read-only tools; any change it suggests appears as a card that does nothing
 * until you press Confirm (and your own permissions still apply).
 */
export function AssistantPage() {
  const { addToast } = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // The answer being written: status line and the text so far (streamed).
  const [live, setLive] = useState<{ status: string | null; text: string }>({ status: null, text: '' });
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [entries, busy, live.text]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Entry[] = [...entries, { role: 'user', content }];
    setEntries(next);
    setInput('');
    setBusy(true);
    setLive({ status: 'Waan ka fikirayaa su\'aashaada…', text: '' });
    try {
      const history: ChatMessage[] = next.map((e) => ({ role: e.role, content: e.content }));
      const res = await askAssistant(history, (ev) => {
        if (ev.type === 'delta') setLive((cur) => ({ status: null, text: cur.text + ev.text }));
        else if (ev.type === 'reset') setLive({ status: 'Waan ka fikirayaa su\'aashaada…', text: '' });
        else setLive((cur) => (cur.text ? cur : { ...cur, status: statusText(ev) }));
      });
      setEntries((cur) => [...cur, { role: 'assistant', content: res.reply, proposals: res.proposals.map((p) => ({ ...p, state: 'open' })) }]);
    } catch (err: any) {
      setEntries((cur) => [...cur, { role: 'assistant', content: err?.message || 'Wax qalad ah ayaa dhacay. Fadlan mar kale isku day.' }]);
    } finally {
      setBusy(false);
      setLive({ status: null, text: '' });
    }
  };

  const setProposal = (id: string, patch: Partial<ProposalState>) =>
    setEntries((cur) => cur.map((e) => (e.proposals?.some((p) => p.id === id)
      ? { ...e, proposals: e.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
      : e)));

  const confirm = async (p: ProposalState) => {
    setProposal(p.id, { state: 'busy' });
    try {
      await confirmProposal(p.id);
      setProposal(p.id, { state: 'done', note: 'Waa la sameeyay.' });
      addToast('success', p.summary);
    } catch (err: any) {
      setProposal(p.id, { state: 'failed', note: err?.message || 'Isbeddelka lama samayn karin.' });
    }
  };

  const dismiss = async (p: ProposalState) => {
    setProposal(p.id, { state: 'busy' });
    try { await dismissProposal(p.id); } catch { /* already handled or expired: nothing to undo */ }
    setProposal(p.id, { state: 'dismissed', note: 'Lama samayn.' });
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); send(input); };

  if (!AGENT_URL) {
    return (
      <div className="module-page">
        <div className="card" style={{ padding: '20px', color: '#64748b' }}>
          The assistant is not set up yet. Deploy ai-agent/ and set VITE_AGENT_URL (see ai-agent/README.md).
        </div>
      </div>
    );
  }

  return (
    <div className="module-page" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', minHeight: '480px' }}>
      <section className="module-header">
        <div className="module-header__icon"><Sparkles size={24} /></div>
        <div>
          <p>Wax ka weydii iibka, kaydka, deymaha, gaarsiinta, iibsashada, xisaabaadka iyo qaybaha kale ee Al-Hayat. Isbeddel kasta wuxuu sugayaa ansixintaada.</p>
          <h2>Kaaliyaha</h2>
        </div>
      </section>

      <div className="card" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }} aria-live="polite">
        {entries.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', maxWidth: '520px' }}>
            <p style={{ marginTop: 0 }}>Isku day mid ka mid ah kuwan, ama si kasta oo aad doonto u qor:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="btn btn-secondary" onClick={() => send(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {entries.map((e, i) => (
          <div key={i} style={{ alignSelf: e.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
            <div style={{
              whiteSpace: e.role === 'user' ? 'pre-wrap' : 'normal', padding: e.role === 'user' ? '10px 14px' : '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: 1.55,
              background: e.role === 'user' ? 'var(--primary, #0b8f08)' : '#f8fafc', color: e.role === 'user' ? '#fff' : '#0f172a',
              border: e.role === 'user' ? 'none' : '1px solid #e2e8f0',
            }}>
              {e.role === 'user' ? e.content : <AssistantMessage text={e.content} />}
            </div>
            {e.proposals?.map((p) => (
              <div key={p.id} role="group" aria-label="Isbeddel la soo jeediyay" style={{ marginTop: '8px', border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: '10px', padding: '10px 12px', fontSize: '13px' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  {p.state === 'done' ? 'Isbeddelka waa la sameeyay' : p.state === 'dismissed' ? 'Isbeddel la soo jeediyay (lama samayn)' : p.state === 'failed' ? 'Isbeddelka lama samayn' : 'Isbeddel la soo jeediyay (weli lama samayn)'}
                </div>
                <div>{p.summary}</div>
                {p.state === 'open' || p.state === 'busy' ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button type="button" className="btn btn-primary" disabled={p.state === 'busy'} onClick={() => confirm(p)}>
                      {p.state === 'busy' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} Ansixi
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={p.state === 'busy'} onClick={() => dismiss(p)}>
                      <X size={14} /> Ha samayn
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: '8px', fontWeight: 600, color: p.state === 'done' ? '#047857' : p.state === 'failed' ? '#b91c1c' : '#64748b' }}>{p.note}</div>
                )}
              </div>
            ))}
          </div>
        ))}
        {busy && live.text && (
          <div style={{ alignSelf: 'flex-start', maxWidth: '80%' }} aria-live="polite">
            <div style={{ padding: '12px 16px', borderRadius: '12px', fontSize: '14px', lineHeight: 1.55, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#0f172a' }}>
              <AssistantMessage text={live.text} />
              <span style={{ display: 'inline-block', width: '7px', height: '15px', marginTop: '4px', background: '#0b8f08', borderRadius: '2px', animation: 'assistant-caret 1s steps(2) infinite' }} />
            </div>
          </div>
        )}
        {busy && !live.text && (
          <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }} aria-live="polite">
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {live.status ?? 'Waan raadinayaa…'}
          </div>
        )}
        <style>{`@keyframes assistant-caret { 0% { opacity: 1 } 100% { opacity: 0 } }`}</style>
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <label htmlFor="assistant-input" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>Fariin</label>
        <input
          id="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Wax weydii: iib, kayd, deyn, xisaab…"
          autoComplete="off"
          style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}><Send size={16} /> Dir</button>
      </form>
    </div>
  );
}
