import type { Metadata } from "next";
import Link from "next/link";
import { FeaturesRow } from "@/components/features-row";
import { PhoneIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { CONTACT_PHONE, PHONE_HREF } from "@/lib/site";

export const metadata: Metadata = {
  title: "How to order",
  description: "How ordering works: choose your pieces, send a request, we call you to confirm, then you pay and we deliver.",
};

const STEPS = [
  { title: "Choose your pieces", text: "Browse the collection. Each product shows whether it is in stock in our showroom right now. Add what you like to your cart, or press Buy now to go straight to checkout." },
  { title: "Send your request", text: "Give us your name and phone number, and your delivery address if you have it. There is no account to create and no payment to make online." },
  { title: "We call you", text: "Our team checks your items and calls you to confirm stock, the final price and a delivery date. This is a good moment to ask about sizes, colours or anything else." },
  { title: "Pay and receive", text: "You pay once everything is agreed with you, and we deliver on the date we agreed together." },
];

const FAQ = [
  { q: "Do I pay anything online?", a: "No. Sending a request is free and commits you to nothing. You pay only after we have called and agreed everything with you." },
  { q: "Is the stock on the website real?", a: "Yes. Availability comes straight from our showroom stock. If something sells out while you are deciding, we tell you when we call." },
  { q: "Can the price change?", a: "The price you see is our current price. We confirm the final amount, including any delivery, when we call." },
  { q: "How soon will you call?", a: `As soon as we have checked your items.${CONTACT_PHONE ? ` If you need us sooner, call ${CONTACT_PHONE}.` : ""}` },
];

export default function HowToOrderPage() {
  return (
    <>
      <PageHeader title="How to order" crumbs={[{ href: "/", label: "Home" }, { label: "How to order" }]}>
        <p className="mt-2 max-w-2xl text-muted">Ordering takes a few minutes and you never pay before we have spoken to you.</p>
      </PageHeader>

      <div className="mx-auto max-w-5xl px-4 py-12">
        <ol className="space-y-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-5 rounded-lg border border-line p-6">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-darker font-display text-lg font-semibold text-gold">{i + 1}</span>
              <div>
                <h2 className="text-xl font-semibold text-brand-darker">{s.title}</h2>
                <p className="mt-1.5 leading-7 text-ink/80">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <section className="mt-14" aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="text-2xl font-semibold text-brand-darker">Questions</h2>
          <div className="mt-5 divide-y divide-line rounded-lg border border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-xl text-gold-dark transition group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 leading-7 text-ink/80">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link href="/search" className="btn btn-gold">Start shopping</Link>
          {PHONE_HREF && <a href={PHONE_HREF} className="btn btn-outline"><PhoneIcon /> Call {CONTACT_PHONE}</a>}
        </div>
      </div>

      <div data-flush-footer className="border-t border-line"><FeaturesRow /></div>
    </>
  );
}
