// Server search for the pickers in forms and filters: customers, products and
// suppliers are searched across all records as the user types (never a capped
// list loaded up front).
import { apiGet } from '../api/client';
import type { SelectOption } from '../components/SearchableSelect';
import type { Paged } from './serverList';

const PICK = 25;

export async function searchCustomers(q: string): Promise<SelectOption[]> {
  const res = await apiGet<Paged<any>>('/sales/customers', { page: 1, pageSize: PICK, q: q || undefined, sort: q ? 'name' : 'created', dir: q ? 'asc' : 'desc' });
  return res.items.map((c) => ({ value: c.id, label: c.name, sublabel: c.phone || undefined }));
}

export async function searchProducts(q: string, extra: Record<string, string> = {}): Promise<any[]> {
  const res = await apiGet<Paged<any>>('/products', { page: 1, pageSize: PICK, q: q || undefined, sort: 'name', dir: 'asc', status: 'active', ...extra });
  return res.items;
}

export async function searchProductOptions(q: string): Promise<SelectOption[]> {
  return (await searchProducts(q)).map((p) => ({ value: p.id, label: p.name, sublabel: p.sku }));
}
