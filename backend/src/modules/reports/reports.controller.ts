import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('inventory-value')
  @Permissions('reports.read')
  inventoryValue() {
    return this.reports.inventoryValue();
  }

  @Get('low-stock')
  @Permissions('reports.read')
  lowStock() {
    return this.reports.lowStock();
  }

  @Get('sales')
  @Permissions('reports.read')
  sales() {
    return this.reports.sales();
  }

  @Get('branches')
  @Permissions('reports.read')
  branches() {
    return this.reports.branches();
  }

  @Get('profit')
  @Permissions('reports.read')
  profit() {
    return this.reports.profit();
  }
}

