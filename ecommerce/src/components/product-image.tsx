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
      <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400" aria-hidden="true">
        No photo
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
