import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { OwnerNotificationType, Prisma } from '@venue/database';
import {
  NOTIFICATIONS_REPOSITORY,
  type NotificationsRepository,
} from './notifications.repository';

interface NotificationInput {
  type: OwnerNotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Persistent, in-app notification center for Venue Owner logins
 * (venue_owner_users) — written by backend business events (booking/
 * payment lifecycle) and Super Admin announcements, never created from
 * the frontend. Deliberately its own model/service, not layered onto
 * the existing `Notification` model (customer-facing outbound delivery
 * tracking — a different shape/purpose entirely).
 *
 * Every create* method here is a plain throwing async function — call
 * sites in BookingsService/PaymentsService are the ones responsible for
 * `.catch(() => undefined)`, matching how this codebase already treats
 * WhatsApp notification failures as never allowed to undo an
 * already-committed booking/payment change (see BookingsService.cancel's
 * own comment on this exact pattern).
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATIONS_REPOSITORY) private readonly repo: NotificationsRepository,
  ) {}

  async create(ownerId: string, input: NotificationInput) {
    return this.repo.create(ownerId, input);
  }

  /** Alias kept for call-site clarity (mirrors createForOwners/
   * createForAllOwners's naming) — identical to create(). */
  async createForOwner(ownerId: string, input: NotificationInput) {
    return this.create(ownerId, input);
  }

  async createForOwners(ownerIds: string[], input: NotificationInput) {
    return this.repo.createMany(ownerIds, input);
  }

  /** Every ACTIVE owner login, platform-wide — used by Super Admin
   * "All Owners" announcements. */
  async createForAllOwners(input: NotificationInput) {
    const ownerIds = await this.repo.findActiveOwnerIds();
    return this.createForOwners(ownerIds, input);
  }

  /**
   * The helper booking/payment lifecycle call sites actually use: every
   * ACTIVE owner login in one organization, optionally excluding the
   * actor who caused the event (e.g. an owner recording their own
   * walk-in booking doesn't need to be told about it, but their
   * teammates do). Centralized here so "who are this org's owners" isn't
   * duplicated across every call site in BookingsService/PaymentsService.
   */
  async notifyOrganizationOwners(
    organizationId: string,
    input: NotificationInput,
    opts?: { excludeOwnerId?: string },
  ) {
    const ownerIds = await this.repo.findActiveOwnerIdsByOrganization(organizationId, opts);
    return this.createForOwners(ownerIds, input);
  }

  async getOwnerNotifications(ownerId: string, opts: { cursor?: string; limit?: number }) {
    return this.repo.findOwnerPage(ownerId, opts);
  }

  async getUnreadCount(ownerId: string) {
    return this.repo.countUnread(ownerId);
  }

  /** Flat owner list for the "Selected Owners" picker. */
  async listRecipientOwners() {
    return this.repo.listRecipientOwners();
  }

  /**
   * Creates a Super Admin announcement. Silently filters SELECTED ids to
   * real, ACTIVE VenueOwnerUser rows rather than erroring on a stale id —
   * the returned count tells the admin how many were actually notified.
   */
  async createAnnouncement(dto: {
    type: OwnerNotificationType;
    title: string;
    message: string;
    recipientType: 'ALL' | 'SELECTED';
    ownerIds?: string[];
  }): Promise<{ recipientCount: number }> {
    const input = { type: dto.type, title: dto.title, message: dto.message };
    if (dto.recipientType === 'ALL') {
      const result = await this.createForAllOwners(input);
      return { recipientCount: result.count };
    }
    const validOwnerIds = await this.repo.findActiveOwnerIdsByIds(dto.ownerIds ?? []);
    const result = await this.createForOwners(validOwnerIds, input);
    return { recipientCount: result.count };
  }

  /**
   * Filters by ownerId in the same WHERE clause as the id — the IDOR-safe
   * pattern: a notification that exists but belongs to a different owner
   * produces the exact same "not found" as one that doesn't exist at
   * all, never revealing which case it was (matches how this codebase's
   * other ownership checks already behave, e.g. BookingsService.getForCustomer).
   */
  async markAsRead(ownerId: string, notificationId: string) {
    const count = await this.repo.markAsRead(ownerId, notificationId);
    if (count === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  async markAllAsRead(ownerId: string) {
    return this.repo.markAllAsRead(ownerId);
  }
}
