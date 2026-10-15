import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  NotificationsRepository,
  OwnerNotificationInput,
} from './notifications.repository';

/**
 * Prisma-backed NotificationsRepository. The ONLY file in the
 * notifications module allowed to import PrismaService queries for
 * owner notifications / owner-user lookups.
 */
@Injectable()
export class PrismaNotificationsRepository implements NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, input: OwnerNotificationInput) {
    return this.prisma.client.ownerNotification.create({
      data: { ownerId, ...input },
    });
  }

  async createMany(ownerIds: string[], input: OwnerNotificationInput) {
    if (ownerIds.length === 0) return { count: 0 };
    return this.prisma.client.ownerNotification.createMany({
      data: ownerIds.map((ownerId) => ({ ownerId, ...input })),
    });
  }

  async findActiveOwnerIds(): Promise<string[]> {
    const owners = await this.prisma.client.venueOwnerUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    return owners.map((o) => o.id);
  }

  async findActiveOwnerIdsByIds(ownerIds: string[]): Promise<string[]> {
    const owners = await this.prisma.client.venueOwnerUser.findMany({
      where: { id: { in: ownerIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    return owners.map((o) => o.id);
  }

  async findActiveOwnerIdsByOrganization(
    organizationId: string,
    opts?: { excludeOwnerId?: string },
  ): Promise<string[]> {
    const owners = await this.prisma.client.venueOwnerUser.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        id: opts?.excludeOwnerId ? { not: opts.excludeOwnerId } : undefined,
      },
      select: { id: true },
    });
    return owners.map((o) => o.id);
  }

  async listRecipientOwners() {
    const owners = await this.prisma.client.venueOwnerUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true, organization: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return owners.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      organizationName: o.organization.name,
    }));
  }

  async findOwnerPage(ownerId: string, opts: { cursor?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 20, 50);
    const items = await this.prisma.client.ownerNotification.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    return { items: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  async countUnread(ownerId: string): Promise<number> {
    return this.prisma.client.ownerNotification.count({ where: { ownerId, readAt: null } });
  }

  async markAsRead(ownerId: string, notificationId: string): Promise<number> {
    const result = await this.prisma.client.ownerNotification.updateMany({
      where: { id: notificationId, ownerId },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async markAllAsRead(ownerId: string) {
    return this.prisma.client.ownerNotification.updateMany({
      where: { ownerId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
