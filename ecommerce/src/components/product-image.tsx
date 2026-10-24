import Image from "next/image";
import type { ProductImage as ProductImageData } from "@/lib/types";

// All product photos go through next/image, which resizes them: the ERP
// accepts photos up to 5 MB and customers should never download those.
export function ProductImage({
  image,
  name,
  sizes,
  preload,
  className = "",
}: {
  image: ProductImageData | null | undefined;
  name: string;
  sizes: string;
  preload?: boolean;
  className?: string;
}) {
  if (!image) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-canvas text-xs text-muted" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-8 w-8 opacity-50"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" /></svg>
        Photo coming soon
      </div>
    );
  }
  return (
    <Image
      src={image.url}
      alt={image.alt || name}
      fill
      sizes={sizes}
      preload={preload}
      className={`object-cover ${className}`}
    />
  );
}
