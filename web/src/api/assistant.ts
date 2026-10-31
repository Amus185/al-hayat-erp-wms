import { apiPost } from './client';

/** Where the assistant Worker runs (ai-agent/). Unset: the assistant is hidden. */
export const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined)?.replace(/\/$/, '') || '';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface Proposal { id: string; action: string; summary: string; expiresInMinutes: number }
export interface ChatReply { reply: string; proposals: Proposal[]; toolsUsed: string[] }

/** Progress while the assistant works (see ai-agent/src/agent.ts AgentEvent). */
export type AssistantEvent =
  | { type: 'status'; step: 'thinking' }
  | { type: 'status'; step: 'lookup'; tool: string; source?: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' };

const UNREACHABLE = 'Lama gaari karo kaaliyaha. Hubi internet-kaaga oo mar kale isku day.';

/**
 * One assistant turn: get a fresh 5-minute agent token from the backend (this
 * also counts against the hourly limit), then ask the Worker. The answer is
 * streamed: onEvent receives progress and the text as it is written; the
 * returned reply is the final, authoritative answer. The browser never holds
 * a Cloudflare key or the user's login token for the Worker.
 */
export async function askAssistant(messages: ChatMessage[], onEvent?: (e: AssistantEvent) => void): Promise<ChatReply> {
  const { token } = await apiPost<{ token: string }>('/agent/session');
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error(UNREACHABLE);
  }
  if (!(res.headers.get('content-type') || '').includes('text/event-stream') || !res.body) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { message?: string }).message || 'Kaaliyaha hadda lama heli karo.');
    return body as ChatReply;
  }

  // Server-sent events: "event: <type>" + "data: <json>", blocks separated by a blank line.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try { chunk = await reader.read(); } catch { throw new Error(UNREACHABLE); }
    buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
    const blocks = buffer.split('\n\n');
    buffer = chunk.done ? '' : blocks.pop() ?? '';
    for (const block of blocks) {
      const event = block.match(/^event: (.*)$/m)?.[1];
      const raw = block.match(/^data: (.*)$/m)?.[1];
      if (!event || raw === undefined) continue;
      let data: any;
      try { data = JSON.parse(raw); } catch { continue; }
      if (event === 'done') return data as ChatReply;
      if (event === 'error') throw new Error(data?.message || 'Kaaliyaha hadda lama heli karo.');
      onEvent?.(data as AssistantEvent);
    }
    if (chunk.done) break;
  }
  throw new Error(UNREACHABLE);
}

/** The user pressed Confirm: the backend runs the change through the normal route. */
export const confirmProposal = (id: string) => apiPost<{ success: true; summary: string }>(`/agent/actions/${id}/execute`);
export const dismissProposal = (id: string) => apiPost<{ success: true }>(`/agent/actions/${id}/cancel`);
