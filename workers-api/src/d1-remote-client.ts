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
    const results = [];
    for (const stmt of statements) {
      results.push(await stmt.run());
    }
    return results;
  }

  async executeQuery(sql: string, params: any[] = []): Promise<any> {
    if (!this.apiToken || !this.accountId || !this.databaseId) {
      throw new Error(
        'Cloudflare D1 credentials missing. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, and CLOUDFLARE_API_TOKEN.'
      );
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`D1 REST API HTTP ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    if (!data.success || !data.result || data.result.length === 0) {
      const err = data.errors?.[0]?.message || 'Unknown D1 query error';
      throw new Error(`D1 REST API Error: ${err}`);
    }

    return data.result[0];
  }
}
