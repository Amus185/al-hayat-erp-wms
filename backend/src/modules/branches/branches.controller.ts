import { Body, Controller, Get, Param, Patch, Post, Delete, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/update-branch.dto';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('branches')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @Permissions('inventory.read')
  list() {
    return this.branches.list();
  }

  @Post()
  @Permissions('branches.manage')
  create(@Body() dto: CreateBranchDto) {
    return this.branches.create(dto);
  }

  @Delete(':id')
  @Permissions('branches.manage')
  remove(@Param('id') id: string) {
    return this.branches.delete(id);
  }

  @Get(':id')
  @Permissions('inventory.read')
  retrieve(@Param('id') id: string) {
    return this.branches.retrieve(id);
  }

  @Patch(':id')
  @Permissions('branches.manage')
  update(@Param('id') id: string, @Body() dto: UpdateBranchDto) {
    return this.branches.update(id, dto);
  }

  @Get(':id/inventory')
  @Permissions('inventory.read')
  inventory(@Param('id') id: string) {
    return this.branches.inventory(id);
  }

  @Get(':id/performance')
  @Permissions('reports.read')
  performance(@Param('id') id: string) {
    return this.branches.performance(id);
  }
}


