import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @Permissions('inventory.read')
  stockPaginated(
    @Query('search') search?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.inventory.stockPaginated({ search, warehouseId, branchId, page, pageSize });
  }

  @Get('stock')
  @Permissions('inventory.read')
  stock() {
    return this.inventory.stock();
  }

  @Get('transactions')
  @Permissions('inventory.read')
  transactions() {
    return this.inventory.transactions();
  }

  @Post('adjustments')
  @Permissions('inventory.adjust')
  adjust(@Body() dto: CreateAdjustmentDto, @Req() request: { user: { sub: string } }) {
    return this.inventory.adjust(dto, request.user.sub);
  }

  @Get('low-stock')
  @Permissions('inventory.read')
  lowStock() {
    return this.inventory.lowStock();
  }
}


