// Shows an assistant reply as formatted text: headings, bullet and numbered
// lists, simple tables, bold, and highlighted money amounts. The model writes
// light Markdown; this turns it into React elements (never raw HTML), so
// nothing in a reply can inject markup or script into the page.
import type { ReactNode } from 'react';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const BULLET = /^(\s*)[*\-•]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const BOLD_LINE = /^\*\*([^*]+?)\*\*:?\s*$/;        // a line that is only bold text works as a heading
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const heading = line.match(HEADING) ?? line.trim().match(BOLD_LINE);
    if (heading) { blocks.push({ kind: 'heading', text: heading[1].trim() }); i++; continue; }

    const listMatch = line.match(BULLET) ?? line.match(NUMBERED);
    if (listMatch) {
      const ordered = !line.match(BULLET);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(ordered ? NUMBERED : BULLET);
        if (!m) break;
        items.push({ text: m[2], depth: m[1].length >= 2 ? 1 : 0 });
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !TABLE_ROW.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: 'paragraph', lines: para });
  }
  return blocks;
}

const MONEY = /(\$\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:USD|\$))/g;

/** Money amounts in a plain-text run, highlighted. */
function withMoney(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MONEY)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<span key={`${key}-m${m.index}`} className="am-money">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** **bold**, *italic* / _italic_ and `code` inside a line. */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])|`([^`]+)`/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(...withMoney(text.slice(last, m.index), `${key}-${n++}`));
    const k = `${key}-${n++}`;
    if (m[1] ?? m[2]) out.push(<strong key={k}>{withMoney(m[1] ?? m[2], k)}</strong>);
    else if (m[3] ?? m[4]) out.push(<em key={k}>{withMoney(m[3] ?? m[4], k)}</em>);
    else out.push(<code key={k} className="am-code">{m[5]}</code>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...withMoney(text.slice(last), `${key}-${n++}`));
  return out;
}

export function AssistantMessage({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="am">
      <style>{`
        .am { display: flex; flex-direction: column; gap: 8px; }
        .am p { margin: 0; }
        .am-h { margin: 4px 0 0; font-size: 13px; font-weight: 700; letter-spacing: .02em; color: #065f46; text-transform: none; }
        .am ul, .am ol { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
        .am ul { list-style: none; padding-left: 4px; }
        .am ul li { position: relative; padding-left: 16px; }
        .am ul li::before { content: ''; position: absolute; left: 2px; top: .62em; width: 6px; height: 6px; border-radius: 50%; background: #0b8f08; }
        .am ul li.am-sub { margin-left: 16px; }
        .am ul li.am-sub::before { background: transparent; border: 1.5px solid #0b8f08; width: 5px; height: 5px; }
        .am-money { font-weight: 700; color: #065f46; white-space: nowrap; }
        .am-code { font-family: ui-monospace, monospace; font-size: 12px; background: #e2e8f0; padding: 1px 5px; border-radius: 4px; }
        .am-table { border-collapse: collapse; font-size: 13px; width: 100%; background: #fff; border-radius: 8px; overflow: hidden; }
        .am-table th { text-align: left; background: #ecfdf5; color: #065f46; font-weight: 700; }
        .am-table th, .am-table td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
        .am-table-wrap { overflow-x: auto; }
      `}</style>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === 'heading') return <div key={key} className="am-h">{inline(b.text, key)}</div>;
        if (b.kind === 'paragraph') return <p key={key}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, `${key}-${j}`)}</span>)}</p>;
        if (b.kind === 'table') {
          return (
            <div key={key} className="am-table-wrap">
              <table className="am-table">
                <thead><tr>{b.header.map((h, j) => <th key={j}>{inline(h, `${key}-h${j}`)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, `${key}-${j}-${k}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        const List = b.ordered ? 'ol' : 'ul';
        return <List key={key}>{b.items.map((it, j) => <li key={j} className={it.depth ? 'am-sub' : undefined}>{inline(it.text, `${key}-${j}`)}</li>)}</List>;
      })}
    </div>
  );
}
