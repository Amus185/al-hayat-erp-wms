import { useState } from 'react';
import { CircleArrowDown, Loader2, Printer } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { printWith } from '../utils/documentPdf';

/**
 * "Download invoice" / "Download receipt" with a "Print" button next to it: the buttons for every
 * document the company hands out. `make` builds the PDF (see utils/documents.ts); Print sends the
 * same PDF straight to the printer dialog.
 */
export function DownloadDocButton({ label, make, id, small, iconOnly, className, printable = true }: {
  label: string;
  make: () => Promise<unknown>;
  id?: string;
  small?: boolean;
  iconOnly?: boolean;
  className?: string;
  printable?: boolean;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const what = label.replace(/^Download /i, '');
  const run = (mode: 'download' | 'print') => async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(mode);
    try { await (mode === 'print' ? printWith(make) : make()); }
    catch (err: any) { addToast('error', err?.message || `Could not prepare the ${what}. Try again.`); }
    finally { setBusy(null); }
  };
  const sz = small || iconOnly ? 14 : 16;
  const spin = { animation: 'spin 0.8s linear infinite' };
  const DIcon = busy === 'download' ? Loader2 : CircleArrowDown;
  const PIcon = busy === 'print' ? Loader2 : Printer;
  const printLabel = /^Download /i.test(label) ? label.replace(/^Download /i, 'Print ') : `Print ${label}`;
  const cls = className ?? `btn btn-secondary${small || iconOnly ? ' btn-sm' : ''}`;
  const style = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <button type="button" id={id} className={cls} onClick={run('download')} disabled={!!busy} title={label} aria-label={label} style={style}>
        <DIcon size={sz} style={busy === 'download' ? spin : undefined} />{iconOnly ? null : (busy === 'download' ? 'Preparing…' : label)}
      </button>
      {printable && (
        <button type="button" id={id ? `${id}-print` : undefined} className={cls} onClick={run('print')} disabled={!!busy} title={printLabel} aria-label={printLabel} style={style}>
          <PIcon size={sz} style={busy === 'print' ? spin : undefined} />{iconOnly ? null : (busy === 'print' ? 'Preparing…' : 'Print')}
        </button>
      )}
    </span>
  );
}
