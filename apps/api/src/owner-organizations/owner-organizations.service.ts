import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../identity/identity.service';
import { OwnerScopeService } from '../owner-scope/owner-scope.service';
import type { OwnerOrganizationStatus, OwnerUserStatus } from '@venue/database';
import type { AuthContext } from '../auth/auth.types';
import type { CreateOrganizationDto, CreateOwnerUserDto } from './dto/owner-organization.dto';

/**
 * Super-Admin-only provisioning for the OwnerOrganization -> VenueOwnerUser
 * hierarchy (ARCHITECTURE.md §Owners). Before this module existed, the
 * only way to create an organization or an owner login was the seed
 * script, which the Super Admin Portal's "Owners" page needs to replace.
 */
@Injectable()
export class OwnerOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: OwnerScopeService,
    private readonly identity: IdentityService,
  ) {}

  async createOrganization(dto: CreateOrganizationDto, actor: AuthContext) {
    const org = await this.prisma.client.ownerOrganization.create({
      data: {
        name: dto.name,
        contactEmail: dto.contactEmail,
        contactPhone: dto.contactPhone,
      },
    });

    await this.audit.record({
      actor,
      action: 'OWNER_ORGANIZATION_CREATED',
      entityType: 'OwnerOrganization',
      entityId: org.id,
      metadata: { name: org.name },
    });

    return org;
  }

  async listOrganizations() {
    return this.prisma.client.ownerOrganization.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getOrganization(id: string) {
    const org = await this.prisma.client.ownerOrganization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /**
   * Organization plus what an admin needs to judge the tenant: venue and
   * login counts, booking volume and revenue, last booking, and the
   * venues themselves.
   */
  async getOrganizationDetail(id: string) {
    const org = await this.getOrganization(id);
    const db = this.prisma.client;
    const where = { venue: { organizationId: id } };
    const [venues, ownerUsers, byStatus, revenue, last, recentBookings] = await Promise.all([
      db.venue.findMany({
        where: { organizationId: id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          facilityCode: true,
          status: true,
          resources: { select: { category: { select: { id: true, name: true } } } },
          resourceGroups: { select: { category: { select: { id: true, name: true } } } },
        },
      }),
      db.venueOwnerUser.groupBy({ by: ['status'], where: { organizationId: id }, _count: { _all: true } }),
      db.booking.groupBy({ by: ['status'], where, _count: { _all: true } }),
      db.booking.aggregate({ where: { ...where, status: { in: ['CONFIRMED', 'COMPLETED'] } }, _sum: { amount: true } }),
      db.booking.aggregate({ where, _max: { createdAt: true } }),
      db.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          orderId: true,
          status: true,
          amount: true,
          currency: true,
          startTime: true,
          venue: { select: { name: true } },
          customer: { select: { name: true, whatsappNumber: true } },
        },
      }),
    ]);
    const venueRows = venues.map(({ resources, resourceGroups, ...venue }) => {
      const byId = new Map<string, { id: string; name: string }>();
      for (const unit of [...resources, ...resourceGroups]) byId.set(unit.category.id, unit.category);
      return { ...venue, facilities: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    });
    const bookingsByStatus: Record<string, number> = {};
    let totalBookings = 0;
    for (const row of byStatus) {
      bookingsByStatus[row.status] = row._count._all;
      totalBookings += row._count._all;
    }
    const logins = { total: 0, active: 0 };
    for (const row of ownerUsers) {
      logins.total += row._count._all;
      if (row.status === 'ACTIVE') logins.active += row._count._all;
    }
    return {
      ...org,
      stats: {
        venues: venues.length,
        activeVenues: venues.filter((v) => v.status === 'ACTIVE').length,
        logins,
        totalBookings,
        bookingsByStatus,
        revenue: (revenue._sum.amount ?? 0).toString(),
        lastBookedAt: last._max.createdAt,
      },
      venues: venueRows,
      recentBookings,
    };
  }

  /**
   * Suspending an organization signs its owners out (refresh sessions are
   * revoked; login and refresh already refuse a suspended organization).
   */
  async setStatus(id: string, status: OwnerOrganizationStatus, reason: string | undefined, actor: AuthContext) {
    const org = await this.getOrganization(id);
    if (org.status === status) return org;
    const updated = await this.prisma.client.ownerOrganization.update({ where: { id }, data: { status } });
    if (status === 'SUSPENDED') {
      const users = await this.prisma.client.venueOwnerUser.findMany({ where: { organizationId: id }, select: { id: true } });
      await Promise.all(users.map((u) => this.identity.revokeAllSessions('OWNER', u.id)));
    }
    await this.audit.record({
      actor,
      action: status === 'SUSPENDED' ? 'OWNER_ORGANIZATION_SUSPENDED' : 'OWNER_ORGANIZATION_REACTIVATED',
      entityType: 'OwnerOrganization',
      entityId: id,
      metadata: { reason: reason ?? null, from: org.status },
    });
    return updated;
  }

  async setOwnerUserStatus(
    organizationId: string,
    userId: string,
    status: OwnerUserStatus,
    reason: string | undefined,
    actor: AuthContext,
  ) {
    const user = await this.prisma.client.venueOwnerUser.findFirst({ where: { id: userId, organizationId } });
    if (!user) throw new NotFoundException('Owner login not found');
    if (user.status !== status) {
      await this.prisma.client.venueOwnerUser.update({ where: { id: userId }, data: { status } });
      if (status === 'DISABLED') await this.identity.revokeAllSessions('OWNER', userId);
      await this.audit.record({
        actor,
        action: status === 'DISABLED' ? 'OWNER_USER_DISABLED' : 'OWNER_USER_ENABLED',
        entityType: 'VenueOwnerUser',
        entityId: userId,
        metadata: { organizationId, reason: reason ?? null },
      });
    }
    const { passwordHash: _passwordHash, ...safe } = (await this.prisma.client.venueOwnerUser.findUnique({
      where: { id: userId },
    }))!;
    return safe;
  }

  async createOwnerUser(organizationId: string, dto: CreateOwnerUserDto, actor: AuthContext) {
    await this.getOrganization(organizationId);
    if (dto.venueIds?.length) {
      await this.scope.assertVenuesInOrganization(organizationId, dto.venueIds);
    }

    // Creates the VenueOwnerUser profile row and emails them an invite
    // link to set their own password.
    const ownerUser = await this.identity.inviteOwner({
      organizationId,
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      role: dto.role,
    });

    if (dto.role === 'OWNER_STAFF' && dto.venueIds?.length) {
      await this.scope.replaceAssignments(ownerUser.id, organizationId, dto.venueIds);
    }

    await this.audit.record({
      actor,
      action: 'OWNER_USER_CREATED',
      entityType: 'VenueOwnerUser',
      entityId: ownerUser.id,
      metadata: { organizationId, email: ownerUser.email, role: ownerUser.role },
    });

    return ownerUser;
  }

  async listOwnerUsers(organizationId: string) {
    await this.getOrganization(organizationId);
    const users = await this.prisma.client.venueOwnerUser.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { venueAssignments: { select: { venueId: true } } },
    });
    // Never expose credential hashes.
    return users.map(({ passwordHash: _passwordHash, venueAssignments, ...user }) => ({
      ...user,
      venueIds: venueAssignments.map((a) => a.venueId),
    }));
  }
}
