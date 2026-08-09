/**
 * Simple module-level stale-while-revalidate cache.
 * Data survives React re-mounts (navigation back/forth) for the session lifetime.
 * Each key maps to the last-fetched value.
 */
const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
}

export function invalidateCache(key: string): void {
  store.delete(key);
}
