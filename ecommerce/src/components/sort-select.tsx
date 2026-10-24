"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "name", label: "Name: A to Z" },
  { value: "new", label: "Newest first" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

// Changing the sort reloads the list from the first page, keeping every other filter.
export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="whitespace-nowrap text-muted">Sort by</span>
      <select
        aria-label="Sort products"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.target.value === "name") next.delete("sort");
          else next.set("sort", e.target.value);
          next.delete("page");
          const qs = next.toString();
          router.push(`${pathname}${qs ? `?${qs}` : ""}`);
        }}
        className="h-10 rounded-md border border-line bg-white pl-3 pr-8 text-sm font-medium"
      >
        {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
