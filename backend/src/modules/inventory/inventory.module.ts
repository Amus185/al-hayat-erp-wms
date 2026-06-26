import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuditModule } from '../audit/audit.module';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './inventory.repository';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AuthModule, RealtimeModule, AuditModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryRepository]
})
export class InventoryModule {}


