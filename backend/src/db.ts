import type { PgAdapter } from './pg-client';

export type Env = {
  DB: PgAdapter;
  STORAGE?: any;
  // Signing secrets are read from the environment by security-config.ts
};

// Generate standard UUID v4
export function uuidv4(): string {
  return crypto.randomUUID();
}

