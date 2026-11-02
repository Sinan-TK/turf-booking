import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import { StorageService } from '../storage/storage.service';
import { PolicyResolverService } from '../scheduling/policy-resolver.service';
import { unitDurationProblem } from '@venue/shared';
import type { Prisma } from '@venue/database';
import { parseFixedSlots, slotProblems, type FixedSlot } from './group-slots';
import { isDurationAllowed } from '../scheduling/policy-validation';
import { CommercialTermsService } from '../commercial/commercial-terms.service';

/** The facility fields a unit carries to clients: labels, allowed sub-types, icon. */
const CATEGORY_SUMMARY = {
  id: true,
  slug: true,
  name: true,
  iconKey: true,
  iconSvg: true,
  unitLabel: true,
  venueLabel: true,
  unitTypes: true,
  defaultAllocationMode: true,
} as const;

@Injectable()
export class ResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OwnerScopeService,
    private readonly storage: StorageService,
    private readonly policies: PolicyResolverService,
    private readonly commercialTerms: CommercialTermsService,
  ) {}

  /** For the unit-photo endpoints: the same ownership check every write here makes. */
  assertCanManageVenue(venueId: string, actor: AuthContext) {
    return this.assertVenueOwnership(venueId, actor);
  }

  /**
   * Every method (reads included) takes `actor` and re-derives the owning venue's
   * organizationId itself rather than trusting a caller-supplied one —
   * ownership is never implied by role alone (ARCHITECTURE.md §12).
   */
  private async assertVenueOwnership(venueId: string, actor: AuthContext) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');
    if (actor.role === 'VENUE_OWNER' && venue.organizationId !== actor.organizationId) {
      throw new ForbiddenException("Cannot manage another organization's venue");
    }
    await this.scope.assertVenue(actor, venueId);
    return venue;
  }

  /** The facility a unit is being added under: it must exist and be active. */
  private async requireActiveCategory(categoryId: string) {
    const category = await this.prisma.client.venueCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new BadRequestException('Unknown facility');
    if (!category.isActive) throw new BadRequestException('This facility is not active');
    return category;
  }

  /**
   * Unit types follow the unit's facility: when the category lists
   * unitTypes the resource's groundType must be one of them; an empty list
   * means free text.
   */
  private assertValidUnitType(category: { name: string; unitTypes: string[] }, groundType: string) {
    if (category.unitTypes.length === 0) return;
    if (!category.unitTypes.some((t) => t === groundType)) {
      throw new BadRequestException(
        `Unit type must be one of: ${category.unitTypes.join(', ')} (${category.name})`,
      );
    }
  }

  /** Exclusive facilities (e.g. chess tables, courts) cannot host pooled inventory. */
  private assertGroupModeAllowed(
    category: { name: string; unitLabel: string; defaultAllocationMode: string },
    mode: 'EXCLUSIVE' | 'POOLED',
  ) {
    if (mode !== 'POOLED') return;
    if (category.defaultAllocationMode === 'EXCLUSIVE') {
      throw new BadRequestException(
        `${category.name} is booked per ${category.unitLabel.toLowerCase()}; pooled inventory is not available for this facility.`,
      );
    }
  }

  async create(
    dto: {
      venueId: string;
      categoryId: string;
      name: string;
      groundType: string;
      isBookable: boolean;
      sortOrder: number;
      minDurationMinutes?: number;
      maxDurationMinutes?: number;
    },
    actor: AuthContext,
  ) {
    await this.assertVenueOwnership(dto.venueId, actor);
    const category = await this.requireActiveCategory(dto.categoryId);
    const durations = await this.unitDurations(dto.venueId, { categoryId: category.id }, dto);
    this.assertValidUnitType(category, dto.groundType);
    // Types are a preset list per facility so units stay filterable. A facility with
    // no presets has no type at all: anything sent is ignored rather than stored as free text.
    const groundType = category.unitTypes.length === 0 ? '' : dto.groundType;
    return this.prisma.client.$transaction(async (tx) => {
      const resource = await tx.resource.create({
        data: {
          venueId: dto.venueId,
          categoryId: category.id,
          name: dto.name,
          groundType,
          isBookable: dto.isBookable,
          sortOrder: dto.sortOrder,
          minDurationMinutes: durations.min,
          maxDurationMinutes: durations.max,
        },
      });
      // Self-row is required by the closure-table algorithm (§6.1) —
      // without it, a resource with no composition edges yet wouldn't
      // appear in its own closure() result.
      await tx.resourceClosure.create({
        data: { ancestorId: resource.id, descendantId: resource.id, depth: 0 },
      });
      return resource;
    });
  }

  /**
   * A unit's shortest and longest booking: the given values, else the facility's own (its shortest, and the longest whole
   * multiple of that which the facility allows). Rejected, never rounded, when the pair is not valid.
   */
  private async unitDurations(
    venueId: string,
    target: { resourceId?: string; categoryId?: string },
    input: { minDurationMinutes?: number; maxDurationMinutes?: number },
  ): Promise<{ min: number; max: number }> {
    const policy = (await this.policies.forVenue({ id: venueId }, new Date(), target.categoryId ? [target.categoryId] : undefined)).resolve(target);
    const min = input.minDurationMinutes ?? policy.minDurationMin;
    const max = input.maxDurationMinutes ?? Math.max(min, Math.floor(policy.maxDurationMin / min) * min);
    const problem = unitDurationProblem({ minMinutes: min, maxMinutes: max, slotIntervalMin: policy.slotIntervalMin });
    if (problem) throw new BadRequestException(problem);
    return { min, max };
  }

  /** Changes a unit's shortest and longest booking. Its prices are per block of the shortest. Bookings already made stay as they are. */
  async setDurations(id: string, dto: { minDurationMinutes: number; maxDurationMinutes: number }, actor: AuthContext) {
    const resource = await this.prisma.client.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException('Unit not found');
    await this.assertVenueOwnership(resource.venueId, actor);
    // The unit's own saved values must not take part in the check, only the facility's start grid.
    const policy = (await this.policies.forVenue({ id: resource.venueId })).resolve({ categoryId: resource.categoryId });
    const problem = unitDurationProblem({
      minMinutes: dto.minDurationMinutes,
      maxMinutes: dto.maxDurationMinutes,
      slotIntervalMin: policy.slotIntervalMin,
    });
    if (problem) throw new BadRequestException(problem);
    return this.prisma.client.resource.update({
      where: { id },
      data: { minDurationMinutes: dto.minDurationMinutes, maxDurationMinutes: dto.maxDurationMinutes },
      include: { category: { select: CATEGORY_SUMMARY } },
    });
  }

  /** Stops (or resumes) new bookings on one unit. Bookings already made stay as they are. */
  async setBookable(id: string, isBookable: boolean, actor: AuthContext) {
    const resource = await this.prisma.client.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException('Unit not found');
    await this.assertVenueOwnership(resource.venueId, actor);
    return this.prisma.client.resource.update({
      where: { id },
      data: { isBookable },
      include: { category: { select: CATEGORY_SUMMARY } },
    });
  }

  /** Same, for every unit of one facility in a venue, so a pool can close without touching the turf. */
  async setFacilityBookable(
    dto: { venueId: string; categoryId: string; isBookable: boolean },
    actor: AuthContext,
  ) {
    await this.assertVenueOwnership(dto.venueId, actor);
    const { count } = await this.prisma.client.resource.updateMany({
      where: { venueId: dto.venueId, categoryId: dto.categoryId },
      data: { isBookable: dto.isBookable },
    });
    return { updated: count };
  }

  async listForVenue(venueId: string, actor: AuthContext) {
    // Reads are ownership-checked too: an owner must not enumerate another
    // organization's resources by guessing a venueId.
    await this.assertVenueOwnership(venueId, actor);
    const units = await this.prisma.client.resource.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: { select: CATEGORY_SUMMARY },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, key: true } },
      },
    });
    // Each unit carries its photos (main one first) as public URLs, ready for the owner's photo editor.
    return units.map(({ photos, ...unit }) => ({ ...unit, photos: photos.map((p) => ({ id: p.id, url: this.storage.publicUrl(p.key) })) }));
  }

  /**
   * Adds a parent/child composition edge and maintains the transitive
   * closure table (standard closure-table insertion: for every ancestor
   * of the parent — including itself — and every descendant of the
   * child — including itself — record/shorten the path between them).
   * Rejects an edge that would create a cycle.
   */
  async addComposition(
    dto: { parentResourceId: string; childResourceId: string },
    actor: AuthContext,
  ) {
    const { parentResourceId, childResourceId } = dto;
    if (parentResourceId === childResourceId) {
      throw new BadRequestException('A resource cannot be composed of itself');
    }

    const [parent, child] = await Promise.all([
      this.prisma.client.resource.findUnique({ where: { id: parentResourceId } }),
      this.prisma.client.resource.findUnique({ where: { id: childResourceId } }),
    ]);
    if (!parent || !child) throw new NotFoundException('Resource not found');
    if (parent.venueId !== child.venueId) {
      throw new BadRequestException('Composed resources must belong to the same venue');
    }
    if (parent.categoryId !== child.categoryId) {
      throw new BadRequestException('Composed resources must belong to the same facility');
    }
    await this.assertVenueOwnership(parent.venueId, actor);

    return this.prisma.client.$transaction(async (tx) => {
      const wouldCycle = await tx.resourceClosure.findUnique({
        where: {
          ancestorId_descendantId: { ancestorId: childResourceId, descendantId: parentResourceId },
        },
      });
      if (wouldCycle) {
        throw new BadRequestException('This composition would create a cycle');
      }

      const composition = await tx.resourceComposition.create({
        data: { parentResourceId, childResourceId },
      });

      const [ancestorsOfParent, descendantsOfChild] = await Promise.all([
        tx.resourceClosure.findMany({ where: { descendantId: parentResourceId } }),
        tx.resourceClosure.findMany({ where: { ancestorId: childResourceId } }),
      ]);

      for (const a of ancestorsOfParent) {
        for (const d of descendantsOfChild) {
          const newDepth = a.depth + d.depth + 1;
          const existing = await tx.resourceClosure.findUnique({
            where: {
              ancestorId_descendantId: { ancestorId: a.ancestorId, descendantId: d.descendantId },
            },
          });
          if (!existing) {
            await tx.resourceClosure.create({
              data: { ancestorId: a.ancestorId, descendantId: d.descendantId, depth: newDepth },
            });
          } else if (newDepth < existing.depth) {
            await tx.resourceClosure.update({
              where: { id: existing.id },
              data: { depth: newDepth },
            });
          }
        }
      }

      return composition;
    });
  }

  /**
   * footprint(R) — corrected from an earlier "lock the whole
   * ancestor+descendant closure" design that turned out to violate the
   * brief's own conflict rule (caught by live end-to-end testing, not
   * reasoning about the schema in the abstract — see ARCHITECTURE.md
   * §6.1/§6.3 for the full account). The physically correct primitive is
   * the set of LEAF resources R actually occupies: itself, if R has no
   * children; otherwise the leaf descendants of R, recursively. Locking
   * (write path) and availability-checking (read path) must both operate
   * over footprint(R), never over R's ancestors — an ancestor becoming
   * unbookable is a *consequence* of one of its leaves being taken, not
   * something to lock directly, and locking it directly is exactly what
   * incorrectly made booking 5s A block 5s B (both share ancestor
   * 7s Full, but do not share a footprint).
   *
   * Computed as: descendants of R (inclusive of R itself, via the
   * closure table) that are not themselves a parent of any composition
   * edge — i.e., that have no children.
   */
  /** The footprints (see getFootprintResourceIds) of many units at once: two reads for all of them, not two each. */
  async getFootprintsFor(resourceIds: string[]): Promise<Map<string, string[]>> {
    if (resourceIds.length === 0) return new Map();
    const closure = await this.prisma.client.resourceClosure.findMany({
      where: { ancestorId: { in: resourceIds } },
      select: { ancestorId: true, descendantId: true },
    });
    const allDescendants = [...new Set(closure.map((c) => c.descendantId))];
    const parents = await this.prisma.client.resourceComposition.findMany({
      where: { parentResourceId: { in: allDescendants } },
      select: { parentResourceId: true },
      distinct: ['parentResourceId'],
    });
    const nonLeaf = new Set(parents.map((p) => p.parentResourceId));
    const byUnit = new Map<string, string[]>();
    for (const c of closure) {
      const list = byUnit.get(c.ancestorId) ?? [];
      list.push(c.descendantId);
      byUnit.set(c.ancestorId, list);
    }
    const footprints = new Map<string, string[]>();
    for (const id of resourceIds) {
      const leaves = (byUnit.get(id) ?? []).filter((d) => !nonLeaf.has(d));
      footprints.set(id, leaves.length > 0 ? leaves : [id]);
    }
    return footprints;
  }

  async getFootprintResourceIds(resourceId: string): Promise<string[]> {
    const descendants = await this.prisma.client.resourceClosure.findMany({
      where: { ancestorId: resourceId },
      select: { descendantId: true },
    });
    const descendantIds = descendants.map((d) => d.descendantId);

    const parentsAmongThem = await this.prisma.client.resourceComposition.findMany({
      where: { parentResourceId: { in: descendantIds } },
      select: { parentResourceId: true },
      distinct: ['parentResourceId'],
    });
    const nonLeafIds = new Set(parentsAmongThem.map((p) => p.parentResourceId));

    const leaves = descendantIds.filter((id) => !nonLeafIds.has(id));
    // A resource always has at least itself in its footprint — this
    // fallback only matters if the ResourceClosure self-row is somehow
    // missing, which `create()` above guarantees it never is.
    return leaves.length > 0 ? leaves : [resourceId];
  }

  /**
   * P2: named inventory pools inside a venue (kayak SINGLE/DOUBLE
   * fleets). Same ownership pattern as create() — the owning venue is
   * re-derived and checked, never trusted from the caller.
   */
  async createGroup(
    dto: {
      venueId: string;
      categoryId: string;
      name: string;
      allocationMode: 'EXCLUSIVE' | 'POOLED';
      totalUnits?: number;
      sortOrder: number;
      slotMode?: 'FLEXIBLE' | 'FIXED';
      fixedSlots?: Array<{ start: string; end: string; count: number; price?: number | null; advance?: number | null }>;
    },
    actor: AuthContext,
  ) {
    await this.assertVenueOwnership(dto.venueId, actor);
    const category = await this.requireActiveCategory(dto.categoryId);
    this.assertGroupModeAllowed(category, dto.allocationMode);
    if (dto.allocationMode === 'POOLED') {
      if (dto.totalUnits === undefined || !Number.isInteger(dto.totalUnits) || dto.totalUnits < 1) {
        throw new BadRequestException('POOLED groups require a positive integer totalUnits');
      }
    }
    const slotMode = dto.slotMode ?? 'FLEXIBLE';
    const fixedSlots = slotMode === 'FIXED' ? this.normalizeSlots(dto.fixedSlots ?? []) : [];
    if (slotMode === 'FIXED') await this.assertSlots(dto.venueId, undefined, category.id, dto.totalUnits ?? null, fixedSlots);
    return this.prisma.client.resourceGroup.create({
      data: {
        venueId: dto.venueId,
        categoryId: category.id,
        name: dto.name,
        allocationMode: dto.allocationMode,
        totalUnits: dto.totalUnits,
        sortOrder: dto.sortOrder,
        slotMode,
        fixedSlots: fixedSlots as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** The slots as saved: the numbers kept, a missing price left null, in clock order. */
  private normalizeSlots(slots: Array<{ start: string; end: string; count: number; price?: number | null; advance?: number | null }>): FixedSlot[] {
    return parseFixedSlots(slots.map((s) => ({ ...s, price: s.price ?? null, advance: s.advance ?? null })));
  }

  /** The slots must be bookable as the owner wrote them (no overlaps, lengths the facility allows, prices within the platform's rules). */
  private async assertSlots(venueId: string, groupId: string | undefined, categoryId: string, totalUnits: number | null, slots: FixedSlot[]) {
    const policy = (await this.policies.forVenue({ id: venueId })).resolve({ categoryId, ...(groupId ? { resourceGroupId: groupId } : {}) });
    const { terms } = await this.commercialTerms.resolve(venueId, categoryId);
    const problem = slotProblems(slots, {
      totalUnits,
      slotIntervalMin: policy.slotIntervalMin,
      allowedLength: (minutes) => isDurationAllowed(policy, minutes),
      minAdvancePercent: terms.minAdvancePercent,
    });
    if (problem) throw new BadRequestException(problem);
  }

  /**
   * Changes a pooled group: its name, how many it has, whether it is open and when its slots are. The count cannot drop below what
   * is already booked at the busiest moment ahead, so no existing booking is left without its units.
   */
  async updateGroup(
    id: string,
    dto: {
      name?: string;
      totalUnits?: number;
      isBookable?: boolean;
      slotMode?: 'FLEXIBLE' | 'FIXED';
      fixedSlots?: Array<{ start: string; end: string; count: number; price?: number | null; advance?: number | null }>;
    },
    actor: AuthContext,
  ) {
    const group = await this.prisma.client.resourceGroup.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');
    await this.assertVenueOwnership(group.venueId, actor);
    if (dto.totalUnits !== undefined) {
      if (group.allocationMode !== 'POOLED') throw new BadRequestException('Only a pooled group has a count');
      const [peak] = await this.prisma.client.$queryRaw<Array<{ peak: bigint }>>`
        SELECT COALESCE(MAX(s.total), 0)::bigint AS peak FROM (
          SELECT (SELECT COALESCE(SUM(o.quantity), 0) FROM inventory_reservations o
                  WHERE o."resourceGroupId" = r."resourceGroupId" AND o.status IN ('HELD', 'CONFIRMED')
                    AND o."startTime" <= r."startTime" AND o."endTime" > r."startTime") AS total
          FROM inventory_reservations r
          WHERE r."resourceGroupId" = ${id}::uuid AND r.status IN ('HELD', 'CONFIRMED') AND r."endTime" > now()
        ) s`;
      const booked = Number(peak?.peak ?? 0);
      if (dto.totalUnits < booked) {
        throw new BadRequestException(`${booked} are already booked at the busiest time ahead, so the count can't go below ${booked}.`);
      }
    }
    const slotMode = dto.slotMode ?? group.slotMode;
    const totalUnits = dto.totalUnits ?? group.totalUnits;
    const slots = dto.fixedSlots !== undefined ? this.normalizeSlots(dto.fixedSlots) : parseFixedSlots(group.fixedSlots);
    if (slotMode === 'FIXED') await this.assertSlots(group.venueId, group.id, group.categoryId, totalUnits, slots);
    return this.prisma.client.resourceGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.totalUnits !== undefined ? { totalUnits: dto.totalUnits } : {}),
        ...(dto.isBookable !== undefined ? { isBookable: dto.isBookable } : {}),
        slotMode,
        fixedSlots: (slotMode === 'FIXED' ? slots : []) as unknown as Prisma.InputJsonValue,
      },
      include: { category: { select: CATEGORY_SUMMARY } },
    });
  }

  async listGroupsForVenue(venueId: string, actor: AuthContext) {
    await this.assertVenueOwnership(venueId, actor);
    const groups = await this.prisma.client.resourceGroup.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: { select: CATEGORY_SUMMARY },
        photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, key: true } },
      },
    });
    // Each group carries its photos (main one first) as public URLs, like a unit does.
    return groups.map(({ photos, ...group }) => ({ ...group, photos: photos.map((p) => ({ id: p.id, url: this.storage.publicUrl(p.key) })) }));
  }
}
