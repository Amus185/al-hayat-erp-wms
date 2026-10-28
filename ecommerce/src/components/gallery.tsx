"use client";

import Image from "next/image";
import { useState, type KeyboardEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./icons";
import type { ProductImage } from "@/lib/types";

// Large photo with thumbnails (layout from Next.js Commerce, MIT). Plain state,
// no URL parameters. Arrow keys on the photo step through the photos.
export function Gallery({ images, name }: { images: ProductImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  if (!images.length) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-lg bg-canvas text-sm text-muted">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-12 w-12 opacity-50" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" /></svg>
        Photos coming soon
      </div>
    );
  }
  const i = Math.min(index, images.length - 1);
  const current = images[i];
  const many = images.length > 1;
  const step = (by: number) => setIndex((n) => (n + by + images.length) % images.length);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  };

  return (
    <div className="flex flex-col gap-3 md:flex-row-reverse">
      <div
        className="group relative aspect-square w-full overflow-hidden rounded-lg bg-canvas"
        role="region"
        aria-roledescription="carousel"
        aria-label={`Photos of ${name}`}
        tabIndex={many ? 0 : undefined}
        onKeyDown={many ? onKey : undefined}
      >
        <Image key={current.url} src={current.url} alt={current.alt || name} fill preload sizes="(min-width: 1024px) 50vw, 100vw" className="animate-fade-in object-cover" />
        {many && (
          <>
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow transition hover:bg-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
              <ChevronLeftIcon />
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Next photo" className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-ink shadow transition hover:bg-white md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100">
              <ChevronRightIcon />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-ink/70 px-2.5 py-1 text-xs font-medium text-white" aria-live="polite">
              {i + 1} / {images.length}
            </span>
          </>
        )}
      </div>
      {many && (
        <ul className="flex gap-2 overflow-x-auto md:w-20 md:flex-none md:flex-col md:overflow-visible" aria-label="Choose a photo">
          {images.map((img, n) => (
            <li key={img.url} className="h-[72px] w-[72px] flex-none md:h-20 md:w-20">
              <button
                type="button"
                onClick={() => setIndex(n)}
                aria-label={`Show photo ${n + 1} of ${images.length}`}
                aria-current={n === i}
                className={`relative h-full w-full overflow-hidden rounded-md bg-canvas ring-offset-2 transition ${n === i ? "ring-2 ring-brand-darker" : "opacity-75 hover:opacity-100"}`}
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
