export type Env = {
  DB: D1Database;
  STORAGE: R2Bucket;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_EXPIRY: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_EXPIRY: string;
};

// Generate UUID v4 for SQLite
export function uuidv4() {
  return crypto.randomUUID();
}
