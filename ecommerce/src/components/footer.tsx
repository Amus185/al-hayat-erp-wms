import Link from "next/link";
import { Logo } from "./logo";
import { menuCategories } from "./navbar";
import { CONTACT_PHONE, SITE_NAME } from "@/lib/site";

export async function Footer() {
  const categories = await menuCategories();
  const phoneHref = CONTACT_PHONE ? `tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}` : null;
  return (
    <footer className="mt-16 bg-brand-darker text-sm text-white/80">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo inverted />
          <p className="mt-4 max-w-xs leading-relaxed">Furniture showroom. Browse online, send us a request, and we call you to confirm stock, delivery and payment.</p>
        </div>
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-accent">Shop</h2>
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.id}><Link href={`/search?category=${encodeURIComponent(c.id)}`} className="hover:text-white hover:underline">{c.name}</Link></li>
            ))}
            <li><Link href="/search" className="hover:text-white hover:underline">All furniture</Link></li>
            <li><Link href="/search?sale=1" className="hover:text-white hover:underline">On sale</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-accent">How ordering works</h2>
          <ol className="list-inside list-decimal space-y-2">
            <li>Add pieces to your cart</li>
            <li>Send us your request</li>
            <li>We call to confirm</li>
            <li>Pay on confirmation</li>
          </ol>
        </div>
        <div>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-accent">Contact</h2>
          {phoneHref ? (
            <a href={phoneHref} className="text-lg font-semibold text-white hover:underline">{CONTACT_PHONE}</a>
          ) : (
            <p>Visit our showroom.</p>
          )}
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-white/60">
        &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
      </div>
    </footer>
  );
}
