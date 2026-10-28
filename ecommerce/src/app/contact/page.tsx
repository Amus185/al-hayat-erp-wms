import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClockIcon, MailIcon, MapPinIcon, PhoneIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { PHOTOS } from "@/lib/photos";
import { CONTACT_EMAIL, CONTACT_PHONE, OPENING_HOURS, PHONE_HREF, SHOWROOM_ADDRESS } from "@/lib/site";

export const metadata: Metadata = { title: "Contact us", description: "Call or visit our furniture showroom." };

// Only the contact details the shop has configured are shown: nothing is made up.
export default function ContactPage() {
  const items = [
    PHONE_HREF && { Icon: PhoneIcon, label: "Phone", body: <a href={PHONE_HREF} className="text-lg font-semibold text-brand-darker hover:underline">{CONTACT_PHONE}</a> },
    CONTACT_EMAIL && { Icon: MailIcon, label: "Email", body: <a href={`mailto:${CONTACT_EMAIL}`} className="break-all font-medium text-brand-darker hover:underline">{CONTACT_EMAIL}</a> },
    SHOWROOM_ADDRESS && { Icon: MapPinIcon, label: "Showroom", body: <p className="whitespace-pre-line">{SHOWROOM_ADDRESS}</p> },
    OPENING_HOURS && { Icon: ClockIcon, label: "Opening hours", body: <p className="whitespace-pre-line">{OPENING_HOURS}</p> },
  ].filter(Boolean) as { Icon: typeof PhoneIcon; label: string; body: ReactNode }[];

  return (
    <>
      <PageHeader title="Contact us" crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]}>
        <p className="mt-2 max-w-2xl text-muted">Questions about a piece, sizes or delivery? We are happy to help.</p>
      </PageHeader>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 lg:grid-cols-2">
        <div>
          {items.length > 0 ? (
            <ul className="space-y-4">
              {items.map(({ Icon, label, body }) => (
                <li key={label} className="flex gap-4 rounded-lg border border-line p-5">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-darker text-gold"><Icon /></span>
                  <div>
                    <h2 className="font-sans text-xs font-semibold uppercase tracking-widest text-muted">{label}</h2>
                    <div className="mt-1">{body}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-line bg-canvas p-6 text-muted">
              Send us an order request from your cart and we will call you on the number you give us.
            </p>
          )}

          <div className="mt-8 rounded-lg bg-cream p-6">
            <h2 className="text-xl font-semibold text-brand-darker">Ready to order?</h2>
            <p className="mt-1.5 text-ink/80">Add pieces to your cart and send a request. We call you back to confirm everything. No payment online.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="/search" className="btn btn-gold">Browse furniture</Link>
              <Link href="/how-to-order" className="btn btn-outline">How ordering works</Link>
            </div>
          </div>
        </div>

        <div className="relative min-h-[320px] overflow-hidden rounded-lg lg:min-h-full">
          <Image src={PHOTOS.living.src} alt={PHOTOS.living.alt} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        </div>
      </div>
    </>
  );
}
