// Safe HTML building for print views written into a new window.
//
// `html` is a tagged template that escapes every interpolated value unless it
// is itself an `html` fragment (or an array of fragments). Customer, product,
// supplier and note text therefore can never become markup or script.

export class SafeHtml {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value: unknown): string {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * Write a print document into a window opened with window.open('').
 * Inline handlers are not allowed (Content-Security-Policy), so any element
 * with data-action="print" gets its click handler attached from here.
 */
export function writePrintDocument(w: Window, doc: SafeHtml) {
  w.document.open();
  w.document.write(doc.value);
  w.document.close();
  w.document.querySelectorAll('[data-action="print"]').forEach((el) => el.addEventListener('click', () => w.print()));
}
