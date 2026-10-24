import Image from "next/image";
import Link from "next/link";
import { ChevronRightIcon } from "./icons";
import { roomPhotoFor } from "@/lib/photos";
import type { Category } from "@/lib/types";

// Picture cards for shopping by room or type. The photo is the category's own
// (or one of its products' photos, as chosen by the ERP); a category with no
// photo at all gets a room photo matching its name.
export function CategoryCards({ categories }: { categories: Category[] }) {
  if (!categories.length) return null;
  return (
    <ul className={`grid grid-cols-2 gap-3 sm:gap-5 ${categories.length % 4 === 0 ? "lg:grid-cols-4" : "md:grid-cols-3"}`}>
      {categories.map((c) => {
        const photo = c.image ?? { url: roomPhotoFor(c.name).src, alt: roomPhotoFor(c.name).alt };
        return (
          <li key={c.id}>
            <Link href={`/search?category=${encodeURIComponent(c.id)}`} className="group relative block aspect-[4/5] overflow-hidden rounded-lg bg-canvas sm:aspect-[4/4.5]">
              <Image
                src={photo.url}
                alt=""
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover transition duration-700 group-hover:scale-105"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-brand-deep/85 via-brand-deep/10 to-transparent" aria-hidden="true" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-4 text-white sm:p-5">
                <span>
                  <span className="block font-display text-lg font-semibold sm:text-xl">{c.name}</span>
                  <span className="text-xs text-white/80 sm:text-sm">{c.productCount} piece{c.productCount === 1 ? "" : "s"}</span>
                </span>
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gold text-ink transition group-hover:translate-x-0.5" aria-hidden="true">
                  <ChevronRightIcon className="h-4 w-4" />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
