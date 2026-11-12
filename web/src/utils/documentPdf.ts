// One look for every document the company hands out (invoice, receipt, purchase invoice,
// statement): the Al Hayat logo and name at the top, small clean text, a details block,
// a grey-headed table and the totals. Built as a real PDF and downloaded.
//
// The PDF library is loaded only when someone downloads a document, so the app itself
// stays as light as before.

export const COMPANY_NAME = 'Al Hayat Furniture Group';
const GREEN: [number, number, number] = [6, 96, 6];
const INK: [number, number, number] = [26, 26, 26];
const MUTED: [number, number, number] = [110, 110, 110];
const GRID: [number, number, number] = [120, 120, 120];
const HEAD_FILL: [number, number, number] = [217, 217, 217];

export type Pair = [label: string, value: string | null | undefined];

export interface DocumentSpec {
  /** Big word at the top: INVOICE, RECEIPT, PURCHASE INVOICE, STATEMENT. */
  title: string;
  /** e.g. "Invoice # INV-00012". */
  numberLine: string;
  /** Who issues it (branch name, address, phone…), top right. */
  issuer: (string | null | undefined)[];
  /** Details, two columns of "Label : value". */
  left: Pair[];
  right?: Pair[];
  table?: { head: string[]; rows: string[][]; align?: ('left' | 'right' | 'center')[]; widths?: number[] };
  totals?: { label: string; value: string; strong?: boolean }[];
  /** Extra block under the totals (e.g. payment details, notes). */
  extra?: { title: string; rows: Pair[] };
  footer?: string;
  fileName: string;
}

export const money = (n: unknown) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const dateOnly = (d: unknown) => {
  if (!d) return '—';
  const t = new Date(String(d));
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dateTime = (d: unknown) => {
  if (!d) return '—';
  const t = new Date(String(d));
  return Number.isNaN(t.getTime()) ? String(d) : t.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** A file-name-safe version of a document number. */
export const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';

let logoCache: Promise<string | null> | null = null;
function logoDataUrl(): Promise<string | null> {
  if (!logoCache) {
    logoCache = fetch('/logo.png')
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => b && new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = reject;
        fr.readAsDataURL(b);
      }))
      .catch(() => null);
  }
  return logoCache;
}

/** How documents look (Owner's settings in Settings → Documents). */
export interface DocumentLayout {
  companyName: string; tagline: string; address: string; phone: string; email: string; website: string;
  accentColor: string; showLogo: boolean; paperSize: 'a4' | 'letter' | 'a5'; fontScale: number;
  footerText: string; terms: string; showSignatures: boolean; showGeneratedAt: boolean;
}
export const DEFAULT_LAYOUT: DocumentLayout = {
  companyName: COMPANY_NAME, tagline: '', address: '', phone: '', email: '', website: '',
  accentColor: '#066006', showLogo: true, paperSize: 'a4', fontScale: 1,
  footerText: 'Thank you for your business.', terms: '', showSignatures: false, showGeneratedAt: true,
};
let layoutCache: { at: number; value: Promise<DocumentLayout> } | null = null;
export function documentLayout(fresh = false): Promise<DocumentLayout> {
  if (fresh || !layoutCache || Date.now() - layoutCache.at > 60_000) {
    layoutCache = { at: Date.now(), value: import('../api/client').then(({ apiGet }) => apiGet<DocumentLayout>('/settings/document-layout')).then((l) => ({ ...DEFAULT_LAYOUT, ...l })).catch(() => DEFAULT_LAYOUT) };
  }
  return layoutCache.value;
}
const hexRgb = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : GREEN;
};

async function buildDocument(spec: DocumentSpec, layoutIn?: DocumentLayout) {
  const [{ jsPDF }, { default: autoTable }, layout] = await Promise.all([import('jspdf'), import('jspdf-autotable'), layoutIn ? Promise.resolve(layoutIn) : documentLayout()]);
  const logo = layout.showLogo ? await logoDataUrl() : null;
  const ACCENT = hexRgb(layout.accentColor);
  const k = Math.min(1.25, Math.max(0.85, Number(layout.fontScale) || 1));
  const fz = (n: number) => n * k;
  const company = layout.companyName || COMPANY_NAME;
  const doc = new jsPDF({ unit: 'mm', format: layout.paperSize || 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = W < 160 ? 10 : 16; // page margin (smaller on A5)
  let y = 16;

  // ── Header: logo + company name (left), title (centre), issuer (right) ──
  if (logo) doc.addImage(logo, 'PNG', M, y - 2, 16, 16);
  const nameX = M + (logo ? 19 : 0);
  doc.setFont('helvetica', 'bold').setFontSize(fz(12)).setTextColor(...ACCENT);
  const nameEnd = nameX + doc.getTextWidth(company);
  doc.text(company, nameX, y + 5.5);
  const contact = [layout.tagline, layout.address, [layout.phone, layout.email, layout.website].filter(Boolean).join('  ·  ')].filter(Boolean);
  doc.setFont('helvetica', 'normal').setFontSize(fz(7.5)).setTextColor(...MUTED);
  let cy = y + 9.5;
  for (const line of contact) for (const part of doc.splitTextToSize(line, Math.max(40, W / 2 - nameX)) as string[]) { doc.text(part, nameX, cy); cy += 3.3; }

  // The title sits centred between the name and the issuer block; on narrow paper it goes on its own line.
  const issuerW = W < 160 ? 40 : 52;
  let gapStart = nameEnd + 5, gapEnd = W - M - issuerW - 2;
  let titleY = y + 5.5;
  const issuer = spec.issuer.filter(Boolean) as string[];
  doc.setFont('helvetica', 'normal').setFontSize(fz(8.5)).setTextColor(...INK);
  let iy = y + 1;
  for (const line of issuer) {
    for (const part of doc.splitTextToSize(line, issuerW) as string[]) { doc.text(part, W - M, iy, { align: 'right' }); iy += 3.8; }
  }
  y = Math.max(y + 18, iy + 2, cy + 1);
  if (gapEnd - gapStart < 34) { gapStart = M; gapEnd = W - M; titleY = y + 4; y += 9; }
  const titleX = (gapStart + gapEnd) / 2;
  let fs = fz(16);
  doc.setFont('helvetica', 'bold').setFontSize(fs).setTextColor(...INK);
  while (fs > 10 && doc.getTextWidth(spec.title) > gapEnd - gapStart) doc.setFontSize(--fs);
  doc.text(spec.title, titleX, titleY, { align: 'center' });

  doc.setFont('helvetica', 'bold').setFontSize(fz(9.5)).setTextColor(...INK);
  doc.text(spec.numberLine, titleX, y, { align: 'center' });
  y += 4;
  doc.setDrawColor(...ACCENT).setLineWidth(0.4).line(M, y, W - M, y);
  y += 8;

  // ── Details: "Label : value" in two columns ──
  const colW = (W - 2 * M) / 2;
  const labelW = W < 160 ? 22 : 30;
  const pairs = (list: Pair[], x: number, startY: number) => {
    let py = startY;
    for (const [label, raw] of list) {
      const value = raw === null || raw === undefined || raw === '' ? 'N/A' : String(raw);
      doc.setFont('helvetica', 'normal').setFontSize(fz(8.5)).setTextColor(...INK);
      doc.text(label, x, py);
      if (label) doc.text(':', x + labelW, py);
      const lines = doc.splitTextToSize(value, colW - labelW - 6) as string[];
      doc.text(lines, x + (label ? labelW + 3 : 0), py);
      py += Math.max(1, lines.length) * 3.9 * k + 1;
    }
    return py;
  };
  const endL = pairs(spec.left, M, y);
  const endR = spec.right?.length ? pairs(spec.right, M + colW + 4, y) : y;
  y = Math.max(endL, endR) + 6;

  // ── Lines table (column widths follow the paper) ──
  if (spec.table) {
    const align = spec.table.align ?? [];
    const ratio = (W - 2 * M) / (210 - 32);
    autoTable(doc, {
      startY: y,
      head: [spec.table.head],
      body: spec.table.rows,
      theme: 'grid',
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: fz(W < 160 ? 7.5 : 8.5), textColor: INK, lineColor: GRID, lineWidth: 0.2, cellPadding: 1.6, valign: 'top' },
      headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: 'normal', halign: 'center' },
      columnStyles: Object.fromEntries(spec.table.head.map((_, i) => [i, {
        halign: align[i] ?? 'left',
        ...(spec.table!.widths?.[i] ? { cellWidth: spec.table!.widths[i] * Math.min(1, ratio) } : {}),
      }])),
    });
    y = (doc as any).lastAutoTable.finalY;
  }

  // ── Totals, boxed on the right like the table ──
  if (spec.totals?.length) {
    const boxW = Math.min(72, W - 2 * M), x = W - M - boxW, rowH = 5.6 * k;
    for (const t of spec.totals) {
      doc.setDrawColor(...GRID).setLineWidth(0.2).rect(x, y, boxW, rowH);
      doc.setFont('helvetica', t.strong ? 'bold' : 'normal').setFontSize(fz(8.5)).setTextColor(...INK);
      doc.text(t.label, x + 2, y + rowH * 0.7);
      doc.text(t.value, W - M - 2, y + rowH * 0.7, { align: 'right' });
      y += rowH;
    }
  }
  y += 10;
  const H = doc.internal.pageSize.getHeight();
  const room = (need: number) => { if (y + need > H - 22) { doc.addPage(); y = 20; } };

  // ── Extra details ──
  const block = (title: string) => {
    doc.setFont('helvetica', 'normal').setFontSize(fz(9)).setTextColor(...INK);
    doc.text(title, M + 2, y);
    doc.setDrawColor(...INK).setLineWidth(0.2).line(M + 2, y + 1, M + 2 + doc.getTextWidth(title), y + 1);
  };
  if (spec.extra?.rows.length) {
    room(20); block(spec.extra.title);
    y = pairs(spec.extra.rows, M + 2, y + 6) + 4;
  }
  // ── Terms and conditions (Owner's text) ──
  if (layout.terms) {
    doc.setFontSize(fz(8));
    const lines = doc.splitTextToSize(layout.terms, W - 2 * M - 4) as string[];
    room(10 + lines.length * 3.6); block('Terms and conditions');
    doc.setFont('helvetica', 'normal').setFontSize(fz(8)).setTextColor(...MUTED);
    doc.text(lines, M + 2, y + 6);
    y += 8 + lines.length * 3.6 * k;
  }
  // ── Signatures ──
  if (layout.showSignatures) {
    room(22); y += 12;
    const sw = (W - 2 * M - 20) / 2;
    doc.setDrawColor(...INK).setLineWidth(0.2);
    doc.setFont('helvetica', 'normal').setFontSize(fz(8)).setTextColor(...INK);
    doc.line(M, y, M + sw, y); doc.text('Received by (name and signature)', M, y + 4);
    doc.line(W - M - sw, y, W - M, y); doc.text(`For ${company}`, W - M - sw, y + 4);
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  const footer = (spec.footer ? spec.footer.split(COMPANY_NAME).join(company) : `${layout.footerText || 'Thank you for your business.'} ${company}`).trim();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(fz(7.5)).setTextColor(...MUTED);
    doc.text(footer, W / 2, H - 14, { align: 'center' });
    if (layout.showGeneratedAt || pages > 1) doc.text(`${layout.showGeneratedAt ? `Generated ${dateTime(new Date())}` : ''}${pages > 1 ? `${layout.showGeneratedAt ? '  ·  ' : ''}Page ${p} of ${pages}` : ''}`, W / 2, H - 10, { align: 'center' });
  }
  return doc;
}

// While a Print button is running, the same document builders print instead of downloading.
let printTarget: { win: Window | null } | null = null;

/** Runs `make` (which calls downloadDocument) so that the document is printed instead of saved. */
export async function printWith(make: () => Promise<unknown>): Promise<void> {
  // Phones cannot print from a hidden frame: open the tab now, while the tap still counts (popup blockers).
  const phone = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 760);
  const win = phone ? window.open('', '_blank') : null;
  if (win) win.document.write('<p style="font-family:sans-serif;padding:24px">Preparing the document…</p>');
  printTarget = { win };
  try { await make(); } catch (e) { win?.close(); throw e; } finally { printTarget = null; }
}

function printPdf(doc: any, win: Window | null) {
  doc.autoPrint();
  const url = URL.createObjectURL(doc.output('blob'));
  if (win) { win.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 120_000); return; }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.src = url;
  frame.onload = () => {
    try { frame.contentWindow?.focus(); frame.contentWindow?.print(); }
    catch { window.open(url, '_blank'); }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 120_000);
  };
  document.body.appendChild(frame);
}

export async function downloadDocument(spec: DocumentSpec): Promise<void> {
  const target = printTarget;
  const doc = await buildDocument(spec);
  if (target) { printPdf(doc, target.win); return; }
  doc.save(spec.fileName.endsWith('.pdf') ? spec.fileName : `${spec.fileName}.pdf`);
}

/** A PDF of `spec` drawn with an unsaved layout, for the settings preview. Returns a blob URL. */
export async function previewDocument(spec: DocumentSpec, layout: DocumentLayout): Promise<string> {
  const doc = await buildDocument(spec, layout);
  return URL.createObjectURL(doc.output('blob'));
}

/** Forget the cached layout (after the Owner saves new settings). */
export function forgetDocumentLayout() { layoutCache = null; }
