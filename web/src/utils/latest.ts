import { useRef } from 'react';

/**
 * Keeps only the latest of a series of requests. `start()` begins a new one
 * and returns `isCurrent()`; a reply is applied only while it is still
 * current. `cancel()` (e.g. on closing a window) makes every pending reply
 * stale, so a slow reply can never reopen a window the user already closed,
 * or show the details of a row they clicked before the one they want.
 */
export function useLatest() {
  const seq = useRef(0);
  return {
    start: () => {
      const id = ++seq.current;
      return () => id === seq.current;
    },
    cancel: () => { seq.current += 1; },
  };
}
