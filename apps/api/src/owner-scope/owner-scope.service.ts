import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthContext } from '../auth/auth.types';

/**
 * Which venues an owner-portal caller may work in. An OWNER_ADMIN (and the Super Admin) reaches every
 * venue of the organization; an OWNER_STAFF user reaches only the venues assigned to them
 * (venue_staff_assignments). Assignments are read from the database on every call, not from the
 * access token, so reassigning a staff member takes effect immediately. The organization check
 * stays with each caller: this only narrows within the organization.
 */
@Injectable()
export class OwnerScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isStaff(actor: AuthContext): boolean {
    return actor.role === 'VENUE_OWNER' && actor.ownerRole === 'OWNER_STAFF';
  }

  /** null = every venue of the organization; otherwise the assigned venue ids (possibly none). */
  async assignedVenueIds(actor: AuthContext): Promise<string[] | null> {
    if (!this.isStaff(actor)) return null;
    const rows = await this.prisma.client.venueStaffAssignment.findMany({
      where: { ownerUserId: actor.id, venue: { organizationId: actor.organizationId } },
      select: { venueId: true },
    });
    return rows.map((r) => r.venueId);
  }

  async assertVenue(actor: AuthContext, venueId: string): Promise<void> {
    const allowed = await this.assignedVenueIds(actor);
    if (allowed && !allowed.includes(venueId)) {
      throw new ForbiddenException('You are not assigned to this venue');
    }
  }

  /**
   * The venue part of a list filter: a requested venue must be one the caller may reach; with none
   * requested, a staff user is limited to their assigned venues.
   */
  async venueFilter(
    actor: AuthContext,
    requestedVenueId?: string,
  ): Promise<{ venueId?: string; venueIds?: string[] }> {
    if (requestedVenueId) {
      await this.assertVenue(actor, requestedVenueId);
      return { venueId: requestedVenueId };
    }
    const allowed = await this.assignedVenueIds(actor);
    return allowed ? { venueIds: allowed } : {};
  }

  /** The distinct venue ids, after checking each one belongs to the organization. */
  async assertVenuesInOrganization(organizationId: string, venueIds: string[]): Promise<string[]> {
    const unique = [...new Set(venueIds)];
    const found = await this.prisma.client.venue.count({ where: { id: { in: unique }, organizationId } });
    if (found !== unique.length) {
      throw new BadRequestException('One or more venues do not belong to this organization');
    }
    return unique;
  }

  /**
   * Replaces a staff member's venue assignments. Every venue must belong to the organization, so an
   * owner can never hand out another organization's venue.
   */
  async replaceAssignments(ownerUserId: string, organizationId: string, venueIds: string[]): Promise<void> {
    const unique = await this.assertVenuesInOrganization(organizationId, venueIds);
    await this.prisma.client.$transaction([
      this.prisma.client.venueStaffAssignment.deleteMany({ where: { ownerUserId } }),
      this.prisma.client.venueStaffAssignment.createMany({
        data: unique.map((venueId) => ({ ownerUserId, venueId })),
      }),
    ]);
  }
}
