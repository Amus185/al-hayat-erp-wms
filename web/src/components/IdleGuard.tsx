import { useEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Modal } from './Modal';
import { fetchProfile, getLastActivity, markActivity } from '../api/client';

const WARN_SECONDS = 60;

/**
 * Signs the user out after `minutes` without activity (in any tab), with a
 * warning and a countdown during the last minute. While the person is active,
 * the server is told every 2 minutes, so an active session never ends on the
 * server while the page is quietly open.
 */
export function IdleGuard({ minutes, onTimeout }: { minutes: number; onTimeout: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastPing = useRef(Date.now());
  const done = useRef(false);

  useEffect(() => {
    if (!minutes) return;
    const limit = minutes * 60_000;
    const tick = () => {
      if (done.current) return;
      const last = getLastActivity();
      const idle = Date.now() - last;
      if (idle >= limit) {
        done.current = true;
        try { sessionStorage.setItem('ah_signout_reason', 'idle'); } catch { /* ignore */ }
        onTimeout();
        return;
      }
      const left = Math.ceil((limit - idle) / 1000);
      setSecondsLeft(left <= WARN_SECONDS ? left : null);
      // Keep the server session alive while the person is working, even on a
      // page that sends no requests of its own.
      if (last > lastPing.current && Date.now() - lastPing.current > 120_000) {
        lastPing.current = Date.now();
        fetchProfile().catch(() => {});
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [minutes, onTimeout]);

  if (secondsLeft === null) return null;

  const stay = () => {
    markActivity();
    lastPing.current = Date.now();
    fetchProfile().catch(() => {});
    setSecondsLeft(null);
  };

  return (
    <Modal
      isOpen
      onClose={stay}
      title="Are you still there?"
      width="sm"
      id="idle-warning"
      zIndex={5000}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => { done.current = true; onTimeout(); }}>Sign out now</button>
          <button type="button" className="btn btn-primary" onClick={stay} autoFocus>Stay signed in</button>
        </div>
      }
    >
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
        <Clock size={22} style={{ color: '#b45309', flex: 'none', marginTop: '2px' }} />
        <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.5 }}>
          For your security, you will be signed out in <strong>{secondsLeft} second{secondsLeft === 1 ? '' : 's'}</strong> because
          there has been no activity for almost {minutes} minutes. Anything not saved will be lost.
        </p>
      </div>
    </Modal>
  );
}
