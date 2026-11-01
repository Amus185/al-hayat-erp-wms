import { useEffect, useRef } from 'react';

/**
 * Re-runs `refresh` every `ms` while the tab is visible, and as soon as the
 * person comes back to the tab, so a screen shows new data (e.g. a new web
 * order) without a manual refresh. It runs quietly: the refresh function
 * should not show spinners or error toasts for these background updates.
 */
export function useLiveRefresh(refresh: () => void, ms = 30_000) {
  const fn = useRef(refresh);
  fn.current = refresh;
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') fn.current(); };
    const id = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [ms]);
}
