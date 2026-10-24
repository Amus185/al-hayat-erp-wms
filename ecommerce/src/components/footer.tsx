import Link from "next/link";
import { CONTACT_PHONE, SITE_NAME } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-12 border-t border-neutral-200 text-sm text-neutral-500">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-semibold uppercase text-black">{SITE_NAME}</p>
          <p className="mt-1">Furniture showroom. Order requests are confirmed by phone.</p>
        </div>
        <ul className="flex flex-wrap gap-5">
          <li><Link href="/search" className="hover:text-black hover:underline">All furniture</Link></li>
          {CONTACT_PHONE && <li><a href={`tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}`} className="hover:text-black hover:underline">Call {CONTACT_PHONE}</a></li>}
        </ul>
      </div>
      <div className="border-t border-neutral-200 py-5 text-center">
        &copy; {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
      </div>
    </footer>
  );
}
