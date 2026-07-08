import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';


export class CreateProductDto {
  @IsString()
  sku!: string;

  @IsString()
  barcode!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsNumber()
  @Min(0)
  costPrice!: number;

  @IsNumber()
  @Min(0)
  sellingPrice!: number;


}

