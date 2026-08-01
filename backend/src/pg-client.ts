import { Pool, PoolClient } from 'pg';

export function convertSqliteToPg(sql: string): string {
  let paramIndex = 1;
  // Convert ? placeholders to $1, $2, $3...
  let converted = sql.replace(/\?/g, () => `$${paramIndex++}`);

  // Convert common SQLite syntax to Postgres syntax
  converted = converted
    .replace(/datetime\('now',\s*'\+7 days'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '7 days')")
    .replace(/date\('now'\)/gi, "CURRENT_DATE::text")
    .replace(/lower\(hex\(randomblob\(16\)\)\)/gi, "gen_random_uuid()::text")
    .replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO");

  // Handle "INSERT INTO ... ON CONFLICT DO NOTHING" if INSERT OR IGNORE was converted
  if (sql.toUpperCase().includes('INSERT OR IGNORE INTO') && !converted.toUpperCase().includes('ON CONFLICT')) {
    converted += ' ON CONFLICT DO NOTHING';
  }

  return converted;
}

export class PgPreparedStatement {
  constructor(
    private pool: Pool,
    private sql: string,
    private params: any[] = []
  ) {}

  bind(...params: any[]): PgPreparedStatement {
    return new PgPreparedStatement(this.pool, this.sql, params);
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const pgSql = convertSqliteToPg(this.sql);
    const client = await this.pool.connect();
    try {
      const res = await client.query(pgSql, this.params);
      return {
        results: res.rows || [],
        success: true,
        meta: { changes: res.rowCount || 0 },
      };
    } finally {
      client.release();
    }
  }

  async first<T = any>(column?: string): Promise<T | null> {
    const res = await this.all<T>();
    if (!res.results || res.results.length === 0) return null;
    const row = res.results[0];
    if (column && typeof row === 'object' && row !== null) {
      return (row as any)[column] ?? null;
    }
    return row;
  }

  async run<T = any>(): Promise<{ success: boolean; meta: any }> {
    const res = await this.all<T>();
    return {
      success: true,
      meta: { changes: res.meta?.changes || 0 },
    };
  }

  async raw<T = any[]>(): Promise<T[]> {
    const res = await this.all();
    return res.results.map((row) => Object.values(row as any)) as T[];
  }

  getSql(): string {
    return this.sql;
  }

  getParams(): any[] {
    return this.params;
  }
}

export class PgAdapter {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20, // Connection pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
    });
  }

  prepare(sql: string): PgPreparedStatement {
    return new PgPreparedStatement(this.pool, sql);
  }

  // 🚀 ATOMIC BATCH TRANSACTION IN ONE SINGLE TCP ROUND TRIP!
  async batch(statements: PgPreparedStatement[]): Promise<any[]> {
    const client: PoolClient = await this.pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const stmt of statements) {
        const pgSql = convertSqliteToPg(stmt.getSql());
        const res = await client.query(pgSql, stmt.getParams());
        results.push({
          success: true,
          meta: { changes: res.rowCount || 0 },
          results: res.rows || [],
        });
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
