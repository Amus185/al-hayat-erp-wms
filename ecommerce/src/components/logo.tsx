import Image from "next/image";
import Link from "next/link";
import { SITE_NAME } from "@/lib/site";

// The Al Hayat palm logo (same file as the staff app) with the wordmark.
export function Logo({ inverted = false }: { inverted?: boolean }) {
  const [first, ...rest] = SITE_NAME.split(" ");
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${SITE_NAME} home`}>
      <Image src="/logo.png" alt="" width={44} height={44} className="h-11 w-11 rounded-full" preload />
      <span className="leading-none">
        <span className={`block text-lg font-extrabold uppercase tracking-tight ${inverted ? "text-white" : "text-brand-darker"}`}>{rest.length ? `${first} ${rest[0]}` : first}</span>
        {rest.length > 1 && (
          <span className={`block text-[10px] font-semibold uppercase tracking-[0.25em] ${inverted ? "text-accent" : "text-brand"}`}>{rest.slice(1).join(" ")}</span>
        )}
      </span>
    </Link>
  );
}
