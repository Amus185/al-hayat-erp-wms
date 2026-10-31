import Link from "next/link";
import { ClockIcon, MailIcon, MapPinIcon, PhoneIcon } from "./icons";
import { Logo } from "./logo";
import { menuCategories } from "./navbar";
import { CONTACT_EMAIL, CONTACT_PHONE, OPENING_HOURS, PHONE_HREF, SHOWROOM_ADDRESS, SITE_NAME } from "@/lib/site";

export async function Footer() {
  const categories = await menuCategories();
  const linkClass = "hover:text-gold";
  return (
    <footer className="bg-brand-deep text-sm text-white/75">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo inverted />
          <p className="mt-5 max-w-xs leading-relaxed">
            Furniture from our showroom. Browse online, send us a request, and we call you to confirm stock, delivery and payment.
          </p>
        </div>
        <div>
          <h2 className="mb-4 font-sans text-xs font-semibold uppercase tracking-widest text-gold">Shop</h2>
          <ul className="space-y-2.5">
            {categories.map((c) => (
              <li key={c.id}><Link href={`/search?category=${encodeURIComponent(c.id)}`} className={linkClass}>{c.name}</Link></li>
            ))}
            <li><Link href="/search" className={linkClass}>All furniture</Link></li>
            <li><Link href="/search?sort=new" className={linkClass}>New arrivals</Link></li>
            <li><Link href="/search?sale=1" className={linkClass}>On sale</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-4 font-sans text-xs font-semibold uppercase tracking-widest text-gold">Help</h2>
          <ul className="space-y-2.5">
            <li><Link href="/how-to-order" className={linkClass}>How to order</Link></li>
            <li><Link href="/track" className={linkClass}>Track your order</Link></li>
            <li><Link href="/contact" className={linkClass}>Contact us</Link></li>
            <li><Link href="/saved" className={linkClass}>Saved items</Link></li>
            <li><Link href="/cart" className={linkClass}>Your cart</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-4 font-sans text-xs font-semibold uppercase tracking-widest text-gold">Contact</h2>
          <ul className="space-y-3">
            {PHONE_HREF && (
              <li className="flex gap-3"><PhoneIcon className="mt-0.5 h-4 w-4 flex-none text-gold" /><a href={PHONE_HREF} className="font-semibold text-white hover:text-gold">{CONTACT_PHONE}</a></li>
            )}
            {CONTACT_EMAIL && (
              <li className="flex gap-3"><MailIcon className="mt-0.5 h-4 w-4 flex-none text-gold" /><a href={`mailto:${CONTACT_EMAIL}`} className={`break-all ${linkClass}`}>{CONTACT_EMAIL}</a></li>
            )}
            {SHOWROOM_ADDRESS && (
              <li className="flex gap-3"><MapPinIcon className="mt-0.5 h-4 w-4 flex-none text-gold" /><span className="whitespace-pre-line">{SHOWROOM_ADDRESS}</span></li>
            )}
            {OPENING_HOURS && (
              <li className="flex gap-3"><ClockIcon className="mt-0.5 h-4 w-4 flex-none text-gold" /><span className="whitespace-pre-line">{OPENING_HOURS}</span></li>
            )}
            {!PHONE_HREF && !CONTACT_EMAIL && !SHOWROOM_ADDRESS && (
              <li><Link href="/contact" className={linkClass}>Get in touch</Link></li>
            )}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-white/55 sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.</p>
          <p>Prices and availability are confirmed when we call you.</p>
        </div>
      </div>
    </footer>
  );
}
