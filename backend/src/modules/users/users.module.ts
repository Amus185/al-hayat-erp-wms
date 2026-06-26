import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UsersController, RolesController],
  providers: [UsersService, UsersRepository]
})
export class UsersModule {}



