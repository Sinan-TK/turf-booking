import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { Role } from '@venue/shared';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import type { AuthContext } from '../auth/auth.types';

// Every route resolves the owner from the authenticated session
// (actor.id) — never from a client-supplied id — so an owner can never
// read or mark another owner's notification by tampering with a URL.
@Controller('owner/notifications')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.VENUE_OWNER)
export class OwnerNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() actor: AuthContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.getOwnerNotifications(actor.id, {
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() actor: AuthContext) {
    const count = await this.notifications.getUnreadCount(actor.id);
    return { count };
  }

  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @CurrentUser() actor: AuthContext) {
    await this.notifications.markAsRead(actor.id, id);
    return { status: 'ok' };
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() actor: AuthContext) {
    await this.notifications.markAllAsRead(actor.id);
    return { status: 'ok' };
  }
}
