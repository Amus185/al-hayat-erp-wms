import { Pool, PoolClient } from 'pg';

/**
 * Translates SQLite/D1 SQL to Postgres-compatible SQL.
 *
 * Rules applied (in order):
 *  1. datetime('now', '+7 days') → (CURRENT_TIMESTAMP + INTERVAL '7 days')
 *  2. date('now')               → CURRENT_DATE::text
 *  3. lower(hex(randomblob(16))) → gen_random_uuid()::text
 *  4. INSERT OR IGNORE INTO     → INSERT INTO … ON CONFLICT DO NOTHING
 *  5. ?                         → $1, $2, $3 … (positional params)
 *
 * Safety notes:
 * - Step 5 runs LAST so the earlier replacements don't introduce `?` that
 *   would be mistakenly re-counted.
 * - `?` inside quoted SQL string literals: no instance exists in this
 *   codebase (confirmed by full grep). The naive replacement is safe here.
 * - `LIKE ?` with `%search%` bound values: the `?` in the SQL template is
 *   correctly replaced by `$n`; the `%` is in the parameter value, not the
 *   template, so it passes through unchanged.
 */
export function convertSqliteToPg(sql: string): string {
  let converted = sql
    // SQLite datetime/date ('now', offset) → Postgres TIMESTAMP / DATE interval math
    .replace(/datetime\('now',\s*([^)]+)\)/gi, (_, arg) => `(CURRENT_TIMESTAMP + CAST(${arg} AS INTERVAL))`)
    .replace(/date\('now',\s*([^)]+)\)/gi, (_, arg) => `(CURRENT_DATE + CAST(${arg} AS INTERVAL))`)
    // SQLite date() → Postgres CURRENT_TIMESTAMP (compatible with timestamptz and date columns)
    .replace(/date\('now'\)/gi, 'CURRENT_TIMESTAMP')
    // SQLite JULIANDAY('now') → Postgres epoch day calculation
    .replace(/julianday\('now'\)/gi, '(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) / 86400.0)')
    // SQLite JULIANDAY(x) → Postgres epoch day calculation
    .replace(/julianday\(([^)]+)\)/gi, '(EXTRACT(EPOCH FROM ($1)::timestamp) / 86400.0)')
    // SQLite UUID idiom → Postgres built-in
    .replace(/lower\(hex\(randomblob\(16\)\)\)/gi, 'gen_random_uuid()::text')
    // SQLite GROUP_CONCAT → Postgres STRING_AGG
    .replace(/group_concat\(([^)]+)\)/gi, 'string_agg($1::text, \',\')')
    // SQLite INSERT OR IGNORE → Postgres upsert
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');

  // Append ON CONFLICT DO NOTHING when INSERT OR IGNORE was present
  // (only when not already present, to avoid double-appending on re-runs)
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql) && !/ON\s+CONFLICT/i.test(converted)) {
    converted = converted.trimEnd() + ' ON CONFLICT DO NOTHING';
  }

  // Convert ? positional placeholders to $1, $2, …  (must run LAST)
  let paramIndex = 1;
  converted = converted.replace(/\?/g, () => `$${paramIndex++}`);

  return converted;
}

// ─── Prepared Statement ───────────────────────────────────────────────────────

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
        meta: { changes: res.rowCount ?? 0 },
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

  async run(): Promise<{ success: boolean; meta: any }> {
    // Use all() — it releases the connection properly and returns rowCount
    const res = await this.all();
    return {
      success: true,
      meta: { changes: res.meta?.changes ?? 0 },
    };
  }

  async raw<T = any[]>(): Promise<T[]> {
    const res = await this.all();
    return res.results.map((row) => Object.values(row as any)) as T[];
  }

  // Exposed so PgAdapter.batch() can retrieve the untranslated SQL + params
  getSql(): string { return this.sql; }
  getParams(): any[] { return this.params; }
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export class PgAdapter {
  public pool: Pool;

  constructor(connectionString: string) {
    const isLocal =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1');

    this.pool = new Pool({
      connectionString,
      // Railway colocates Postgres in the same project — connections are cheap.
      // 20 pooled connections handles concurrent request bursts without exhaustion.
      max: 20,
      // Release idle connections after 30 s to avoid accumulating idle handles
      idleTimeoutMillis: 30_000,
      // Fail fast on connection timeout — better than hanging
      connectionTimeoutMillis: 5_000,
      // Railway Postgres requires SSL; local does not
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });

    // Log pool errors so they don't silently swallow issues
    this.pool.on('error', (err) => {
      console.error('[PgAdapter] Pool error:', err.message);
    });
  }

  getPool(): Pool {
    return this.pool;
  }

  prepare(sql: string): PgPreparedStatement {
    return new PgPreparedStatement(this.pool, sql);
  }

  /**
   * Executes a list of prepared statements inside a single Postgres transaction.
   *
   * BEGIN → execute each statement in order → COMMIT on success.
   * Any failure triggers ROLLBACK and re-throws — no partial commits.
   *
   * This is the primary correctness improvement over the D1 REST API "batch"
   * which was a best-effort sequential list of HTTP calls, not a real transaction.
   */
  async batch(statements: PgPreparedStatement[]): Promise<any[]> {
    if (statements.length === 0) return [];

    const client: PoolClient = await this.pool.connect();
    const results: any[] = [];

    try {
      await client.query('BEGIN');

      for (const stmt of statements) {
        const pgSql = convertSqliteToPg(stmt.getSql());
        const res = await client.query(pgSql, stmt.getParams());
        results.push({
          success: true,
          meta: { changes: res.rowCount ?? 0 },
          results: res.rows || [],
        });
      }

      await client.query('COMMIT');
      return results;

    } catch (err) {
      await client.query('ROLLBACK').catch(() => {}); // never swallow the original error
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
