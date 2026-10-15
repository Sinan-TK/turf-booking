import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCancellationPolicyDto, CreateCommissionDto } from './dto/policy.dto';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  async createCancellationPolicy(dto: CreateCancellationPolicyDto) {
    if (dto.scope === 'PLATFORM_DEFAULT') {
      // Not a DB constraint (a partial unique index would be the
      // stronger version of this) — enforced here because there is
      // exactly one write path for this scope in the whole app.
      const existing = await this.prisma.client.cancellationPolicy.findFirst({
        where: { scope: 'PLATFORM_DEFAULT' },
      });
      if (existing) {
        throw new BadRequestException(
          'A PLATFORM_DEFAULT cancellation policy already exists; update it instead of creating another',
        );
      }
    }
    return this.prisma.client.cancellationPolicy.create({ data: dto });
  }

  /** Venue override if set, else the platform default. */
  async resolveCancellationPolicy(venueId: string) {
    const venue = await this.prisma.client.venue.findUnique({
      where: { id: venueId },
      include: { cancellationPolicy: true },
    });
    if (!venue) throw new NotFoundException('Venue not found');
    if (venue.cancellationPolicy) return venue.cancellationPolicy;

    const platformDefault = await this.prisma.client.cancellationPolicy.findFirst({
      where: { scope: 'PLATFORM_DEFAULT' },
    });
    if (!platformDefault) {
      throw new NotFoundException(
        'No cancellation policy configured for this venue or the platform',
      );
    }
    return platformDefault;
  }

  async createCommission(dto: CreateCommissionDto) {
    if (dto.scope === 'ORGANIZATION' && !dto.organizationId) {
      throw new BadRequestException(
        'organizationId is required for an ORGANIZATION-scoped commission',
      );
    }
    return this.prisma.client.commission.create({ data: dto });
  }

  /** Latest organization-specific commission effective now, else the latest platform default. */
  async resolveCommission(organizationId: string, at: Date = new Date()) {
    const orgCommission = await this.prisma.client.commission.findFirst({
      where: { scope: 'ORGANIZATION', organizationId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (orgCommission) return orgCommission;

    const platformCommission = await this.prisma.client.commission.findFirst({
      where: { scope: 'PLATFORM_DEFAULT', effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!platformCommission) {
      throw new NotFoundException('No commission configured for this organization or the platform');
    }
    return platformCommission;
  }
}
