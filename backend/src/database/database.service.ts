import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { PG_POOL } from './database.constants';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    const start = Date.now();
    await this.pool.query('SELECT 1');
    this.logger.log(`Database pool warmed in ${Date.now() - start}ms`);
  }

  query<T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) {
    return this.pool.query<T>(sql, values as unknown[]);
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

