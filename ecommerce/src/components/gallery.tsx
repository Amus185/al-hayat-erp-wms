"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/lib/types";

// Large photo with thumbnails (layout from Next.js Commerce, MIT). Plain state,
// no URL parameters.
export function Gallery({ images, name }: { images: ProductImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  if (!images.length) {
    return <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-400">No photo yet</div>;
  }
  const current = images[Math.min(index, images.length - 1)];
  const step = (by: number) => setIndex((i) => (i + by + images.length) % images.length);

  return (
    <div>
      <div className="relative aspect-square max-h-[550px] w-full overflow-hidden rounded-lg bg-neutral-100">
        <Image src={current.url} alt={current.alt || name} fill preload sizes="(min-width: 1024px) 60vw, 100vw" className="object-contain" />
        {images.length > 1 && (
          <div className="absolute bottom-4 flex w-full justify-center">
            <div className="flex h-11 items-center rounded-full border border-white bg-neutral-50/80 text-neutral-600 backdrop-blur-sm">
              <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="flex h-full items-center px-5 hover:text-black">←</button>
              <div className="h-6 w-px bg-neutral-400" />
              <button type="button" onClick={() => step(1)} aria-label="Next photo" className="flex h-full items-center px-5 hover:text-black">→</button>
            </div>
          </div>
        )}
      </div>
      {images.length > 1 && (
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {images.map((img, i) => (
            <li key={img.url} className="h-20 w-20">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                aria-current={i === index}
                className={`relative h-full w-full overflow-hidden rounded-lg border bg-white ${i === index ? "border-2 border-brand" : "border-neutral-200 hover:border-brand"}`}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
