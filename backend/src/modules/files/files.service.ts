import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../config/supabase.config';
import { CreateFileDto } from './dto/create-file.dto';
import { FilesRepository } from './files.repository';

@Injectable()
export class FilesService {
  private readonly bucket: string;

  constructor(
    private readonly files: FilesRepository,
    private readonly config: ConfigService,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {
    this.bucket = config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'al-hayat-files';
  }

  async register(dto: CreateFileDto, uploadedBy: string) {
    return (await this.files.create(dto, uploadedBy)).rows[0];
  }

  async list() {
    return (await this.files.list()).rows;
  }

  /**
   * Generate a signed URL so the client can upload directly to Supabase Storage.
   * Expires in 10 minutes (600 seconds).
   */
  async presignedPutUrl(objectKey: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUploadUrl(objectKey);

    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`);
    }

    return data.signedUrl;
  }

  /**
   * Generate a signed URL so the client can download/view a file.
   * Expires in 1 hour.
   */
  async presignedGetUrl(objectKey: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(objectKey, 3600);

    if (error || !data) {
      throw new Error(`Failed to create signed download URL: ${error?.message ?? 'unknown error'}`);
    }

    return data.signedUrl;
  }
}
