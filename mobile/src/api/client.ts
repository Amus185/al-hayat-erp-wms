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

// Better Auth sign-in (/api/auth). The session token is kept in memory only
// and sent as Authorization: Bearer. Persisting it requires the platform
// keystore (expo-secure-store / Keychain / Android Keystore); until that
// dependency is added, the user signs in again after the app is closed.
// AsyncStorage is never used for tokens.
const AUTH_BASE_URL = API_BASE_URL.replace(/\/api\/v1$/, '/api/auth');
let authToken: string | null = null;

// Identifies the mobile app, so sign-in hands back the session token.
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
}

export function getAuthToken() {
  return authToken;
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

  const response = await fetch(url, config);

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
  const res = await fetch(`${AUTH_BASE_URL}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...NATIVE_HEADERS },
    body: JSON.stringify(data),
  });
  const token = res.headers.get('set-auth-token');
  if (!res.ok || !token) {
    const body = await res.json().catch(() => null);
    throw new Error(res.status === 401 ? 'Invalid email or password' : body?.message || `Sign-in failed (${res.status})`);
  }
  authToken = token;
  const me = await request<{ user: LoginResponse['user'] }>('/auth/me');
  return { token, user: me.user };
}

/** Ends the session on the server, then forgets the token. */
export async function logout(): Promise<void> {
  const token = authToken;
  authToken = null;
  if (token) {
    try {
      await fetch(`${AUTH_BASE_URL}/sign-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...NATIVE_HEADERS },
        body: '{}',
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
