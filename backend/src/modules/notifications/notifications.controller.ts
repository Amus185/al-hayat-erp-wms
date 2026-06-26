import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: { user: { sub: string } }) {
    return this.notifications.listForUser(request.user.sub);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() request: { user: { sub: string } }) {
    return this.notifications.markRead(id, request.user.sub);
  }
}

