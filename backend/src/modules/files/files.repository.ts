import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateFileDto } from './dto/create-file.dto';

@Injectable()
export class FilesRepository {
  constructor(private readonly db: DatabaseService) {}

  create(dto: CreateFileDto, uploadedBy: string) {
    return this.db.query(
      `INSERT INTO files (bucket, object_key, original_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [dto.bucket, dto.objectKey, dto.originalName, dto.mimeType, dto.sizeBytes, uploadedBy]
    );
  }

  list() {
    return this.db.query('SELECT id, bucket, object_key, original_name, mime_type, size_bytes, created_at FROM files ORDER BY created_at DESC LIMIT 100');
  }
}

