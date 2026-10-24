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
}

/** What the cart keeps in the browser: only which products and how many. */
export interface CartItem {
  slug: string;
  quantity: number;
}

/** A cart line shown to the customer, always built from fresh ERP data. */
export interface CartLine {
  slug: string;
  name: string;
  price: number;
  image: ProductImage | null;
  availability: Availability;
  quantity: number;
}

export const MAX_QUANTITY_PER_ITEM = 20;
export const MAX_CART_LINES = 20;
