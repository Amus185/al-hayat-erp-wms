import Image from "next/image";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

// The Al Hayat palm logo (same file as the staff app) with the wordmark.
export function Logo({ inverted = false }: { inverted?: boolean }) {
  const [first, ...rest] = SITE_NAME.split(" ");
  return (
    <Link href="/" className="flex flex-none items-center gap-2.5 rounded-md" aria-label={`${SITE_NAME} home`}>
      <Image src="/logo.png" alt="" width={44} height={44} className="h-10 w-10 rounded-full bg-white md:h-11 md:w-11" preload />
      <span className="leading-none">
        <span className={`block font-display text-base font-bold uppercase tracking-wide md:text-lg ${inverted ? "text-white" : "text-brand-darker"}`}>
          {rest.length ? `${first} ${rest[0]}` : first}
        </span>
        {rest.length > 1 && (
          <span className={`mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.25em] ${inverted ? "text-gold" : "text-brand"}`}>{rest.slice(1).join(" ")}</span>
        )}
      </span>
    </Link>
  );
}
