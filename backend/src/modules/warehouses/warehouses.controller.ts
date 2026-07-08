import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateLocationBodyDto } from './dto/create-location.dto';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/warehouse.dto';
import { WarehousesService } from './warehouses.service';

@ApiTags('Warehouses')
@ApiBearerAuth()
@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @Permissions('inventory.read')
  list() {
    return this.warehouses.list();
  }

  @Post()
  @Permissions('inventory.adjust') // Usually admin
  create(@Body() dto: CreateWarehouseDto) {
    return this.warehouses.create(dto);
  }

  @Patch(':id')
  @Permissions('inventory.adjust')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.warehouses.update(id, dto);
  }

  @Delete(':id')
  @Permissions('inventory.adjust')
  remove(@Param('id') id: string) {
    return this.warehouses.delete(id);
  }

  @Get(':id/locations')
  @Permissions('inventory.read')
  locations(@Param('id') id: string) {
    return this.warehouses.locations(id);
  }

  @Post(':id/locations')
  @Permissions('inventory.adjust')
  createLocation(@Param('id') warehouseId: string, @Body() dto: CreateLocationBodyDto) {
    return this.warehouses.createLocation({ ...dto, warehouseId });
  }
}
