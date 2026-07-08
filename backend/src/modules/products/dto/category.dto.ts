import { IsString, IsOptional } from 'class-validator';

export class CreateCategoryDto {
  @IsString() name!: string;
  @IsString() @IsOptional() parentId?: string;
}

export class UpdateCategoryDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() parentId?: string;
}
