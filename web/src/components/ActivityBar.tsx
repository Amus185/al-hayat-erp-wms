import { useEffect, useState } from 'react';
import { onApiActivity } from '../api/client';

/**
 * A thin animated bar at the top of the screen (and a "working" cursor) while
 * any request to the server is running, so every click that waits on the
 * server shows at once that something is happening. Very fast requests (under
 * 150 ms) do not flash it.
 */
export function ActivityBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onApiActivity((active) => {
      if (active > 0) {
        if (!timer) timer = setTimeout(() => { timer = null; setVisible(true); }, 150);
      } else {
        if (timer) { clearTimeout(timer); timer = null; }
        setVisible(false);
      }
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('api-busy', visible);
  }, [visible]);

  if (!visible) return null;
  return <div className="activity-bar" role="progressbar" aria-label="Working…" />;
}
