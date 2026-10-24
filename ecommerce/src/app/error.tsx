"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center" role="alert">
      <h1 className="text-3xl font-semibold text-brand-darker">Something went wrong</h1>
      <p className="mt-2 text-muted">Please try again. If it keeps happening, give us a call.</p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className="btn btn-gold">Try again</button>
        <Link href="/" className="btn btn-outline">Home page</Link>
      </div>
    </div>
  );
}
