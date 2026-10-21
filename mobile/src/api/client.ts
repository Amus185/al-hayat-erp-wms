import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  LoginRequest,
  LoginResponse,
  Warehouse,
  WarehouseLocation,
  Product,
  InventoryStock,
  PurchaseOrder,
  CreateTransferRequest,
  Transfer,
  CreateGoodsReceiptRequest,
  CreateAdjustmentRequest,
  Notification
} from '../types';

export const API_BASE_URL = 'http://localhost:3000/api/v1'; // On Android emulator, use http://10.0.2.2:3000/api/v1

// Legacy builds persisted the access token in AsyncStorage (unencrypted).
const LEGACY_TOKEN_KEY = 'al_hayat_wms_token';

// Tokens are kept in memory only. Persisting the refresh token requires the
// platform keystore (expo-secure-store / Keychain / Android Keystore); until
// that dependency is added (see docs/audit/AUTHENTICATION.md), the user signs
// in again after the app is closed. AsyncStorage is never used for tokens.
let authToken: string | null = null;
let refreshToken: string | null = null;

// Native clients identify themselves so the server returns the refresh token
// in the body (no cookie) and accepts it back in the body.
const NATIVE_HEADERS = { 'X-Client-Type': 'native' };

export async function initializeClient(): Promise<string | null> {
  try {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore
  }
  return authToken;
}

export async function setAuthToken(token: string | null) {
  authToken = token;
  if (!token) refreshToken = null;
}

export function getAuthToken() {
  return authToken;
}

let refreshing: Promise<boolean> | null = null;

/** Exchange the refresh token for a new pair (single-flight). */
async function refreshTokens(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...NATIVE_HEADERS },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) { authToken = null; refreshToken = null; return false; }
        const data = await res.json();
        authToken = data.accessToken;
        refreshToken = data.refreshToken;
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

// HTTP Helpers
async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const headers = new Headers(options.headers);

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const config: RequestInit = {
    ...options,
    headers,
  };

  let response = await fetch(url, config);
  if (response.status === 401 && !path.startsWith('/auth/') && await refreshTokens()) {
    headers.set('Authorization', `Bearer ${authToken}`);
    response = await fetch(url, { ...config, headers });
  }

  if (!response.ok) {
    let errorMessage = `HTTP Request failed with status ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData && errorData.message) {
        errorMessage = Array.isArray(errorData.message)
          ? errorData.message.join(', ')
          : errorData.message;
      }
    } catch {
      // JSON parsing failed, keep default message
    }
    throw new Error(errorMessage);
  }

  // Handle empty or 204 response
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  get: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: any, options?: RequestInit) =>
    request<T>(path, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string, options?: RequestInit) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};

// ── Specific Endpoints ─────────────────────────────────

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>('/auth/login', data, { headers: NATIVE_HEADERS });
  authToken = res?.accessToken ?? null;
  refreshToken = res?.refreshToken ?? null;
  return res;
}

/** Ends the session on the server, then forgets the tokens. */
export async function logout(): Promise<void> {
  const token = refreshToken;
  authToken = null;
  refreshToken = null;
  if (token) {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...NATIVE_HEADERS },
        body: JSON.stringify({ refreshToken: token }),
      });
    } catch {
      // offline: the session still expires server-side
    }
  }
}

export async function barcodeLookup(barcode: string): Promise<any> {
  return api.get<any>(`/products/barcode/${encodeURIComponent(barcode)}`);
}

export async function getWarehouses(): Promise<Warehouse[]> {
  return api.get<Warehouse[]>('/warehouses');
}

export async function getWarehouseLocations(warehouseId: string): Promise<WarehouseLocation[]> {
  return api.get<WarehouseLocation[]>(`/warehouses/${warehouseId}/locations`);
}

export async function getProducts(search?: string): Promise<Product[]> {
  const query = search ? `?q=${encodeURIComponent(search)}` : '';
  return api.get<Product[]>(`/products${query}`);
}

export async function getStock(): Promise<InventoryStock[]> {
  return api.get<InventoryStock[]>('/inventory/stock');
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  return api.get<PurchaseOrder[]>('/purchase-orders');
}

export async function createTransfer(data: CreateTransferRequest): Promise<Transfer> {
  return api.post<Transfer>('/transfers', data);
}

export async function createGoodsReceipt(data: CreateGoodsReceiptRequest): Promise<any> {
  return api.post<any>('/goods-receipts', data);
}

export async function adjustStock(data: CreateAdjustmentRequest): Promise<any> {
  return api.post<any>('/inventory/adjustments', data);
}

export async function getNotifications(): Promise<Notification[]> {
  return api.get<Notification[]>('/notifications');
}

export async function markNotificationRead(id: string): Promise<Notification> {
  return api.patch<Notification>(`/notifications/${id}/read`);
}
