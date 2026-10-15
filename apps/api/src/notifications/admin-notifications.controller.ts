import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';
import { CreateAdminNotificationDto } from './dto/notification.dto';

@Controller('admin/notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Flat, cross-organization owner list for the "Selected Owners"
   * picker — GET /admin/organizations/:id/owner-users only lists one
   * org at a time. */
  @Get('recipients')
  async recipients() {
    return this.notifications.listRecipientOwners();
  }

  @Post()
  async create(@Body() dto: CreateAdminNotificationDto) {
    return this.notifications.createAnnouncement(dto);
  }
}
