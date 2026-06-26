import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateFileDto } from './dto/create-file.dto';
import { FilesService } from './files.service';

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  @Permissions('products.write')
  list() {
    return this.files.list();
  }

  @Post()
  @Permissions('products.write')
  register(@Body() dto: CreateFileDto, @Req() request: { user: { sub: string } }) {
    return this.files.register(dto, request.user.sub);
  }

  @Get('presigned-put-url')
  @Permissions('products.write')
  presignedPutUrl(@Query('objectKey') objectKey: string) {
    return this.files.presignedPutUrl(objectKey);
  }
}

