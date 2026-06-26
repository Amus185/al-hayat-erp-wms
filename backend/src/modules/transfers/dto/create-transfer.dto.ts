import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsUUID, ValidateNested } from 'class-validator';

export enum OwnerType {
  Warehouse = 'WAREHOUSE',
  Branch = 'BRANCH'
}

export class TransferLineDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  quantityRequested!: number;
}

export class CreateTransferDto {
  @IsEnum(OwnerType)
  sourceOwnerType!: OwnerType;

  @IsOptional()
  @IsUUID()
  sourceWarehouseId?: string;

  @IsOptional()
  @IsUUID()
  sourceBranchId?: string;

  @IsEnum(OwnerType)
  destinationOwnerType!: OwnerType;

  @IsOptional()
  @IsUUID()
  destinationWarehouseId?: string;

  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
}

