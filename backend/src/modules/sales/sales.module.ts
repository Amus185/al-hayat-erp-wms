import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuditModule } from '../audit/audit.module';
import { SalesController } from './sales.controller';
import { SalesRepository } from './sales.repository';
import { SalesService } from './sales.service';

@Module({
  imports: [AuthModule, RealtimeModule, AuditModule],
  controllers: [SalesController],
  providers: [SalesService, SalesRepository]
})
export class SalesModule {}


