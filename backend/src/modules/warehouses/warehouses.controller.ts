import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateLocationBodyDto } from './dto/create-location.dto';
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
