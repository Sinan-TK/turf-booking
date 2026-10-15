import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizeFacilityCode, Role } from '@venue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FacilityCodeService } from '../locations/facility-code.service';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import type { CreateVenueDto, UpdateVenueDto } from './dto/venue.dto';

// Status transitions a Venue Owner may make unassisted. Going live
// (ACTIVE) or being suspended (SUSPENDED) are platform moderation
// actions reserved for Super Admin — not specified explicitly in the
// brief, but a reasonable default for a marketplace where facility
// quality/legitimacy needs a review gate before customers can book it.
const OWNER_ALLOWED_STATUSES = new Set(['DRAFT', 'INACTIVE']);

// Category fields every venue response carries, so clients can label the
// venue ("Table" vs "Pitch") and validate unit types without a 2nd call.
const CATEGORY_INCLUDE = {
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
      iconKey: true,
      unitLabel: true,
      venueLabel: true,
      unitTypes: true,
      defaultAllocationMode: true,
    },
  },
} as const;

const DEFAULT_CATEGORY_SLUG = 'FOOTBALL_TURF';

@Injectable()
export class VenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facilityCodes: FacilityCodeService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateVenueDto, actor: AuthContext) {
    const organizationId =
      actor.role === Role.VENUE_OWNER ? actor.organizationId! : dto.organizationId;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }

    const category = await this.resolveActiveCategory(dto.categoryId);
    const facilityCode = await this.facilityCodes.generate(dto.districtId);

    const venue = await this.prisma.client.venue.create({
      data: {
        organizationId,
        categoryId: category.id,
        facilityCode,
        name: dto.name,
        description: dto.description,
        districtId: dto.districtId,
        areaId: dto.areaId,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        timezone: dto.timezone,
        // defaultSlotGranularityMinutes is not settable — always the
        // platform-fixed 60-minute default from the Prisma schema.
      },
      include: CATEGORY_INCLUDE,
    });

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
    const venue = await this.prisma.client.venue.findUnique({ where: { id }, include: CATEGORY_INCLUDE });
    if (!venue) throw new NotFoundException('Venue not found');
    if (actor.role === Role.VENUE_OWNER && venue.organizationId !== actor.organizationId) {
      throw new ForbiddenException("Cannot access another organization's venue");
    }
    return venue;
  }

  /** The requested category, or FOOTBALL_TURF when none is given. Must be active. */
  private async resolveActiveCategory(categoryId: string | undefined) {
    const category = categoryId
      ? await this.prisma.client.venueCategory.findUnique({ where: { id: categoryId } })
      : await this.prisma.client.venueCategory.findUnique({ where: { slug: DEFAULT_CATEGORY_SLUG } });
    if (!category) throw new BadRequestException('Unknown venue type');
    if (!category.isActive) throw new BadRequestException('This venue type is not active');
    return category;
  }

  async getById(id: string, actor: AuthContext) {
    return this.findOwned(id, actor);
  }

  async listMine(actor: AuthContext) {
    if (actor.role === Role.SUPER_ADMIN) {
      return this.prisma.client.venue.findMany({ orderBy: { createdAt: 'desc' }, include: CATEGORY_INCLUDE });
    }
    return this.prisma.client.venue.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { createdAt: 'desc' },
      include: CATEGORY_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateVenueDto, actor: AuthContext) {
    const current = await this.findOwned(id, actor);

    if (dto.status && actor.role === Role.VENUE_OWNER && !OWNER_ALLOWED_STATUSES.has(dto.status)) {
      throw new ForbiddenException(`Venue Owners cannot set status to ${dto.status}`);
    }

    if (dto.categoryId && dto.categoryId !== current.categoryId) {
      await this.resolveActiveCategory(dto.categoryId);
      const resourceCount = await this.prisma.client.resource.count({ where: { venueId: id } });
      if (resourceCount > 0) {
        throw new ConflictException('The venue type cannot be changed once the venue has resources.');
      }
    }

    const venue = await this.prisma.client.venue.update({
      where: { id },
      data: dto,
      include: CATEGORY_INCLUDE,
    });

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
