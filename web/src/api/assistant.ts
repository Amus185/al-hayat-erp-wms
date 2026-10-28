import { apiPost } from './client';

/** Where the assistant Worker runs (ai-agent/). Unset: the assistant is hidden. */
export const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined)?.replace(/\/$/, '') || '';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface Proposal { id: string; action: string; summary: string; expiresInMinutes: number }
export interface ChatReply { reply: string; proposals: Proposal[]; toolsUsed: string[] }

/**
 * One assistant turn: get a fresh 5-minute agent token from the backend (this
 * also counts against the hourly limit), then ask the Worker. The browser never
 * holds a Cloudflare key or the user's login token for the Worker.
 */
export async function askAssistant(messages: ChatMessage[]): Promise<ChatReply> {
  const { token } = await apiPost<{ token: string }>('/agent/session');
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error('Could not reach the assistant. Check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message || 'The assistant is not available right now.');
  return body as ChatReply;
}

/** The user pressed Confirm: the backend runs the change through the normal route. */
export const confirmProposal = (id: string) => apiPost<{ success: true; summary: string }>(`/agent/actions/${id}/execute`);
export const dismissProposal = (id: string) => apiPost<{ success: true }>(`/agent/actions/${id}/cancel`);
