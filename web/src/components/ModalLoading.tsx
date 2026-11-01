import { Loader2 } from 'lucide-react';

/** Shown inside a window that opened at once while its details load. */
export function ModalLoading({ text = 'Loading details…' }: { text?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 12px', color: '#64748b', fontSize: '14px' }}>
      <Loader2 size={18} className="spin-icon" />
      {text}
    </div>
  );
}
