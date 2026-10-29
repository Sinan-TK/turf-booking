import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { cleanIconSvg } from '@venue/shared';
import type { Prisma, BookingPolicy, VenueCategory } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CommercialTermsService } from '../commercial/commercial-terms.service';
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
    private readonly commercialTerms: CommercialTermsService,
  ) {}

  /** Public: active categories only, in display order, each with the policy
   * a unit of that facility runs on (so the UI can show real durations).
   * `availableOnly` keeps just the facilities with something bookable today. */
  async listPublic(opts: { availableOnly?: boolean } = {}) {
    const bookableVenue = { status: 'ACTIVE' as const, deletedAt: null };
    const categories = await this.prisma.client.venueCategory.findMany({
      where: {
        isActive: true,
        ...(opts.availableOnly
          ? {
              OR: [
                { resources: { some: { isBookable: true, status: 'ACTIVE' as const, venue: bookableVenue } } },
                { resourceGroups: { some: { venue: bookableVenue } } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return this.withPolicies(categories);
  }

  async listAdmin() {
    const categories = await this.prisma.client.venueCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const [withPolicy, venueCounts] = await Promise.all([
      this.withPolicies(categories),
      this.venueCounts(categories.map((c) => c.id)),
    ]);
    return withPolicy.map((c) => ({ ...c, venueCount: venueCounts.get(c.id) ?? 0 }));
  }

  async getAdmin(id: string) {
    const category = await this.prisma.client.venueCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Facility not found');
    const [[withPolicy], venueCounts] = await Promise.all([
      this.withPolicies([category]),
      this.venueCounts([id]),
    ]);
    return { ...withPolicy, venueCount: venueCounts.get(id) ?? 0 };
  }

  async create(dto: CreateCategoryDto, actor: AuthContext) {
    const existing = await this.prisma.client.venueCategory.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`A facility with slug ${dto.slug} already exists`);

    const category = await this.prisma.client.$transaction(async (tx) => {
      await this.lockDisplayOrder(tx);
      const sortOrder = dto.sortOrder ?? (await this.nextDisplayOrder(tx));
      if (dto.sortOrder !== undefined) await this.assertDisplayOrderFree(tx, sortOrder);
      const created = await tx.venueCategory.create({
        data: {
          slug: dto.slug,
          name: dto.name,
          defaultAllocationMode: dto.defaultAllocationMode,
          iconKey: dto.iconKey,
          iconSvg: this.cleanSvg(dto.iconSvg) ?? null,
          unitLabel: dto.unitLabel,
          venueLabel: dto.venueLabel,
          unitTypes: dto.unitTypes,
          sortOrder,
          isActive: dto.isActive,
        },
      });
      if (dto.policy) {
        await tx.bookingPolicy.create({ data: this.policyData(created.id, dto.policy) });
      }
      // Its own commercial terms, pre-filled from the platform default.
      await this.commercialTerms.createFacilityTerms(tx, created.id);
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
      include: { _count: { select: { resources: true, resourceGroups: true } } },
    });
    if (!current) throw new NotFoundException('Facility not found');

    if (
      dto.defaultAllocationMode &&
      dto.defaultAllocationMode !== current.defaultAllocationMode &&
      current._count.resources + current._count.resourceGroups > 0
    ) {
      throw new ConflictException(
        'The booking style cannot be changed while units use this facility. Create a new facility instead.',
      );
    }
    if (dto.isActive === false && current.isActive) {
      await this.assertSafeToDeactivate(id);
    }

    const iconSvg = dto.iconSvg === undefined ? undefined : (this.cleanSvg(dto.iconSvg) ?? null);
    await this.prisma.client.$transaction(async (tx) => {
      const { policy, ...fields } = dto;
      // Only a changed order is checked, so facilities that already share a number can still be saved for other reasons.
      if (fields.sortOrder !== undefined && fields.sortOrder !== current.sortOrder) {
        await this.lockDisplayOrder(tx);
        await this.assertDisplayOrderFree(tx, fields.sortOrder, id);
      }
      if (Object.keys(fields).length > 0) {
        await tx.venueCategory.update({ where: { id }, data: { ...fields, ...(iconSvg !== undefined ? { iconSvg } : {}) } });
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

  /** A pasted icon, checked and tidied; empty or null means "no custom icon". Anything unsafe is a clear 400, never stored. */
  private cleanSvg(raw: string | null | undefined): string | undefined {
    if (raw === null || raw === undefined || raw.trim() === '') return undefined;
    const result = cleanIconSvg(raw);
    if (!result.ok) throw new BadRequestException(`The icon SVG can't be used: ${result.problem}`);
    return result.svg;
  }

  /** Two facilities trade display order numbers, both or neither. */
  async swapDisplayOrder(id: string, withId: string, actor: AuthContext) {
    if (id === withId) throw new BadRequestException('Pick a different facility to switch with.');
    await this.prisma.client.$transaction(async (tx) => {
      await this.lockDisplayOrder(tx);
      const [a, b] = await Promise.all([
        tx.venueCategory.findUnique({ where: { id }, select: { id: true, name: true, sortOrder: true } }),
        tx.venueCategory.findUnique({ where: { id: withId }, select: { id: true, name: true, sortOrder: true } }),
      ]);
      if (!a || !b) throw new NotFoundException('Facility not found');
      await tx.venueCategory.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } });
      await tx.venueCategory.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } });
      await this.audit.record({
        actor,
        action: 'VENUE_CATEGORY_ORDER_SWAPPED',
        entityType: 'VenueCategory',
        entityId: a.id,
        metadata: { with: { id: b.id, name: b.name }, from: a.sortOrder, to: b.sortOrder },
      });
    });
    return this.getAdmin(id);
  }

  async setActive(id: string, isActive: boolean, actor: AuthContext) {
    return this.update(id, { isActive }, actor);
  }

  /** Hard delete only when no unit was ever created under the facility;
   * otherwise deactivate instead. */
  async remove(id: string, actor: AuthContext) {
    const category = await this.prisma.client.venueCategory.findUnique({
      where: { id },
      include: { _count: { select: { resources: true, resourceGroups: true } } },
    });
    if (!category) throw new NotFoundException('Facility not found');
    const units = category._count.resources + category._count.resourceGroups;
    if (units > 0) {
      throw new ConflictException(
        `${units} unit(s) use this facility, so it cannot be deleted. Deactivate it instead.`,
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

  /** Serializes display-order changes, so two admins can't both take the same number (no database index backs this rule). */
  private async lockDisplayOrder(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('venue_category_display_order'))`;
  }

  private async nextDisplayOrder(tx: Prisma.TransactionClient): Promise<number> {
    const top = await tx.venueCategory.aggregate({ _max: { sortOrder: true } });
    return (top._max.sortOrder ?? -1) + 1;
  }

  private async assertDisplayOrderFree(tx: Prisma.TransactionClient, sortOrder: number, exceptId?: string) {
    const taken = await tx.venueCategory.findFirst({
      where: { sortOrder, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, name: true },
    });
    // Who has it travels with the error, so the admin can offer to switch places.
    if (taken) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message: `Display order ${sortOrder} is already used by ${taken.name}. Pick another number.`,
        takenBy: { id: taken.id, name: taken.name, sortOrder },
      });
    }
  }

  /** Deactivation hides the facility from "add unit" forms and the public list.
   * It is refused while live bookings exist under it. */
  private async assertSafeToDeactivate(id: string) {
    const live = await this.prisma.client.booking.count({
      where: {
        OR: [{ resource: { categoryId: id } }, { resourceGroup: { categoryId: id } }],
        status: { in: [...LIVE_BOOKING_STATUSES] },
        endTime: { gt: new Date() },
      },
    });
    if (live > 0) {
      throw new ConflictException(
        `${live} upcoming or pending booking(s) exist for units of this facility. Deactivate it once they are completed or cancelled.`,
      );
    }
  }

  /** Distinct venues that have at least one unit under each facility. */
  private async venueCounts(categoryIds: string[]): Promise<Map<string, number>> {
    const [resources, groups] = await Promise.all([
      this.prisma.client.resource.findMany({
        where: { categoryId: { in: categoryIds } },
        select: { categoryId: true, venueId: true },
        distinct: ['categoryId', 'venueId'],
      }),
      this.prisma.client.resourceGroup.findMany({
        where: { categoryId: { in: categoryIds } },
        select: { categoryId: true, venueId: true },
        distinct: ['categoryId', 'venueId'],
      }),
    ]);
    const venuesBy = new Map<string, Set<string>>();
    for (const u of [...resources, ...groups]) {
      if (!venuesBy.has(u.categoryId)) venuesBy.set(u.categoryId, new Set());
      venuesBy.get(u.categoryId)!.add(u.venueId);
    }
    return new Map([...venuesBy].map(([id, venues]) => [id, venues.size]));
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
