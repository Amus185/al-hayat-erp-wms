import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_PHONE } from "@/lib/site";

export const metadata: Metadata = { title: "Request received", robots: { index: false, follow: false } };

type SearchParams = Promise<{ ref?: string }>;

export default async function ThankYouPage({ searchParams }: { searchParams: SearchParams }) {
  const { ref } = await searchParams;
  // Only show the reference if it has the exact shape the shop issues.
  const reference = ref && /^WR-[0-9A-Z-]{1,24}$/.test(ref) ? ref : null;
  return (
    <div className="mx-auto max-w-xl px-4 py-12 text-center">
      <div className="rounded-lg border border-neutral-200 bg-white p-8">
        <h1 className="text-2xl font-bold">Thank you. We got your request.</h1>
        {reference && <p className="mt-3 text-sm text-neutral-600">Your reference: <strong className="font-mono">{reference}</strong></p>}
        <p className="mt-4 text-neutral-600">
          We will call you soon to confirm availability, delivery and payment. Nothing has been charged.
        </p>
        {CONTACT_PHONE && <p className="mt-2 text-sm text-neutral-500">Need us sooner? Call {CONTACT_PHONE}.</p>}
        <Link href="/search" className="mt-6 inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-brand-dark">Keep browsing</Link>
      </div>
    </div>
  );
}
