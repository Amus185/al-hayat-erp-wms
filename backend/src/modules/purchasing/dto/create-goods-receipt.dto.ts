import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class GoodsReceiptLineDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  warehouseLocationId?: string;

  @IsInt()
  @Min(1)
  quantityReceived!: number;
}

export class CreateGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId!: string;

  @IsUUID()
  warehouseId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines!: GoodsReceiptLineDto[];
}

