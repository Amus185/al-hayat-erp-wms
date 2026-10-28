import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { AGENT_URL, askAssistant, confirmProposal, dismissProposal, type ChatMessage, type Proposal } from '../api/assistant';

type ProposalState = Proposal & { state: 'open' | 'busy' | 'done' | 'dismissed' | 'failed'; note?: string };
type Entry = { role: 'user' | 'assistant'; content: string; proposals?: ProposalState[] };

const EXAMPLES = ['Which products are low on stock?', 'Sales this week?', 'Show the last 5 orders', 'Add 20 units to Oslo Corner Sofa'];

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
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [entries, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Entry[] = [...entries, { role: 'user', content }];
    setEntries(next);
    setInput('');
    setBusy(true);
    try {
      const history: ChatMessage[] = next.map((e) => ({ role: e.role, content: e.content }));
      const res = await askAssistant(history);
      setEntries((cur) => [...cur, { role: 'assistant', content: res.reply, proposals: res.proposals.map((p) => ({ ...p, state: 'open' })) }]);
    } catch (err: any) {
      setEntries((cur) => [...cur, { role: 'assistant', content: err?.message || 'Something went wrong. Please try again.' }]);
    } finally {
      setBusy(false);
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
      setProposal(p.id, { state: 'done', note: 'Done.' });
      addToast('success', p.summary);
    } catch (err: any) {
      setProposal(p.id, { state: 'failed', note: err?.message || 'The change could not be made.' });
    }
  };

  const dismiss = async (p: ProposalState) => {
    setProposal(p.id, { state: 'busy' });
    try { await dismissProposal(p.id); } catch { /* already handled or expired: nothing to undo */ }
    setProposal(p.id, { state: 'dismissed', note: 'Not done.' });
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
          <p>Ask about products, stock, sales and orders. Changes always wait for your confirmation.</p>
          <h2>Assistant</h2>
        </div>
      </section>

      <div className="card" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }} aria-live="polite">
        {entries.length === 0 && (
          <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', maxWidth: '520px' }}>
            <p style={{ marginTop: 0 }}>Try one of these, in any language:</p>
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
              whiteSpace: 'pre-wrap', padding: '10px 14px', borderRadius: '12px', fontSize: '14px', lineHeight: 1.5,
              background: e.role === 'user' ? 'var(--primary, #0b8f08)' : '#f1f5f9', color: e.role === 'user' ? '#fff' : '#0f172a',
            }}>
              {e.content}
            </div>
            {e.proposals?.map((p) => (
              <div key={p.id} role="group" aria-label="Suggested change" style={{ marginTop: '8px', border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: '10px', padding: '10px 12px', fontSize: '13px' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px' }}>
                  {p.state === 'done' ? 'Change made' : p.state === 'dismissed' ? 'Suggested change (not done)' : p.state === 'failed' ? 'Change not made' : 'Suggested change (not done yet)'}
                </div>
                <div>{p.summary}</div>
                {p.state === 'open' || p.state === 'busy' ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button type="button" className="btn btn-primary" disabled={p.state === 'busy'} onClick={() => confirm(p)}>
                      {p.state === 'busy' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />} Confirm
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={p.state === 'busy'} onClick={() => dismiss(p)}>
                      <X size={14} /> Don&apos;t do it
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: '8px', fontWeight: 600, color: p.state === 'done' ? '#047857' : p.state === 'failed' ? '#b91c1c' : '#64748b' }}>{p.note}</div>
                )}
              </div>
            ))}
          </div>
        ))}
        {busy && (
          <div style={{ alignSelf: 'flex-start', color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Looking it up…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <label htmlFor="assistant-input" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>Message</label>
        <input
          id="assistant-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
          placeholder="Ask about stock, sales, orders…"
          autoComplete="off"
          style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}><Send size={16} /> Send</button>
      </form>
    </div>
  );
}
