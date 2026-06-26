import { IsInt, IsMimeType, IsString, Min } from 'class-validator';

export class CreateFileDto {
  @IsString()
  bucket!: string;

  @IsString()
  objectKey!: string;

  @IsString()
  originalName!: string;

  @IsMimeType()
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

