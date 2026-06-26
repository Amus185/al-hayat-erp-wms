import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { supabaseClientFactory } from '../../config/supabase.config';
import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';

@Module({
  imports: [AuthModule],
  controllers: [FilesController],
  providers: [FilesService, FilesRepository, supabaseClientFactory],
  exports: [FilesService]
})
export class FilesModule {}

