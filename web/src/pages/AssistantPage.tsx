import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Loader2, MessageSquare, Plus, Send, Sparkles, Trash2, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { AssistantMessage } from '../components/AssistantMessage';
import { confirmAction } from '../utils/swal';
import {
  AGENT_URL, askAssistant, confirmProposal, createConversation, deleteConversation, dismissProposal, getConversation,
  listConversations, saveMessage,
  type AssistantEvent, type ChatMessage, type ConversationSummary, type Proposal, type ProposalStatus,
} from '../api/assistant';

type ProposalState = Proposal & { state: ProposalStatus | 'busy'; note?: string };
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

const PROPOSAL_TITLE: Record<ProposalState['state'], string> = {
  open: 'Isbeddel la soo jeediyay (weli lama samayn)',
  busy: 'Isbeddel la soo jeediyay (weli lama samayn)',
  done: 'Isbeddelka waa la sameeyay',
  dismissed: 'Isbeddel la soo jeediyay (lama samayn)',
  failed: 'Isbeddelka lama samayn',
  expired: 'Waqtigii ansixinta wuu dhacay (lama samayn)',
};

/** "Maanta 14:05", "Shalay", or a date: when a conversation was last used. */
function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return `Maanta ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Shalay';
  return d.toLocaleDateString();
}

/**
 * Chat with the business assistant. It answers from live data through
 * read-only tools; any change it suggests appears as a card that does nothing
 * until you press Confirm (and your own permissions still apply).
 * Conversations are kept on the server, per user, and listed on the left.
 */
export function AssistantPage() {
  const { addToast } = useToast();
  const [params, setParams] = useSearchParams();
  const currentId = params.get('c');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  // The answer being written: status line and the text so far (streamed).
  const [live, setLive] = useState<{ status: string | null; text: string }>({ status: null, text: '' });
  const endRef = useRef<HTMLDivElement>(null);
  // The conversation a send created, so loading it does not wipe the chat being written.
  const justCreated = useRef<string | null>(null);
  // History is saved in the background, one write after another, so the next
  // question never waits for it and messages are stored in the order asked.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (job: () => Promise<void>) => { saveQueue.current = saveQueue.current.then(job, job); };

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [entries, busy, live.text]);

  const refreshList = useCallback(() => {
    listConversations().then(setConversations).catch(() => { /* the list is a convenience; the chat still works */ });
  }, []);
  useEffect(() => { refreshList(); }, [refreshList]);

  // Open the conversation named in the address (?c=…), or a new empty chat.
  useEffect(() => {
    if (!currentId) { setEntries([]); return; }
    if (justCreated.current === currentId) return;
    let cancelled = false;
    setLoadingChat(true);
    getConversation(currentId)
      .then((conv) => {
        if (cancelled) return;
        setEntries(conv.messages.map((m) => ({ role: m.role, content: m.content, proposals: m.proposals })));
      })
      .catch((err) => {
        if (cancelled) return;
        addToast('error', err?.message || 'Wada-hadalka lama furi karo.');
        setParams({}, { replace: true });
      })
      .finally(() => { if (!cancelled) setLoadingChat(false); });
    return () => { cancelled = true; };
  }, [currentId, addToast, setParams]);

  const openChat = (id: string | null) => {
    if (busy) return;
    justCreated.current = null;
    setParams(id ? { c: id } : {});
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const next: Entry[] = [...entries, { role: 'user', content }];
    setEntries(next);
    setInput('');
    setBusy(true);
    setLive({ status: 'Waan ka fikirayaa su\'aashaada…', text: '' });

    // Keep the conversation: create it on the first message, then save each turn.
    // Saving never blocks the chat; if it fails, the chat still works.
    let conversationId = currentId;
    let saved = true;
    enqueue(async () => {
      try {
        if (!conversationId) {
          const created = await createConversation(content);
          conversationId = created.id;
          justCreated.current = created.id;
          setParams({ c: created.id }, { replace: true });
        }
        await saveMessage(conversationId, 'user', content);
      } catch {
        saved = false;
      }
    });

    try {
      const history: ChatMessage[] = next.map((e) => ({ role: e.role, content: e.content }));
      const res = await askAssistant(history, (ev) => {
        if (ev.type === 'delta') setLive((cur) => ({ status: null, text: cur.text + ev.text }));
        else if (ev.type === 'reset') setLive({ status: 'Waan ka fikirayaa su\'aashaada…', text: '' });
        else setLive((cur) => (cur.text ? cur : { ...cur, status: statusText(ev) }));
      });
      setEntries((cur) => [...cur, { role: 'assistant', content: res.reply, proposals: res.proposals.map((p) => ({ ...p, state: 'open' })) }]);
      enqueue(async () => {
        try {
          if (!saved || !conversationId) throw new Error('not saved');
          await saveMessage(conversationId, 'assistant', res.reply, res.proposals.map((p) => p.id));
        } catch {
          addToast('error', 'Wada-hadalkan si buuxda looma kaydin taariikhda.');
        }
        refreshList();
      });
    } catch (err: any) {
      setEntries((cur) => [...cur, { role: 'assistant', content: err?.message || 'Wax qalad ah ayaa dhacay. Fadlan mar kale isku day.' }]);
    } finally {
      setBusy(false);
      setLive({ status: null, text: '' });
    }
  };

  const removeChat = async (c: ConversationSummary) => {
    if (busy) return;
    const ok = await confirmAction('Tirtir wada-hadalka?', `"${c.title}" waa la tirtiri doonaa, lagamana soo celin karo.`, 'Tirtir');
    if (!ok) return;
    try {
      await deleteConversation(c.id);
      setConversations((cur) => cur.filter((x) => x.id !== c.id));
      if (c.id === currentId) openChat(null);
    } catch (err: any) {
      addToast('error', err?.message || 'Lama tirtiri karo.');
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
      <style>{`
        @keyframes assistant-caret { 0% { opacity: 1 } 100% { opacity: 0 } }
        .assistant-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; }
        .assistant-layout .card { justify-content: flex-start; }
        .assistant-layout .card:hover { transform: none; }
        .assistant-history { display: flex; flex-direction: column; min-height: 0; padding: 12px; gap: 8px; }
        .assistant-history ul { flex: 1 1 auto; min-height: 0; }
        .assistant-history ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
        .assistant-chat-item { display: flex; align-items: center; gap: 6px; border-radius: 8px; padding: 8px 8px 8px 10px; cursor: pointer; }
        .assistant-chat-item:hover { background: #f1f5f9; }
        .assistant-chat-item.is-active { background: #ecfdf5; }
        .assistant-chat-item button.assistant-del { opacity: 0; border: 0; background: transparent; color: #94a3b8; cursor: pointer; padding: 4px; border-radius: 6px; }
        .assistant-chat-item:hover button.assistant-del, .assistant-chat-item.is-active button.assistant-del { opacity: 1; }
        .assistant-chat-item button.assistant-del:hover { color: #b91c1c; background: #fee2e2; }
        @media (max-width: 900px) {
          .assistant-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
          .assistant-history { max-height: 170px; }
        }
      `}</style>
      <section className="module-header">
        <div className="module-header__icon"><Sparkles size={24} /></div>
        <div>
          <p>Wax ka weydii iibka, kaydka, deymaha, gaarsiinta, iibsashada, xisaabaadka iyo qaybaha kale ee Al-Hayat. Isbeddel kasta wuxuu sugayaa ansixintaada.</p>
          <h2>Kaaliyaha</h2>
        </div>
      </section>

      <div className="assistant-layout">
        <aside className="card assistant-history" aria-label="Wada-hadalladii hore">
          <button type="button" className="btn btn-primary" onClick={() => openChat(null)} disabled={busy} style={{ justifyContent: 'center', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
            <Plus size={16} /> Wada-hadal cusub
          </button>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', padding: '4px 2px 0' }}>Wada-hadalladii hore</div>
          {conversations.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', padding: '0 2px' }}>Weli ma jiraan. Su'aashaada ugu horraysa ayaa halkan ku keydsami doonta.</p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    className={`assistant-chat-item${c.id === currentId ? ' is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-current={c.id === currentId ? 'true' : undefined}
                    onClick={() => openChat(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChat(c.id); } }}
                  >
                    <MessageSquare size={14} style={{ flex: 'none', color: '#64748b' }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.title}>{c.title}</span>
                      <span style={{ display: 'block', fontSize: '11px', color: '#94a3b8' }}>{when(c.updatedAt)}</span>
                    </span>
                    <button type="button" className="assistant-del" aria-label={`Tirtir: ${c.title}`} onClick={(e) => { e.stopPropagation(); removeChat(c); }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="card" style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }} aria-live="polite">
            {loadingChat && (
              <div style={{ margin: 'auto', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Waa la furayaa…
              </div>
            )}
            {!loadingChat && entries.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', color: '#64748b', maxWidth: '520px' }}>
                <p style={{ marginTop: 0 }}>Isku day mid ka mid ah kuwan, ama si kasta oo aad doonto u qor:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
                  {EXAMPLES.map((ex) => (
                    <button key={ex} type="button" className="btn btn-secondary" onClick={() => send(ex)}>{ex}</button>
                  ))}
                </div>
              </div>
            )}

            {!loadingChat && entries.map((e, i) => (
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
                    <div style={{ fontWeight: 600, marginBottom: '6px' }}>{PROPOSAL_TITLE[p.state]}</div>
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
                    ) : p.note ? (
                      <div style={{ marginTop: '8px', fontWeight: 600, color: p.state === 'done' ? '#047857' : p.state === 'failed' ? '#b91c1c' : '#64748b' }}>{p.note}</div>
                    ) : null}
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
              disabled={loadingChat}
              style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || loadingChat || !input.trim()}><Send size={16} /> Dir</button>
          </form>
        </div>
      </div>
    </div>
  );
}
