"use client";

import Link from "next/link";
import { useEffect } from "react";

// unstable_retry (Next 16) re-fetches and re-renders the failed segment from the
// server; the older reset() only re-rendered in the browser and could not recover.
export default function ErrorPage({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center" role="alert">
      <h1 className="text-3xl font-semibold text-brand-darker">Something went wrong</h1>
      <p className="mt-2 text-muted">Please try again. If it keeps happening, give us a call.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => unstable_retry()} className="btn btn-gold">Try again</button>
        <Link href="/" className="btn btn-outline">Home page</Link>
      </div>
    </div>
  );
}
