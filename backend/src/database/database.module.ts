import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from './database.service';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.get<string>('DATABASE_URL'),
          max: Number(config.get<string>('PG_POOL_SIZE') ?? 20),
          ssl: config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : { rejectUnauthorized: false }, // Supabase requires SSL even in dev
        })
    },
    DatabaseService
  ],
  exports: [DatabaseService]
})
export class DatabaseModule {}

