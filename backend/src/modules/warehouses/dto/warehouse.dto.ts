import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsString() city!: string;
  @IsString() @IsOptional() address?: string;
}

export class UpdateWarehouseDto {
  @IsString() @IsOptional() code?: string;
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() address?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
