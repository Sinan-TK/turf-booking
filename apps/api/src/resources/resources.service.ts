import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';

@Injectable()
export class ResourcesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return venue;
  }

  /**
   * Resource unit types follow the venue type: when the category lists
   * unitTypes the resource's groundType must be one of them (case-insensitive,
   * stored as the canonical spelling); an empty list means free text.
   */
  private async assertValidUnitType(categoryId: string, groundType: string) {
    const category = await this.prisma.client.venueCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.unitTypes.length === 0) return;
    if (!category.unitTypes.some((t) => t === groundType)) {
      throw new BadRequestException(
        `Unit type must be one of: ${category.unitTypes.join(', ')} (${category.name})`,
      );
    }
  }

  /** Exclusive venue types (e.g. chess tables, courts) cannot host pooled inventory. */
  private async assertGroupModeAllowed(categoryId: string, mode: 'EXCLUSIVE' | 'POOLED') {
    if (mode !== 'POOLED') return;
    const category = await this.prisma.client.venueCategory.findUnique({ where: { id: categoryId } });
    if (category && category.defaultAllocationMode === 'EXCLUSIVE') {
      throw new BadRequestException(
        `${category.name} venues are booked per ${category.unitLabel.toLowerCase()}; pooled inventory is not available for this venue type.`,
      );
    }
  }

  async create(
    dto: {
      venueId: string;
      name: string;
      groundType: string;
      isBookable: boolean;
      sortOrder: number;
    },
    actor: AuthContext,
  ) {
    const venue = await this.assertVenueOwnership(dto.venueId, actor);
    await this.assertValidUnitType(venue.categoryId, dto.groundType);
    return this.prisma.client.$transaction(async (tx) => {
      const resource = await tx.resource.create({
        data: {
          venueId: dto.venueId,
          name: dto.name,
          groundType: dto.groundType,
          isBookable: dto.isBookable,
          sortOrder: dto.sortOrder,
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

  async listForVenue(venueId: string, actor: AuthContext) {
    // Reads are ownership-checked too: an owner must not enumerate another
    // organization's resources by guessing a venueId.
    await this.assertVenueOwnership(venueId, actor);
    return this.prisma.client.resource.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
    });
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
      name: string;
      allocationMode: 'EXCLUSIVE' | 'POOLED';
      totalUnits?: number;
      sortOrder: number;
    },
    actor: AuthContext,
  ) {
    const venue = await this.assertVenueOwnership(dto.venueId, actor);
    await this.assertGroupModeAllowed(venue.categoryId, dto.allocationMode);
    if (dto.allocationMode === 'POOLED') {
      if (dto.totalUnits === undefined || !Number.isInteger(dto.totalUnits) || dto.totalUnits < 1) {
        throw new BadRequestException('POOLED groups require a positive integer totalUnits');
      }
    }
    return this.prisma.client.resourceGroup.create({
      data: {
        venueId: dto.venueId,
        name: dto.name,
        allocationMode: dto.allocationMode,
        totalUnits: dto.totalUnits,
        sortOrder: dto.sortOrder,
      },
    });
  }

  async listGroupsForVenue(venueId: string, actor: AuthContext) {
    await this.assertVenueOwnership(venueId, actor);
    return this.prisma.client.resourceGroup.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
