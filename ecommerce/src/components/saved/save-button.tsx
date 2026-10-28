"use client";

import { HeartIcon } from "../icons";
import { savedItems } from "@/lib/local-list";

// Heart toggle that saves a product on this device (no account needed).
export function SaveButton({ slug, name, variant = "icon" }: { slug: string; name: string; variant?: "icon" | "full" }) {
  const saved = savedItems.useSlugs().includes(slug);
  const label = saved ? `Remove ${name} from saved items` : `Save ${name}`;

  if (variant === "full") {
    return (
      <button
        type="button"
        onClick={() => savedItems.toggle(slug)}
        aria-pressed={saved}
        className={`btn border-[1.5px] ${saved ? "border-sale text-sale" : "border-line text-ink hover:border-brand-darker"}`}
      >
        <HeartIcon filled={saved} className={`h-5 w-5 ${saved ? "text-sale" : ""}`} />
        {saved ? "Saved" : "Save"}
        <span className="sr-only"> {name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => savedItems.toggle(slug)}
      aria-pressed={saved}
      aria-label={label}
      title={saved ? "Saved" : "Save for later"}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-ink shadow-sm transition hover:scale-105 hover:text-sale"
    >
      <HeartIcon filled={saved} className={`h-[18px] w-[18px] ${saved ? "text-sale" : ""}`} />
    </button>
  );
}
