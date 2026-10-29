import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeFacilityCode, Role } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FacilityCodeService } from '../locations/facility-code.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import type { CreateVenueDto, UpdateVenueDto } from './dto/venue.dto';

// Status transitions a Venue Owner may make unassisted. Going live
// (ACTIVE) or being suspended (SUSPENDED) are platform moderation
// actions reserved for Super Admin — not specified explicitly in the
// brief, but a reasonable default for a marketplace where facility
// quality/legitimacy needs a review gate before customers can book it.
const OWNER_ALLOWED_STATUSES = new Set(['INACTIVE']);

// A venue offers whatever facilities (football turf, swimming pool...) its
// units belong to. Responses carry them as `facilities`, derived from the
// units, so clients can label and group without a 2nd call.
const FACILITY_SELECT = {
  id: true,
  slug: true,
  name: true,
  iconKey: true,
  iconSvg: true,
  unitLabel: true,
  venueLabel: true,
  unitTypes: true,
  defaultAllocationMode: true,
  sortOrder: true,
} as const;

const FACILITIES_INCLUDE = {
  resources: { select: { category: { select: FACILITY_SELECT } } },
  resourceGroups: { select: { category: { select: FACILITY_SELECT } } },
} as const;

type FacilitySummary = { id: string; sortOrder: number; name: string };

/** Replaces the raw unit rows with the venue's distinct facilities (catalogue order). */
function withFacilities<
  T extends {
    resources: Array<{ category: FacilitySummary }>;
    resourceGroups: Array<{ category: FacilitySummary }>;
  },
>(venue: T) {
  const { resources, resourceGroups, ...rest } = venue;
  const byId = new Map<string, T['resources'][number]['category']>();
  for (const unit of [...resources, ...resourceGroups]) byId.set(unit.category.id, unit.category);
  const facilities = [...byId.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map(({ sortOrder: _sortOrder, ...facility }) => facility);
  return { ...rest, facilities };
}

@Injectable()
export class VenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facilityCodes: FacilityCodeService,
    private readonly audit: AuditService,
    private readonly scope: OwnerScopeService,
  ) {}

  async create(dto: CreateVenueDto, actor: AuthContext) {
    const organizationId =
      actor.role === Role.VENUE_OWNER ? actor.organizationId! : dto.organizationId;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    // The venue's timezone is its district's: nobody types it in.
    const district = await this.prisma.client.district.findUnique({
      where: { id: dto.districtId },
      select: { timezone: true },
    });
    if (!district) throw new BadRequestException('Unknown district');
    const facilityCode = await this.facilityCodes.generate(dto.districtId);

    const created = await this.prisma.client.venue.create({
      data: {
        organizationId,
        facilityCode,
        name: dto.name,
        description: dto.description,
        districtId: dto.districtId,
        areaId: dto.areaId,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        googleMapsUrl: dto.googleMapsUrl,
        advanceBookingDays: dto.advanceBookingDays,
        timezone: district.timezone,
        // defaultSlotGranularityMinutes is not settable — always the
        // platform-fixed 60-minute default from the Prisma schema.
      },
      include: FACILITIES_INCLUDE,
    });
    const venue = withFacilities(created);

    await this.audit.record({
      actor,
      action: 'VENUE_CREATED',
      entityType: 'Venue',
      entityId: venue.id,
      metadata: { facilityCode: venue.facilityCode },
    });

    return venue;
  }

  private async findOwned(id: string, actor: AuthContext) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id }, include: FACILITIES_INCLUDE });
    if (!venue) throw new NotFoundException('Venue not found');
    if (actor.role === Role.VENUE_OWNER && venue.organizationId !== actor.organizationId) {
      throw new ForbiddenException("Cannot access another organization's venue");
    }
    await this.scope.assertVenue(actor, venue.id);
    return withFacilities(venue);
  }

  async getById(id: string, actor: AuthContext) {
    return this.findOwned(id, actor);
  }

  async listMine(actor: AuthContext) {
    if (actor.role === Role.SUPER_ADMIN) {
      const venues = await this.prisma.client.venue.findMany({
        orderBy: { createdAt: 'desc' },
        include: FACILITIES_INCLUDE,
      });
      return venues.map(withFacilities);
    }
    const assigned = await this.scope.assignedVenueIds(actor);
    const venues = await this.prisma.client.venue.findMany({
      where: { organizationId: actor.organizationId, ...(assigned ? { id: { in: assigned } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: FACILITIES_INCLUDE,
    });
    return venues.map(withFacilities);
  }

  async update(id: string, dto: UpdateVenueDto, actor: AuthContext) {
    await this.findOwned(id, actor);

    if (dto.status && actor.role === Role.VENUE_OWNER && !OWNER_ALLOWED_STATUSES.has(dto.status)) {
      throw new ForbiddenException(`Venue Owners cannot set status to ${dto.status}`);
    }

    const updated = await this.prisma.client.venue.update({
      where: { id },
      data: dto,
      include: FACILITIES_INCLUDE,
    });
    const venue = withFacilities(updated);

    await this.audit.record({
      actor,
      action: 'VENUE_UPDATED',
      entityType: 'Venue',
      entityId: venue.id,
      metadata: { ...dto },
    });

    return venue;
  }

  /**
   * Public lookup for the "Enter Venue Code" flow (ARCHITECTURE.md §6.6).
   * Normalizes input and returns the same "not found" response for a
   * nonexistent code and an inactive facility, so status is never
   * leaked to an unauthenticated caller.
   */
  async findActiveByFacilityCode(rawCode: string) {
    const facilityCode = normalizeFacilityCode(rawCode);
    const venue = await this.prisma.client.venue.findUnique({ where: { facilityCode } });
    if (!venue || venue.status !== 'ACTIVE' || venue.deletedAt) {
      throw new NotFoundException('Facility not found');
    }
    return venue;
  }
}
