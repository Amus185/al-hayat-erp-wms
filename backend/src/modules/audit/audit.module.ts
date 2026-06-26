import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService]
})
export class AuditModule {}

