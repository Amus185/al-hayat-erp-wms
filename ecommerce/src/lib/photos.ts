// Marketing photography (home hero, room banners, promo). Product pages never
// use these: they always show the shop's own product photos from the ERP.
//
// All photos are from Unsplash under the Unsplash License (free for commercial
// use, no permission needed). Credits are kept here and in PHOTO_CREDITS.md.
// Only images.unsplash.com is allow-listed in next.config.ts.

export interface StockPhoto {
  src: string;
  alt: string;
  credit: string;
}

const unsplash = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=2000&q=80`;

export const PHOTOS = {
  hero: {
    src: unsplash("photo-1618221195710-dd6b41faaea6"),
    alt: "Bright living room with a cream sofa, wooden side table and plants",
    credit: "Spacejoy",
  },
  living: {
    src: unsplash("photo-1631679706909-1844bbd07221"),
    alt: "Living room with a sofa, armchair and a round mirror",
    credit: "Spacejoy",
  },
  bedroom: {
    src: unsplash("photo-1616486029423-aaa4789e8c9a"),
    alt: "Bedroom with an upholstered bed, a leather bench and wall art",
    credit: "Spacejoy",
  },
  dining: {
    src: unsplash("photo-1617806118233-18e1de247200"),
    alt: "Dining room with a wooden table and green chairs",
    credit: "Spacejoy",
  },
  office: {
    src: unsplash("photo-1777896193454-8b4863264f0b"),
    alt: "Bright study with bookshelves and two desks by the windows",
    credit: "Clay Banks",
  },
  promo: {
    src: unsplash("photo-1615873968403-89e068629265"),
    alt: "Tan leather sofa against a deep green wall with framed pictures",
    credit: "Spacejoy",
  },
} satisfies Record<string, StockPhoto>;

/** A room photo for a category, chosen by its name (e.g. "Bedroom" → the bedroom photo). */
export function roomPhotoFor(name: string): StockPhoto {
  const n = name.toLowerCase();
  if (/bed|sleep|wardrobe|night/.test(n)) return PHOTOS.bedroom;
  if (/din|kitchen|table|chair/.test(n)) return PHOTOS.dining;
  if (/office|study|desk|work|book/.test(n)) return PHOTOS.office;
  return PHOTOS.living;
}
