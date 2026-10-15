import type { OwnerNotificationType, Prisma } from '@venue/database';

export interface OwnerNotificationInput {
  type: OwnerNotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Clean-Architecture port: NotificationsService (use-case) depends on this
 * interface, never on Prisma directly. PrismaNotificationsRepository is
 * the only file allowed to translate these calls into Prisma queries.
 */
export interface NotificationsRepository {
  create(ownerId: string, input: OwnerNotificationInput): Promise<unknown>;
  createMany(ownerIds: string[], input: OwnerNotificationInput): Promise<{ count: number }>;
  findActiveOwnerIds(): Promise<string[]>;
  findActiveOwnerIdsByIds(ownerIds: string[]): Promise<string[]>;
  findActiveOwnerIdsByOrganization(
    organizationId: string,
    opts?: { excludeOwnerId?: string },
  ): Promise<string[]>;
  listRecipientOwners(): Promise<
    Array<{ id: string; name: string; email: string; organizationName: string }>
  >;
  findOwnerPage(ownerId: string, opts: { cursor?: string; limit?: number }): Promise<{
    items: unknown[];
    nextCursor: string | null;
  }>;
  countUnread(ownerId: string): Promise<number>;
  markAsRead(ownerId: string, notificationId: string): Promise<number>;
  markAllAsRead(ownerId: string): Promise<unknown>;
}

export const NOTIFICATIONS_REPOSITORY = Symbol('NOTIFICATIONS_REPOSITORY');
