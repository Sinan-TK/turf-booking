import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, BookingPolicy, VenueCategory } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import {
  LEGACY_POLICY_DEFAULTS,
  allowedDurations,
  type BookingPolicyValues,
} from '../common/booking-policy.defaults';
import type { CategoryPolicyInput, CreateCategoryDto, UpdateCategoryDto } from './dto/venue-category.dto';

type CategoryWithPolicy = VenueCategory & { policy: BookingPolicyValues & { durations: number[] } };

function toPolicyValues(row: BookingPolicy): BookingPolicyValues {
  return {
    slotIntervalMin: row.slotIntervalMin,
    minDurationMin: row.minDurationMin,
    maxDurationMin: row.maxDurationMin,
    durationIncrementMin: row.durationIncrementMin,
    bufferBeforeMin: row.bufferBeforeMin,
    bufferAfterMin: row.bufferAfterMin,
    maxAdvanceDays: row.maxAdvanceDays,
    minLeadMinutes: row.minLeadMinutes,
  };
}

/** Live (not yet finished) bookings that would be orphaned from a category. */
const LIVE_BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED'] as const;

@Injectable()
export class VenueCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public: active categories only, in display order, each with the policy
   * a venue of that type runs on (so the UI can show real durations). */
  async listPublic() {
    const categories = await this.prisma.client.venueCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.withPolicies(categories);
  }

  async listAdmin() {
    const categories = await this.prisma.client.venueCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { venues: true } } },
    });
    const withPolicy = await this.withPolicies(categories);
    return withPolicy.map((c, i) => ({ ...c, venueCount: categories[i]._count.venues }));
  }

  async getAdmin(id: string) {
    const category = await this.prisma.client.venueCategory.findUnique({
      where: { id },
      include: { _count: { select: { venues: true } } },
    });
    if (!category) throw new NotFoundException('Venue type not found');
    const [withPolicy] = await this.withPolicies([category]);
    return { ...withPolicy, venueCount: category._count.venues };
  }

  async create(dto: CreateCategoryDto, actor: AuthContext) {
    const existing = await this.prisma.client.venueCategory.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`A venue type with slug ${dto.slug} already exists`);

    const category = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.venueCategory.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          defaultAllocationMode: dto.defaultAllocationMode,
          iconKey: dto.iconKey,
          unitLabel: dto.unitLabel,
          venueLabel: dto.venueLabel,
          unitTypes: dto.unitTypes,
          sortOrder: dto.sortOrder,
          isActive: dto.isActive,
        },
      });
      if (dto.policy) {
        await tx.bookingPolicy.create({ data: this.policyData(created.id, dto.policy) });
      }
      return created;
    });

    await this.audit.record({
      actor,
      action: 'VENUE_CATEGORY_CREATED',
      entityType: 'VenueCategory',
      entityId: category.id,
      metadata: { slug: category.slug },
    });
    return this.getAdmin(category.id);
  }

  async update(id: string, dto: UpdateCategoryDto, actor: AuthContext) {
    const current = await this.prisma.client.venueCategory.findUnique({
      where: { id },
      include: { _count: { select: { venues: true } } },
    });
    if (!current) throw new NotFoundException('Venue type not found');

    if (
      dto.defaultAllocationMode &&
      dto.defaultAllocationMode !== current.defaultAllocationMode &&
      current._count.venues > 0
    ) {
      throw new ConflictException(
        'The booking style cannot be changed while venues use this type. Create a new type instead.',
      );
    }
    if (dto.isActive === false && current.isActive) {
      await this.assertSafeToDeactivate(id);
    }

    await this.prisma.client.$transaction(async (tx) => {
      const { policy, ...fields } = dto;
      if (Object.keys(fields).length > 0) {
        await tx.venueCategory.update({ where: { id }, data: fields });
      }
      if (policy) {
        const existing = await tx.bookingPolicy.findFirst({
          where: { scope: 'CATEGORY', categoryId: id },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (existing) {
          await tx.bookingPolicy.update({ where: { id: existing.id }, data: this.policyData(id, policy) });
        } else {
          await tx.bookingPolicy.create({ data: this.policyData(id, policy) });
        }
      }
    });

    await this.audit.record({
      actor,
      action: 'VENUE_CATEGORY_UPDATED',
      entityType: 'VenueCategory',
      entityId: id,
      metadata: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue,
    });
    return this.getAdmin(id);
  }

  async setActive(id: string, isActive: boolean, actor: AuthContext) {
    return this.update(id, { isActive }, actor);
  }

  /** Hard delete only when no venue (including soft-deleted ones) was ever
   * created under the category; otherwise deactivate instead. */
  async remove(id: string, actor: AuthContext) {
    const category = await this.prisma.client.venueCategory.findUnique({
      where: { id },
      include: { _count: { select: { venues: true } } },
    });
    if (!category) throw new NotFoundException('Venue type not found');
    if (category._count.venues > 0) {
      throw new ConflictException(
        `${category._count.venues} venue(s) use this type, so it cannot be deleted. Deactivate it instead.`,
      );
    }
    // BookingPolicy rows scoped to this category cascade with it.
    await this.prisma.client.venueCategory.delete({ where: { id } });
    await this.audit.record({
      actor,
      action: 'VENUE_CATEGORY_DELETED',
      entityType: 'VenueCategory',
      entityId: id,
      metadata: { slug: category.slug },
    });
    return { deleted: true };
  }

  /** Deactivation hides the type from new-venue forms and the public list.
   * It is refused while live bookings exist under it. */
  private async assertSafeToDeactivate(id: string) {
    const live = await this.prisma.client.booking.count({
      where: {
        venue: { categoryId: id },
        status: { in: [...LIVE_BOOKING_STATUSES] },
        endTime: { gt: new Date() },
      },
    });
    if (live > 0) {
      throw new ConflictException(
        `${live} upcoming or pending booking(s) exist for venues of this type. Deactivate it once they are completed or cancelled.`,
      );
    }
  }

  private policyData(categoryId: string, policy: CategoryPolicyInput) {
    return {
      scope: 'CATEGORY' as const,
      categoryId,
      slotIntervalMin: policy.slotIntervalMin,
      minDurationMin: policy.minDurationMin,
      maxDurationMin: policy.maxDurationMin,
      durationIncrementMin: policy.durationIncrementMin,
      bufferBeforeMin: policy.bufferBeforeMin,
      bufferAfterMin: policy.bufferAfterMin,
      maxAdvanceDays: policy.maxAdvanceDays,
      minLeadMinutes: policy.minLeadMinutes,
    };
  }

  /** Attaches each category's effective policy (own CATEGORY policy, else the
   * PLATFORM_DEFAULT row, else the legacy constants) plus its duration list. */
  private async withPolicies<T extends VenueCategory>(
    categories: T[],
  ): Promise<Array<T & CategoryWithPolicy>> {
    if (categories.length === 0) return [];
    const [categoryPolicies, platform] = await Promise.all([
      this.prisma.client.bookingPolicy.findMany({
        where: { scope: 'CATEGORY', categoryId: { in: categories.map((c) => c.id) } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.client.bookingPolicy.findFirst({
        where: { scope: 'PLATFORM_DEFAULT' },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);
    const fallback = platform ? toPolicyValues(platform) : LEGACY_POLICY_DEFAULTS;
    return categories.map((category) => {
      const own = categoryPolicies.find((p) => p.categoryId === category.id);
      const values = own ? toPolicyValues(own) : fallback;
      return { ...category, policy: { ...values, durations: allowedDurations(values) } } as T &
        CategoryWithPolicy;
    });
  }
}
