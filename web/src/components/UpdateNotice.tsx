import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

const CHECK_EVERY_MS = 5 * 60 * 1000;

/**
 * Keeps open tabs on the latest version of the staff app. It checks
 * /version.json every few minutes and when the tab comes back into view.
 * When a newer version is live it shows a small bar with "Refresh", and moves
 * to the new version by itself on the next page change (never in the middle
 * of a form on the current page).
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  const location = useLocation();
  const firstPath = useRef(location.pathname);

  useEffect(() => {
    if (import.meta.env.DEV) return; // the dev server reloads by itself
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!stopped && build && build !== __BUILD_ID__) setReady(true);
      } catch { /* offline: try again later */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const id = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    check();
    return () => { stopped = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // Moving to another page loses nothing on the current one: load the new version there.
  useEffect(() => {
    if (ready && location.pathname !== firstPath.current) window.location.reload();
    firstPath.current = location.pathname;
  }, [location.pathname, ready]);

  if (!ready) return null;
  return (
    <div role="status" style={{
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 4000,
      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px 10px 16px', maxWidth: 'calc(100vw - 32px)',
      background: '#0f172a', color: '#fff', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,.25)', fontSize: '14px',
    }}>
      <span>A new version of Al Hayat ERP is available.</span>
      <button type="button" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
        onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  );
}
