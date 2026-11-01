// Staff-side storefront API (publishing, photos, website requests, settings).
// Every call goes through the shared client, so it carries the session token
// and renews it on expiry. Photos are the one exception: the browser uploads
// straight to Cloudflare R2 with a short-lived presigned URL, so the file
// never passes through the backend.
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface WebImage {
  id: string;
  key: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
  url: string | null;
}

export interface ProductWeb {
  id: string;
  name: string;
  isPublished: boolean;
  slug: string | null;
  webDescription: string | null;
  sellingPrice: number;
  /** "Was" price shown crossed out on the website; display only. */
  compareAtPrice: number | null;
  isFeatured: boolean;
  /** Units still for sale online; null = all stock at the web branch. */
  webQuantity: number | null;
  /** The branch the shop sells from, and this product's stock there (after the safety buffer). */
  sellsFrom: string | null;
  stockAtWebBranch: number;
  images: WebImage[];
}

export interface WebCategory {
  id: string;
  name: string;
  publishedCount: number;
  imageUrl: string | null;
}

export interface StorefrontSettings {
  locationId: string | null;
  safetyBuffer: number;
  lowStockThreshold: number;
  showQuantities: boolean;
  /** An unconfirmed web order releases its stock after this many hours (0 = never). */
  holdHours: number;
  branches: { id: string; name: string }[];
  imagesConfigured: boolean;
  requestsConfigured: boolean;
}

export type RequestStatus = 'NEW' | 'PROCESSING' | 'CONVERTED' | 'CANCELLED';

export interface WebRequestRow {
  id: string;
  request_number: string;
  customer_name: string;
  phone: string;
  status: RequestStatus;
  total_amount: number;
  created_at: string;
  converted_order_id: string | null;
  line_count: number;
  /** The sales order this request became, and how far it has got. */
  order_number: string | null;
  order_status: string | null;
  delivery_status: string | null;
  /** Units still held for this request (released when the sale issues stock or is cancelled). */
  reserved_units: number;
  stage: WebOrderStage;
}

export type WebOrderStage = 'NEW' | 'ORDERED' | 'INVOICED' | 'PAID' | 'DELIVERY_SCHEDULED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export interface WebRequestDetail extends Omit<WebRequestRow, 'line_count' | 'order_number' | 'order_status' | 'delivery_status' | 'reserved_units' | 'stage'> {
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  /** Set when the order was cancelled automatically (e.g. not confirmed in time). */
  cancel_reason?: string | null;
  lines: { product_id: string; product_name: string; quantity: number; unit_price: number }[];
}

export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const base = '/storefront-admin';

export const getProductWeb = (id: string) => apiGet<ProductWeb>(`${base}/products/${id}`);

export const saveProductWeb = (
  id: string,
  body: { isPublished?: boolean; slug?: string; webDescription?: string; compareAtPrice?: number | null; isFeatured?: boolean; webQuantity?: number | null },
) =>
  apiPatch<ProductWeb>(`${base}/products/${id}`, body);

export const reorderImages = (id: string, imageIds: string[]) =>
  apiPatch<{ images: WebImage[] }>(`${base}/products/${id}/images/order`, { imageIds });

export const deleteImage = (id: string, imageId: string) =>
  apiDelete<{ images: WebImage[] }>(`${base}/products/${id}/images/${imageId}`);

/** Why a file cannot be used as a product photo, or null if it is fine. */
export function photoProblem(file: File): string | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) return `${file.name}: only JPEG, PNG or WebP photos are allowed.`;
  if (file.size > MAX_PHOTO_BYTES) return `${file.name}: photos must be 5 MB or smaller.`;
  return null;
}

/**
 * Presign, upload straight to R2, then register the photo with the ERP.
 * Shared by product and category photos; returns the registration response.
 */
async function uploadPhoto<T>(presignPath: string, registerPath: string, file: File): Promise<T> {
  const problem = photoProblem(file);
  if (problem) throw new Error(problem);

  const presigned = await apiPost<{ key: string; uploadUrl: string }>(presignPath, {
    contentType: file.type,
    size: file.size,
  });

  let put: Response;
  try {
    // No Authorization header and no cookies: the URL itself carries the signature.
    put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, credentials: 'omit' });
  } catch {
    throw new Error('The photo could not be sent to storage. Check your connection, and that the storage bucket allows uploads from this site (CORS).');
  }
  if (!put.ok) throw new Error(`Photo storage refused the upload (status ${put.status}).`);

  return apiPost<T>(registerPath, { key: presigned.key, alt: file.name.replace(/\.[^.]+$/, '') });
}

export async function uploadProductPhoto(productId: string, file: File): Promise<WebImage[]> {
  const done = await uploadPhoto<{ images: WebImage[] }>(`${base}/products/${productId}/images/presign`, `${base}/products/${productId}/images`, file);
  return done.images;
}

export const listWebCategories = () => apiGet<WebCategory[]>(`${base}/categories`);

export async function uploadCategoryPhoto(categoryId: string, file: File): Promise<string | null> {
  const done = await uploadPhoto<{ imageUrl: string | null }>(`${base}/categories/${categoryId}/image/presign`, `${base}/categories/${categoryId}/image`, file);
  return done.imageUrl;
}

export const removeCategoryPhoto = (categoryId: string) => apiDelete<{ imageUrl: null }>(`${base}/categories/${categoryId}/image`);

export const getStorefrontSettings = () => apiGet<StorefrontSettings>(`${base}/settings`);

export const saveStorefrontSettings = (body: { locationId?: string; safetyBuffer?: number; lowStockThreshold?: number; showQuantities?: boolean; holdHours?: number }) =>
  apiPatch<Omit<StorefrontSettings, 'branches' | 'imagesConfigured' | 'requestsConfigured'>>(`${base}/settings`, body);

export const listWebRequests = (status?: RequestStatus) =>
  apiGet<WebRequestRow[]>(`${base}/requests${status ? `?status=${status}` : ''}`);

export const getWebRequest = (id: string) => apiGet<WebRequestDetail>(`${base}/requests/${id}`);

export const convertWebRequest = (id: string) =>
  apiPost<{ orderId: string; orderNumber: string | null }>(`${base}/requests/${id}/convert`);

export const cancelWebRequest = (id: string) => apiPost<{ success: boolean }>(`${base}/requests/${id}/cancel`);

// ── Online store section ────────────────────────────────────────────────────

export interface StoreOverview {
  orders: { awaiting: number; today: number; todayValue: number; month: number; monthValue: number };
  publishedProducts: number;
  lowOrOut: { id: string; name: string; units: number }[];
  sellsFrom: string | null;
  imagesConfigured: boolean;
  requestsConfigured: boolean;
}

export interface StoreProduct {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  compareAtPrice: number | null;
  isPublished: boolean;
  isFeatured: boolean;
  slug: string | null;
  photoCount: number;
  photoUrl: string | null;
  /** Units the shop can sell now: on hand - reserved - safety buffer, at the web branch. */
  webUnits: number;
  availability: 'IN_STOCK' | 'LOW' | 'OUT';
  /** Units still for sale online; null = no limit. */
  webQuantity: number | null;
}

export const getStoreOverview = () => apiGet<StoreOverview>(`${base}/overview`);
export const listStoreProducts = (search?: string) => apiGet<StoreProduct[]>(`${base}/products`, search ? { search } : undefined);

/** The public shop's address (VITE_SHOP_URL), for "Open the shop" links. */
export const SHOP_URL = ((import.meta as any).env?.VITE_SHOP_URL as string | undefined)?.replace(/\/$/, '') || '';
