import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AuditModule } from '../audit/audit.module';
import { TransfersController } from './transfers.controller';
import { TransfersRepository } from './transfers.repository';
import { TransfersService } from './transfers.service';

@Module({
  imports: [AuthModule, RealtimeModule, AuditModule],
  controllers: [TransfersController],
  providers: [TransfersService, TransfersRepository]
})
export class TransfersModule {}


