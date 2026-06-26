import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export enum AdjustmentDirection {
  Increase = 'INCREASE',
  Decrease = 'DECREASE'
}

export class CreateAdjustmentDto {
  @IsUUID()
  variantId!: string;

  @IsEnum(AdjustmentDirection)
  direction!: AdjustmentDirection;

  @IsInt()
  quantity!: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  warehouseLocationId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

