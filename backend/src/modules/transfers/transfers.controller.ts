import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

@ApiTags('Transfers')
@ApiBearerAuth()
@Controller('transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @Permissions('transfers.create')
  list() {
    return this.transfers.list();
  }

  @Get(':id')
  @Permissions('transfers.create')
  findOne(@Param('id') id: string) {
    return this.transfers.findById(id);
  }

  @Post()
  @Permissions('transfers.create')
  create(@Body() dto: CreateTransferDto, @Req() request: { user: { sub: string } }) {
    return this.transfers.create(dto, request.user.sub);
  }

  @Patch(':id/approve')
  @Permissions('transfers.approve')
  approve(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.transfers.approve(id, request.user.sub);
  }

  @Patch(':id/reject')
  @Permissions('transfers.approve')
  reject(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.transfers.reject(id, request.user.sub);
  }

  @Patch(':id/dispatch')
  @Permissions('transfers.dispatch')
  dispatch(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.transfers.dispatch(id, request.user.sub);
  }

  @Patch(':id/receive')
  @Permissions('transfers.receive')
  receive(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.transfers.receive(id, request.user.sub);
  }
}

