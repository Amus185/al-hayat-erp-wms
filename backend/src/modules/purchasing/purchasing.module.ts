import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuditModule } from '../audit/audit.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingRepository } from './purchasing.repository';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [AuthModule, RealtimeModule, AuditModule],
  controllers: [PurchasingController],
  providers: [PurchasingService, PurchasingRepository]
})
export class PurchasingModule {}


