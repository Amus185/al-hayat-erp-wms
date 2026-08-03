/**
 * Remote Cloudflare D1 Client Adapter for Node.js (Railway / Standard Server)
 * Connects standard Node.js applications to Cloudflare D1 SQLite database via D1 REST API.
 */

export interface D1RemoteConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export class D1PreparedStatement {
  constructor(
    private client: D1RemoteClient,
    private sql: string,
    private params: any[] = []
  ) {}

  bind(...params: any[]): D1PreparedStatement {
    return new D1PreparedStatement(this.client, this.sql, params);
  }

  async all<T = any>(): Promise<{ results: T[]; success: boolean; meta: any }> {
    const res = await this.client.executeQuery(this.sql, this.params);
    return {
      results: res.results || [],
      success: res.success ?? true,
      meta: res.meta || {},
    };
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
    const res = await this.client.executeQuery(this.sql, this.params);
    return {
      success: res.success ?? true,
      meta: res.meta || { changes: res.changes || 0 },
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

export class D1RemoteClient {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  constructor(config: D1RemoteConfig) {
    this.accountId = config.accountId;
    this.databaseId = config.databaseId;
    this.apiToken = config.apiToken;
  }

  prepare(sql: string): D1PreparedStatement {
    return new D1PreparedStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<any[]> {
    if (!this.apiToken || !this.accountId || !this.databaseId) {
      throw new Error(
        'Cloudflare D1 credentials missing. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN.'
      );
    }

    if (statements.length === 0) return [];

    // Build the batch payload — each statement contributes its sql + params
    const batchPayload = statements.map((stmt) => ({
      sql: stmt.getSql(),
      params: stmt.getParams(),
    }));

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    const t0 = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ batch: batchPayload }),
    });
    const t1 = Date.now();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 REST API batch HTTP ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    const totalMs = Date.now() - t0;

    console.log(
      `[D1-PERF] batch(${statements.length} stmts) = ${totalMs}ms (fetch=${t1 - t0}ms) | 1 HTTP request, atomic transaction`
    );

    if (!data.success) {
      const err = data.errors?.[0]?.message || 'Unknown D1 batch error';
      throw new Error(`D1 REST API Batch Error: ${err}`);
    }

    // D1 returns { success: true, result: [ { results, meta, success }, ... ] }
    // Map each per-statement result into the shape callers expect
    const resultArray = data.result || [];
    return resultArray.map((r: any) => ({
      results: r.results || [],
      success: r.success ?? true,
      meta: r.meta || { changes: r.changes || 0 },
    }));
  }

  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    if (!this.apiToken || !this.accountId || !this.databaseId) {
      throw new Error(
        'Cloudflare D1 credentials missing. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN.'
      );
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    const t0 = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sql,
        params,
      }),
    });
    const t1 = Date.now();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 REST API HTTP ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    const totalMs = Date.now() - t0;
    const sqlPreview = sql.replace(/\s+/g, ' ').substring(0, 80);
    console.log(`[D1-PERF] ${totalMs}ms (fetch=${t1 - t0}ms) | ${sqlPreview}`);

    if (!data.success || !data.result || data.result.length === 0) {
      const err = data.errors?.[0]?.message || 'Unknown D1 query error';
      throw new Error(`D1 REST API Error: ${err}`);
    }

    return data.result[0];
  }

}
