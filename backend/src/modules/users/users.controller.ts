import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('users.manage')
  list() {
    return this.users.list();
  }

  @Get('roles')
  @Permissions('users.manage')
  listRoles() {
    return this.users.listRoles();
  }

  @Post()
  @Permissions('users.manage')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id')
  @Permissions('users.manage')
  retrieve(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.retrieve(id);
  }

  @Patch(':id')
  @Permissions('users.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: { user: { sub: string } }
  ) {
    return this.users.update(id, dto, request.user.sub);
  }
}
