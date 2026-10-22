import { Injectable, NotFoundException } from '@nestjs/common';
import type { BookingPolicy } from '@venue/database';
import { PrismaService } from '../prisma/prisma.service';
import { LEGACY_POLICY_DEFAULTS, type BookingPolicyValues } from '../common/booking-policy.defaults';

export type PolicySource = 'RESOURCE' | 'GROUP' | 'VENUE' | 'CATEGORY' | 'PLATFORM_DEFAULT' | 'LEGACY_FALLBACK';

export interface ResolvedPolicy extends BookingPolicyValues {
  /** Which scope won the precedence chain (useful for debugging/admin UIs). */
  source: PolicySource;
}

function values(row: BookingPolicy): BookingPolicyValues {
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

/**
 * Every BookingPolicy row that can apply inside one venue, loaded in a
 * single query. Resolving a resource/group from it is then pure and
 * synchronous, so a search over many resources costs one policy query per
 * venue rather than one per resource.
 *
 * Precedence: RESOURCE > GROUP > VENUE > CATEGORY > PLATFORM_DEFAULT, and
 * within one scope the latest effectiveFrom <= now wins. The CATEGORY is
 * the target unit's own facility, so one venue can run a football turf and
 * a swimming pool on different rules.
 */
export class PolicySet {
  constructor(
    private readonly rows: BookingPolicy[],
    private readonly venueId: string,
    /** Each unit's facility, so CATEGORY rules follow the unit being resolved. */
    private readonly resourceCategory: ReadonlyMap<string, string>,
    private readonly groupCategory: ReadonlyMap<string, string>,
  ) {}

  resolve(target: { resourceId?: string | null; resourceGroupId?: string | null } = {}): ResolvedPolicy {
    const categoryId =
      (target.resourceId ? this.resourceCategory.get(target.resourceId) : undefined) ??
      (target.resourceGroupId ? this.groupCategory.get(target.resourceGroupId) : undefined);
    // rows are pre-sorted by effectiveFrom desc, so find() = latest.
    const pick = (match: (r: BookingPolicy) => boolean, source: PolicySource) => {
      const row = this.rows.find(match);
      return row ? { ...values(row), source } : null;
    };
    return (
      (target.resourceId
        ? pick((r) => r.scope === 'RESOURCE' && r.resourceId === target.resourceId, 'RESOURCE')
        : null) ??
      (target.resourceGroupId
        ? pick((r) => r.scope === 'GROUP' && r.resourceGroupId === target.resourceGroupId, 'GROUP')
        : null) ??
      pick((r) => r.scope === 'VENUE' && r.venueId === this.venueId, 'VENUE') ??
      (categoryId ? pick((r) => r.scope === 'CATEGORY' && r.categoryId === categoryId, 'CATEGORY') : null) ??
      pick((r) => r.scope === 'PLATFORM_DEFAULT', 'PLATFORM_DEFAULT') ?? {
        ...LEGACY_POLICY_DEFAULTS,
        source: 'LEGACY_FALLBACK' as const,
      }
    );
  }
}

@Injectable()
export class PolicyResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /** Load the policy set for a venue: its own rules plus the rules of every facility its units belong to. */
  async forVenue(venue: { id: string }, now: Date = new Date()): Promise<PolicySet> {
    const [resources, groups] = await Promise.all([
      this.prisma.client.resource.findMany({ where: { venueId: venue.id }, select: { id: true, categoryId: true } }),
      this.prisma.client.resourceGroup.findMany({ where: { venueId: venue.id }, select: { id: true, categoryId: true } }),
    ]);
    const categoryIds = [...new Set([...resources, ...groups].map((u) => u.categoryId))];
    const rows = await this.prisma.client.bookingPolicy.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [
          { scope: 'PLATFORM_DEFAULT' },
          { scope: 'CATEGORY', categoryId: { in: categoryIds } },
          { scope: 'VENUE', venueId: venue.id },
          { scope: 'GROUP', resourceGroup: { venueId: venue.id } },
          { scope: 'RESOURCE', resource: { venueId: venue.id } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return new PolicySet(
      rows,
      venue.id,
      new Map(resources.map((r) => [r.id, r.categoryId])),
      new Map(groups.map((g) => [g.id, g.categoryId])),
    );
  }

  /** Convenience: resolve the policy for one resource or group by id. */
  async forResourceId(resourceId: string): Promise<ResolvedPolicy> {
    const resource = await this.prisma.client.resource.findUnique({
      where: { id: resourceId },
      include: { venue: { select: { id: true } } },
    });
    if (!resource) throw new NotFoundException('Resource not found');
    return (await this.forVenue(resource.venue)).resolve({ resourceId });
  }

  async forGroupId(resourceGroupId: string): Promise<ResolvedPolicy> {
    const group = await this.prisma.client.resourceGroup.findUnique({
      where: { id: resourceGroupId },
      include: { venue: { select: { id: true } } },
    });
    if (!group) throw new NotFoundException('Resource group not found');
    return (await this.forVenue(group.venue)).resolve({ resourceGroupId });
  }
}
