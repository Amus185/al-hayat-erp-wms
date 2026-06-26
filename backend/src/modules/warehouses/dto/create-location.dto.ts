import { IsString, IsUUID } from 'class-validator';

export class CreateLocationBodyDto {
  @IsString()
  aisle!: string;

  @IsString()
  rack!: string;

  @IsString()
  shelf!: string;

  @IsString()
  bin!: string;

  @IsString()
  barcode!: string;
}

export class CreateLocationDto extends CreateLocationBodyDto {
  @IsUUID()
  warehouseId!: string;
}
