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

const TOKEN_KEY = 'al_hayat_wms_token';

let authToken: string | null = null;

// Initialize token from storage
export async function initializeClient(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    authToken = token;
    return token;
  } catch (error) {
    console.error('Failed to load auth token from storage', error);
    return null;
  }
}

export async function setAuthToken(token: string | null) {
  try {
    authToken = token;
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  } catch (error) {
    console.error('Failed to save auth token to storage', error);
  }
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
  const res = await api.post<LoginResponse>('/auth/login', data);
  if (res && res.accessToken) {
    await setAuthToken(res.accessToken);
  }
  return res;
}

export async function logout(): Promise<void> {
  await setAuthToken(null);
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
