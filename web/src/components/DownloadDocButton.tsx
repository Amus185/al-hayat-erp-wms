import { useState } from 'react';
import { CircleArrowDown, Loader2 } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

/**
 * "Download invoice" / "Download receipt": the one button for every document the
 * company hands out. `make` builds and downloads the PDF (see utils/documents.ts).
 */
export function DownloadDocButton({ label, make, id, small, iconOnly, className }: {
  label: string;
  make: () => Promise<unknown>;
  id?: string;
  small?: boolean;
  iconOnly?: boolean;
  className?: string;
}) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try { await make(); } catch (err: any) { addToast('error', err?.message || `Could not prepare the ${label.replace(/^Download /i, '')}. Try again.`); } finally { setBusy(false); }
  };
  const Icon = busy ? Loader2 : CircleArrowDown;
  return (
    <button type="button" id={id} className={className ?? `btn btn-secondary${small || iconOnly ? ' btn-sm' : ''}`}
      onClick={run} disabled={busy} title={label} aria-label={label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Icon size={small || iconOnly ? 14 : 16} style={busy ? { animation: 'spin 0.8s linear infinite' } : undefined} />{iconOnly ? null : (busy ? 'Preparing…' : label)}
    </button>
  );
}
