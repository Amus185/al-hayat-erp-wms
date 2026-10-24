// Shapes returned by the ERP's public storefront API (/api/v1/storefront).
// The ERP builds these through a whitelist: cost, stock counts and internal
// ids never appear here.

export type Availability = "IN_STOCK" | "LOW" | "OUT";

export interface ProductImage {
  url: string;
  alt: string | null;
}

export interface Product {
  slug: string;
  name: string;
  description: string | null;
  price: number;
  /** "Was" price for a sale; only present when it is higher than price. */
  compareAtPrice: number | null;
  /** Published within the last 30 days. */
  isNew: boolean;
  category: { id: string; name: string | null } | null;
  images: ProductImage[];
  availability: Availability;
}

export interface ProductPage {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  productCount: number;
  image: ProductImage | null;
}

/** What the cart keeps in the browser: only which products and how many. */
export interface CartItem {
  slug: string;
  quantity: number;
}

/** Fresh card data for a product the browser only knows by slug (cart, saved items, recently viewed). */
export interface ProductSummary {
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  image: ProductImage | null;
  availability: Availability;
}

/** A cart line shown to the customer, always built from fresh ERP data. */
export interface CartLine extends ProductSummary {
  quantity: number;
}

export const MAX_QUANTITY_PER_ITEM = 20;
export const MAX_CART_LINES = 20;
