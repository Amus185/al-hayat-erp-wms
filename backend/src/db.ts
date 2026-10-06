import type { PgAdapter } from './pg-client';

export type Env = {
  DB: PgAdapter;
  STORAGE?: any;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_EXPIRY: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRY: string;
};

// Generate standard UUID v4
export function uuidv4(): string {
  return crypto.randomUUID();
}

