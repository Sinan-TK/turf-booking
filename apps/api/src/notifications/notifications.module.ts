import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { OwnerNotificationsController } from './notifications.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { NOTIFICATIONS_REPOSITORY } from './notifications.repository';
import { PrismaNotificationsRepository } from './prisma-notifications.repository';

/**
 * @Global so NotificationsService is injectable from BookingsService/
 * PaymentsService without either module having to import this one —
 * mirrors AuditModule (apps/api/src/audit/audit.module.ts), the
 * existing precedent for a cross-cutting service used everywhere.
 */
@Global()
@Module({
  controllers: [OwnerNotificationsController, AdminNotificationsController],
  providers: [
    NotificationsService,
    PrismaNotificationsRepository,
    { provide: NOTIFICATIONS_REPOSITORY, useClass: PrismaNotificationsRepository },
  ],
  exports: [NotificationsService, NOTIFICATIONS_REPOSITORY],
})
export class NotificationsModule {}
