import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from './database.service';
import { PG_POOL } from './database.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Pool({
          connectionString: config.get<string>('DATABASE_URL'),
          max: Number(config.get<string>('PG_POOL_SIZE') ?? 20),
          ssl: { rejectUnauthorized: false },
        })
    },
    DatabaseService
  ],
  exports: [DatabaseService]
})
export class DatabaseModule {}

