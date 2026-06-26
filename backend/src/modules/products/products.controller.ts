import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Permissions('products.read')
  search(@Query('q') q?: string) {
    return this.products.search(q);
  }

  @Get('categories')
  @Permissions('products.read')
  categories() {
    return this.products.listCategories();
  }

  @Get('brands')
  @Permissions('products.read')
  brands() {
    return this.products.listBrands();
  }

  @Get('barcode/:barcode')
  @Permissions('products.read')
  barcodeLookup(@Param('barcode') barcode: string) {
    return this.products.barcodeLookup(barcode);
  }

  @Get(':id')
  @Permissions('products.read')
  findById(@Param('id') id: string) {
    return this.products.findById(id);
  }

  @Post()
  @Permissions('products.write')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @Permissions('products.write')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Permissions('products.write')
  remove(@Param('id') id: string) {
    return this.products.softDelete(id);
  }
}
