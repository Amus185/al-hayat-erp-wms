"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CONTACT_PHONE, PHONE_HREF } from "@/lib/site";

// Shown when the ERP cannot be reached. "Try again" asks the server to render
// the page again (a real reload of the data), and shows that it is working.
// `detail` is the real cause, passed only in development (see devErrorDetail).
export function CatalogUnavailable({ detail, compact = false }: { detail?: string | null; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div role="alert" className={`rounded-lg border border-line bg-canvas text-center ${compact ? "p-6" : "p-8"}`}>
      <p className="font-semibold">Our catalog is temporarily unavailable.</p>
      <p className="mt-1 text-sm text-muted">
        Please try again in a moment{PHONE_HREF ? <>, or call us on <a href={PHONE_HREF} className="underline">{CONTACT_PHONE}</a></> : null}.
      </p>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="btn btn-green mt-4"
      >
        {pending ? "Trying again…" : "Try again"}
      </button>
      {detail && (
        <p className="mx-auto mt-5 max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-3 text-left font-mono text-xs text-amber-900">
          <strong>Development only:</strong> {detail}
        </p>
      )}
    </div>
  );
}
