// Reading a streamed model answer. With `stream: true` Workers AI returns
// server-sent events, one JSON chunk per line ("data: {...}", then
// "data: [DONE]"), in one of two shapes:
//   older Workers AI:  { "response": "text piece" }  and, for tools, { "tool_calls": [{ name, arguments }] }
//   OpenAI-style:      { "choices": [{ "delta": { "content": "text piece", "tool_calls": [{ index, id, function: { name, arguments } }] } }] }
// Text is passed on as it arrives (without <think> sections); tool calls are
// collected and returned at the end, like readModelOutput does for whole answers.

export interface StreamedCall { id: string; name: string; args: Record<string, unknown> }

const parseArgs = (a: unknown): Record<string, unknown> => {
  if (a && typeof a === 'object') return a as Record<string, unknown>;
  try { return JSON.parse(String(a ?? '{}')); } catch { return {}; }
};

/** Hides <think>…</think> from text that arrives in pieces. */
function thinkingFilter() {
  let inside = false;
  let buffer = '';
  const push = (piece: string): string => {
    buffer += piece;
    let out = '';
    for (;;) {
      if (inside) {
        const end = buffer.indexOf('</think>');
        if (end < 0) { buffer = buffer.slice(-8); return out; }
        buffer = buffer.slice(end + 8);
        inside = false;
      } else {
        const start = buffer.indexOf('<think>');
        if (start < 0) {
          // keep a possible partial "<think" at the end for the next piece
          const keep = Math.max(0, buffer.length - 6);
          const safe = buffer.lastIndexOf('<') >= keep ? buffer.lastIndexOf('<') : buffer.length;
          out += buffer.slice(0, safe);
          buffer = buffer.slice(safe);
          return out;
        }
        out += buffer.slice(0, start);
        buffer = buffer.slice(start + 7);
        inside = true;
      }
    }
  };
  /** Whatever was held back at the end (never thinking text). */
  const flush = () => { const rest = inside ? '' : buffer; buffer = ''; return rest; };
  return { push, flush };
}

export async function readModelStream(
  stream: ReadableStream<Uint8Array>,
  onText: (piece: string) => void,
): Promise<{ text: string; calls: StreamedCall[] }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const filter = thinkingFilter();
  const whole: StreamedCall[] = [];
  const partial = new Map<number, { id: string; name: string; args: string }>();
  let text = '';
  let pending = '';

  const handle = (chunk: any) => {
    const delta = chunk?.choices?.[0]?.delta;
    const piece = typeof chunk?.response === 'string' ? chunk.response : typeof delta?.content === 'string' ? delta.content : '';
    if (piece) {
      const visible = filter.push(piece);
      if (visible) { text += visible; onText(visible); }
    }
    for (const c of chunk?.tool_calls ?? []) {
      whole.push({ id: String(c.id ?? `call_${whole.length}`), name: String(c.function?.name ?? c.name ?? ''), args: parseArgs(c.function?.arguments ?? c.arguments) });
    }
    for (const c of delta?.tool_calls ?? []) {
      const i = Number(c.index ?? 0);
      const cur = partial.get(i) ?? { id: '', name: '', args: '' };
      if (c.id) cur.id = String(c.id);
      if (c.function?.name) cur.name += String(c.function.name);
      if (c.function?.arguments !== undefined) cur.args += typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments);
      partial.set(i, cur);
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      try { handle(JSON.parse(data)); } catch { /* ignore a malformed line */ }
    }
    if (done) break;
  }
  const rest = filter.flush();
  if (rest) { text += rest; onText(rest); }
  const calls = [
    ...whole,
    ...[...partial.entries()].sort(([a], [b]) => a - b).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, args: parseArgs(c.args) })),
  ].filter((c) => c.name);
  return { text: text.trim(), calls };
}
