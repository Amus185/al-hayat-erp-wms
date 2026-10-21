// Security configuration read from the environment, failing closed in production.

const DEV_ACCESS_SECRET = 'dev-access-secret-1234567890123456';

/** Railway sets RAILWAY_* variables; the Dockerfile sets NODE_ENV=production. */
export function isProductionRuntime(): boolean {
  const env = typeof process !== 'undefined' ? process.env : ({} as Record<string, string | undefined>);
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);
}

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'ConfigError'; }
}

/**
 * The access-token signing secret. In production it must be set, at least 32
 * characters, and not the development default — otherwise anyone could mint
 * tokens. Outside production a development default is used when unset.
 */
export function getAccessSecret(): string {
  const value = typeof process !== 'undefined' ? process.env.JWT_ACCESS_SECRET : undefined;
  if (isProductionRuntime()) {
    if (!value || value.length < 32 || value === DEV_ACCESS_SECRET || value.startsWith('dev-')) {
      throw new ConfigError('JWT_ACCESS_SECRET is missing or too weak for production (set a random value of 32+ characters).');
    }
    return value;
  }
  return value || DEV_ACCESS_SECRET;
}

/**
 * Browser origins allowed to call the API cross-origin and to use the
 * refresh cookie. CORS_ORIGINS is a comma-separated list of exact origins.
 */
export function getAllowedOrigins(): string[] {
  const raw = typeof process !== 'undefined' ? process.env.CORS_ORIGINS : undefined;
  const list = (raw || 'https://al-hayat-erp.pages.dev,http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  return Array.from(new Set(list));
}

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return getAllowedOrigins().includes(origin.replace(/\/$/, ''));
}
