"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-neutral-600">Please try again. If it keeps happening, give us a call.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white">Try again</button>
    </div>
  );
}
