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

export async function downloadDocument(spec: DocumentSpec): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, logo] = await Promise.all([import('jspdf'), import('jspdf-autotable'), logoDataUrl()]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 16; // page margin
  let y = 16;

  // ── Header: logo + company name (left), title (centre), issuer (right) ──
  if (logo) doc.addImage(logo, 'PNG', M, y - 2, 16, 16);
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...GREEN);
  const nameEnd = M + (logo ? 19 : 0) + doc.getTextWidth(COMPANY_NAME);
  doc.text(COMPANY_NAME, M + (logo ? 19 : 0), y + 7.5);

  // The title sits centred in the space between the name and the issuer block,
  // and gets smaller when it is long (PURCHASE INVOICE) so it never touches either.
  const gapStart = nameEnd + 5, gapEnd = W - M - 50;
  const titleX = (gapStart + gapEnd) / 2;
  let fs = 16;
  doc.setFont('helvetica', 'bold').setFontSize(fs).setTextColor(...INK);
  while (fs > 10 && doc.getTextWidth(spec.title) > gapEnd - gapStart) doc.setFontSize(--fs);
  doc.text(spec.title, titleX, y + 7.5, { align: 'center' });

  const issuer = spec.issuer.filter(Boolean) as string[];
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
  let iy = y + 1;
  for (const line of issuer) {
    for (const part of doc.splitTextToSize(line, 52) as string[]) { doc.text(part, W - M, iy, { align: 'right' }); iy += 3.8; }
  }
  y = Math.max(y + 18, iy + 2);

  doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...INK);
  doc.text(spec.numberLine, titleX, y, { align: 'center' });
  y += 4;
  doc.setDrawColor(200, 200, 200).setLineWidth(0.3).line(M, y, W - M, y);
  y += 8;

  // ── Details: "Label : value" in two columns ──
  const colW = (W - 2 * M) / 2;
  const pairs = (list: Pair[], x: number, startY: number) => {
    let py = startY;
    for (const [label, raw] of list) {
      const value = raw === null || raw === undefined || raw === '' ? 'N/A' : String(raw);
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...INK);
      doc.text(label, x, py);
      doc.text(':', x + 30, py);
      const lines = doc.splitTextToSize(value, colW - 36) as string[];
      doc.text(lines, x + 33, py);
      py += Math.max(1, lines.length) * 3.9 + 1;
    }
    return py;
  };
  const endL = pairs(spec.left, M, y);
  const endR = spec.right?.length ? pairs(spec.right, M + colW + 4, y) : y;
  y = Math.max(endL, endR) + 6;

  // ── Lines table ──
  if (spec.table) {
    const align = spec.table.align ?? [];
    autoTable(doc, {
      startY: y,
      head: [spec.table.head],
      body: spec.table.rows,
      theme: 'grid',
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, textColor: INK, lineColor: GRID, lineWidth: 0.2, cellPadding: 1.6, valign: 'top' },
      headStyles: { fillColor: HEAD_FILL, textColor: INK, fontStyle: 'normal', halign: 'center' },
      columnStyles: Object.fromEntries(spec.table.head.map((_, i) => [i, {
        halign: align[i] ?? 'left',
        ...(spec.table!.widths?.[i] ? { cellWidth: spec.table!.widths[i] } : {}),
      }])),
    });
    y = (doc as any).lastAutoTable.finalY;
  }

  // ── Totals, boxed on the right like the table ──
  if (spec.totals?.length) {
    const boxW = 72, x = W - M - boxW, rowH = 5.6;
    for (const t of spec.totals) {
      doc.setDrawColor(...GRID).setLineWidth(0.2).rect(x, y, boxW, rowH);
      doc.setFont('helvetica', t.strong ? 'bold' : 'normal').setFontSize(8.5).setTextColor(...INK);
      doc.text(t.label, x + 2, y + 3.9);
      doc.text(t.value, W - M - 2, y + 3.9, { align: 'right' });
      y += rowH;
    }
  }
  y += 10;

  // ── Extra details ──
  if (spec.extra?.rows.length) {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...INK);
    doc.text(spec.extra.title, M + 2, y);
    doc.setDrawColor(...INK).setLineWidth(0.2).line(M + 2, y + 1, M + 2 + doc.getTextWidth(spec.extra.title), y + 1);
    y = pairs(spec.extra.rows, M + 2, y + 6) + 4;
  }

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTED);
    doc.text(spec.footer ?? `Thank you for your business. ${COMPANY_NAME}`, W / 2, H - 14, { align: 'center' });
    doc.text(`Generated ${dateTime(new Date())}${pages > 1 ? `  ·  Page ${p} of ${pages}` : ''}`, W / 2, H - 10, { align: 'center' });
  }

  doc.save(spec.fileName.endsWith('.pdf') ? spec.fileName : `${spec.fileName}.pdf`);
}
