import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, PhoneIcon } from "@/components/icons";
import { CONTACT_PHONE, PHONE_HREF } from "@/lib/site";

export const metadata: Metadata = { title: "Request received", robots: { index: false, follow: false } };

type SearchParams = Promise<{ ref?: string }>;

const NEXT = [
  "We check your items in our showroom.",
  "We call you on the number you gave to confirm stock, the final price and delivery.",
  "You pay once everything is agreed. Nothing has been charged.",
];

export default async function ThankYouPage({ searchParams }: { searchParams: SearchParams }) {
  const { ref } = await searchParams;
  // Only show the reference if it has the exact shape the shop issues.
  const reference = ref && /^WR-[0-9A-Z-]{1,24}$/.test(ref) ? ref : null;
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <div className="rounded-lg border border-line bg-white p-8 text-center shadow-sm md:p-12">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-darker text-gold">
          <CheckIcon className="h-8 w-8" strokeWidth={2.2} />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-brand-darker">Thank you. We got your request.</h1>
        {reference && (
          <p className="mt-4 inline-block rounded-md bg-cream px-4 py-2 text-sm">
            Your reference: <strong className="font-mono text-base">{reference}</strong>
          </p>
        )}
        <ol className="mx-auto mt-8 max-w-md space-y-3 text-left text-sm">
          {NEXT.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gold-light text-xs font-semibold text-gold-dark">{i + 1}</span>
              <span className="text-ink/80">{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {reference && <Link href={`/track?ref=${encodeURIComponent(reference)}`} className="btn btn-gold">Track this order</Link>}
          <Link href="/search" className={reference ? "btn btn-outline" : "btn btn-gold"}>Keep browsing</Link>
          {PHONE_HREF && <a href={PHONE_HREF} className="btn btn-outline"><PhoneIcon /> Call {CONTACT_PHONE}</a>}
        </div>
      </div>
    </div>
  );
}
