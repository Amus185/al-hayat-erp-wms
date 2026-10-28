"use client";

import Link from "next/link";
import { HeartIcon } from "../icons";
import { savedItems } from "@/lib/local-list";

// Header link to the saved-items page, with how many are saved on this device.
export function SavedLink() {
  const count = savedItems.useSlugs().length;
  return (
    <Link
      href="/saved"
      aria-label={count ? `Saved items, ${count}` : "Saved items"}
      className="relative flex h-11 w-11 items-center justify-center rounded-md text-white hover:bg-white/10"
    >
      <HeartIcon className="h-6 w-6" />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 text-[11px] font-bold text-ink">{count}</span>
      )}
    </Link>
  );
}
